// ─────────────────────────────────────────────────────────────────────────────
// psychotherapyScale.js — the benchmark scale for the Psychotherapy / CBT
// Session Log.
//
// A course of therapy is 12–20 sessions and the whole clinical value is the
// TRAJECTORY, so this module exists to answer three questions off a single
// session log:
//
//   1. Is this patient getting better?      → Index A, Symptom Burden
//   2. Is the therapy actually working?     → Index B, Therapy Process
//   3. Is anyone at risk right now?         → the risk block, never averaged
//
// Two indices, deliberately not one blended number. A patient can be warmly
// engaged, doing every piece of homework, arriving weekly — and not improving.
// Averaging those together produces a reassuring middle number that hides the
// only fact that matters. So engagement can never move the symptom index, and
// symptoms can never move the process index.
//
// This is a SEPARATE scale from context/clinicalScale.js and imports nothing
// from it. The MSE scale is an examination scale; this is a course-of-treatment
// scale with its own fields, its own weights and its own version stamp, and the
// two must be independently editable. The only thing they share is the 5-step
// severity ladder below, so that the band → colour → chart presentation layer
// is reusable.
//
// Everything here is DERIVED at render time from each session's stored `data`.
// Nothing is persisted, so re-weighting the scale re-draws history instead of
// leaving old numbers stranded, and both sides of every delta are always scored
// by the same instrument.
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// SIGN-OFF REQUIRED — read before this is used on a real patient
//
// TEXTBOOK, unchanged:
//   • PHQ-9  0–4 / 5–9 / 10–14 / 15–19 / 20–27
//   • Y-BOCS 0–7 / 8–15 / 16–23 / 24–31 / 32–40
//   • GAD-7  0–4 / 5–9 / 10–14  (the published instrument stops here)
//
// MINE, and needing a neuropsychiatrist's sign-off:
//   • GAD-7 15–17 vs 18–21. GAD-7 publishes four bands, this ladder has five,
//     so the top band was split. Nothing in the literature draws that line.
//   • Every pre-session SUDs band (0–10 / 11–30 / 31–50 / 51–75 / 76–100).
//     SUDs is a personal 0–100 rating with no normative cut-points at all.
//   • The ordinal maps for cbtMseBrief, cbtEngagement, cbtProgress and
//     cbtHomeworkReview — i.e. which dropdown option counts as how severe.
//   • cbtRiskAssessment's map, including scoring "self-harm urges, no suicidal
//     intent" level with passive suicidal ideation. Defensible, not settled.
//   • Session-duration bands (≥45 / 35–44 / 25–34 / 15–24 / <15 minutes).
//   • sudsChange bands — how much in-session distress relief counts as a good
//     session (≥30 / 20–29 / 10–19 / 1–9 / ≤0 points of drop).
//   • sessionInterval bands — how late is late (0–10 / 11–17 / 18–24 / 25–35 /
//     >35 days). Assumes a weekly protocol; a fortnightly one needs different
//     numbers.
//   • Deterioration thresholds: a rise of ≥5 points on PHQ-9, GAD-7 or Y-BOCS
//     since the previous session. Chosen to sit near published reliable-change
//     estimates, not taken from any one of them.
//   • Every domain weight, and which domains belong to which index.
//
// Change any of them here and the whole history re-scores on the next render.
// ═════════════════════════════════════════════════════════════════════════════

export const SCALE_VERSION = 'cbt-1.0';

/** Severity ladder, worst last. Shared vocabulary with the MSE scale so the
 *  band chips, zone colours and chart bands can be reused, and nothing else. */
export const BANDS = ['Normal', 'Borderline', 'Mild', 'Moderate', 'Severe'];
export const MAX_SCORE = BANDS.length - 1; // 4

export const bandOf = (score) =>
  score === null || score === undefined
    ? null
    : BANDS[Math.max(0, Math.min(MAX_SCORE, Math.round(score)))];

export const bandOf100 = (pct) =>
  pct === null || pct === undefined ? null : bandOf((pct / 100) * MAX_SCORE);

/** Chart zones, derived from the same rounding as bandOf, so a chip and the
 *  zone a point sits in can never disagree. */
export const bandRanges = () =>
  BANDS.map((band, i) => ({
    band,
    from: Math.max(0, ((i - 0.5) / MAX_SCORE) * 100),
    to: Math.min(100, ((i + 0.5) / MAX_SCORE) * 100),
  }));

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO INDICES
// ─────────────────────────────────────────────────────────────────────────────

export const INDEXES = {
  symptom: {
    key: 'symptom',
    label: 'Symptom Burden',
    caption: 'How ill the patient is — from the instruments and the mental state.',
  },
  process: {
    key: 'process',
    label: 'Therapy Process',
    caption: 'How the therapy itself is going — alliance, response, homework, dose.',
  },
};

export const DOMAINS = {
  // ── Index A: symptom burden ────────────────────────────────────────────────
  mood:        { label: 'Depression (PHQ-9)',            short: 'Depression', weight: 2,   index: 'symptom' },
  anxiety:     { label: 'Anxiety (GAD-7)',               short: 'Anxiety',    weight: 2,   index: 'symptom' },
  ocd:         { label: 'Obsessive–Compulsive (Y-BOCS)', short: 'OCD',        weight: 1.5, index: 'symptom' },
  distress:    { label: 'Subjective Distress (SUDs)',    short: 'Distress',   weight: 1,   index: 'symptom' },
  mentalState: { label: 'Mental State',                  short: 'State',      weight: 1.5, index: 'symptom' },

  // ── Index B: therapy process ──────────────────────────────────────────────
  alliance:       { label: 'Engagement & Alliance', short: 'Alliance', weight: 2,   index: 'process' },
  response:       { label: 'Treatment Response',    short: 'Response', weight: 2,   index: 'process' },
  betweenSession: { label: 'Between-Session Work',  short: 'Homework', weight: 1.5, index: 'process' },
  delivery:       { label: 'Delivery & Dose',       short: 'Delivery', weight: 1,   index: 'process' },

  // ── Neither index: an action threshold, not a severity ────────────────────
  risk: { label: 'Risk', short: 'Risk', weight: 0, index: null, separate: true },
};

export const RISK_DOMAIN = 'risk';
export const SYMPTOM_DOMAINS = ['mood', 'anxiety', 'ocd', 'distress', 'mentalState'];
export const PROCESS_DOMAINS = ['alliance', 'response', 'betweenSession', 'delivery'];
export const DOMAIN_ORDER = [...SYMPTOM_DOMAINS, ...PROCESS_DOMAINS];

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING — private helpers
// ─────────────────────────────────────────────────────────────────────────────

const DASHES = /[−–—‐‑]/g;       // − – — ‐ ‑
const COMBINING = /[̀-ͯ]/g;                     // accents, post-NFKD

/**
 * Loose key for option matching. A dictated "telehealth — video" and the
 * option "Telehealth - Video" must land on the same entry, so punctuation,
 * spacing, case and accents are all dropped before comparing.
 */
const normKey = (v) =>
  String(v ?? '')
    .replace(DASHES, '-')
    .normalize('NFKD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Memoised option → score map, hidden off the spec so it never serialises. */
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

/**
 * Day index of an ISO date, read off the STRING rather than through Date, so a
 * date-only value cannot shift a day either way across a timezone boundary.
 */
const dayNumber = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : null;
};

const daysBetween = (from, to) => {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
};

// ─────────────────────────────────────────────────────────────────────────────
// THE FIELD TABLE
//
// kind:
//   ordinal   one dropdown value → one severity score
//   banded    a number placed on a band table
//   meta      recorded, carries no severity (dates, codes, safety-plan status)
//   narrative free text — recorded, never scored
//
// `bands` are 4-TUPLES here, not the 3-tuples the MSE scale uses: [lo, hi,
// score, instrumentWord]. PHQ-9 12 is "moderate" in the literature but lands on
// this ladder's Mild, and showing a clinician only "Mild" for a PHQ-9 of 12
// costs trust the dashboard cannot afford. The instrument's own word travels
// with the band and is shown beside it.
// ─────────────────────────────────────────────────────────────────────────────

// Appended to every instrument's extraction guidance. Without it a sad-sounding
// transcript invites the model to volunteer "PHQ-9 around 15", which would put a
// fabricated instrument score into a medical record.
const SCORE_CAUTION =
  'take this ONLY from a total actually stated in the conversation — never estimate a score ' +
  'from how the patient sounds, and leave it out if no number was said. Where no total was ' +
  'stated, put the severity in the matching "clinical impression" field instead';

export const FIELD_SCALE = {
  // ── Index A · instruments ────────────────────────────────────────────────
  cbtPhq9: {
    kind: 'banded', domain: 'mood', w: 1,
    label: 'PHQ-9 (depression)', instrument: 'PHQ-9', range: [0, 27],
    direction: 'higher-worse',
    bands: [
      [0, 4, 0, 'none–minimal'], [5, 9, 1, 'mild'], [10, 14, 2, 'moderate'],
      [15, 19, 3, 'moderately severe'], [20, 27, 4, 'severe'],
    ],
    benchmark: '0–4, none to minimal',
    caution: SCORE_CAUTION,
  },
  cbtGad7: {
    kind: 'banded', domain: 'anxiety', w: 1,
    label: 'GAD-7 (anxiety)', instrument: 'GAD-7', range: [0, 21],
    direction: 'higher-worse',
    bands: [
      [0, 4, 0, 'minimal'], [5, 9, 1, 'mild'], [10, 14, 2, 'moderate'],
      [15, 17, 3, 'severe'], [18, 21, 4, 'severe'],
    ],
    benchmark: '0–4, minimal',
    caution: SCORE_CAUTION,
  },
  cbtYbocs: {
    kind: 'banded', domain: 'ocd', w: 1,
    label: 'Y-BOCS (obsessive–compulsive)', instrument: 'Y-BOCS', range: [0, 40],
    direction: 'higher-worse',
    bands: [
      [0, 7, 0, 'subclinical'], [8, 15, 1, 'mild'], [16, 23, 2, 'moderate'],
      [24, 31, 3, 'severe'], [32, 40, 4, 'extreme'],
    ],
    benchmark: '0–7, subclinical',
    caution: `${SCORE_CAUTION}. Leave empty entirely when OCD is not part of the picture`,
  },
  cbtPreSuds: {
    kind: 'banded', domain: 'distress', w: 1,
    label: 'Distress on arrival (pre-session SUDs)', instrument: 'SUDs', range: [0, 100],
    direction: 'higher-worse',
    bands: [
      [0, 10, 0, 'settled'], [11, 30, 1, 'mild'], [31, 50, 2, 'moderate'],
      [51, 75, 3, 'high'], [76, 100, 4, 'extreme'],
    ],
    benchmark: '0–10 out of 100',
    caution: SCORE_CAUTION,
  },
  // Recorded but NOT scored on the same ladder as the pre-session rating:
  // scoring both would count the same distress twice, and what carries the
  // clinical signal is the CHANGE across the hour — see sudsChange below.
  cbtPostSuds: {
    kind: 'meta', domain: 'distress',
    label: 'Distress at the end (post-session SUDs)', range: [0, 100],
    caution: SCORE_CAUTION,
  },

  // ── Index A · mental state ───────────────────────────────────────────────
  cbtMseBrief: {
    kind: 'ordinal', domain: 'mentalState', w: 1,
    label: 'Brief mental status',
    map: {
      'Within Normal Limits / Baseline': 0,
      'Depressed Mood / Restricted Affect': 2,
      'Anxious / Agitated': 2,
      'Hypomanic / Elevated': 3,
      'Cognitively Impaired / Disorganized': 4,
    },
    benchmark: 'Within Normal Limits / Baseline',
    caution: 'Extract the brief mental status from natural conversation descriptions of the patient\'s demeanor, mood, and level of agitation/anxiety',
  },

  // ── Index B · alliance ───────────────────────────────────────────────────
  cbtEngagement: {
    kind: 'ordinal', domain: 'alliance', w: 1,
    label: 'Engagement & therapeutic alliance',
    map: {
      'Highly Engaged & Collaborative': 0,
      'Moderately Engaged': 1,
      'Passive / Hesitant': 2,
      'Resistant / Guarded': 3,
      'Poor Therapeutic Alliance': 4,
    },
    benchmark: 'Highly Engaged & Collaborative',
  },

  // ── Index B · response ───────────────────────────────────────────────────
  cbtProgress: {
    kind: 'ordinal', domain: 'response', w: 1,
    label: 'Progress towards treatment goals',
    map: {
      'Significant Progress': 0,
      'Moderate Progress': 1,
      'Minimal Progress': 2,
      'No Change': 3,
      'Temporary Regression': 4,
    },
    benchmark: 'Significant Progress',
  },

  // ── Index B · between-session work ───────────────────────────────────────
  cbtHomeworkReview: {
    kind: 'ordinal', domain: 'betweenSession', w: 1,
    label: "Last session's homework — completion",
    map: {
      'Completed fully': 0,
      'Completed partially': 1,
      'Attempted, not completed': 2,
      'Not attempted': 4,
    },
    // An explicit not-applicable, so a first session is never penalised for
    // failing to do homework that was never set.
    unassessed: ['None was assigned last session'],
    benchmark: 'Completed fully',
  },
  cbtHomeworkAssigned: {
    kind: 'narrative', domain: 'betweenSession', label: 'Homework set for next time',
  },

  // ── Index B · delivery & dose ────────────────────────────────────────────
  cbtDuration: {
    kind: 'banded', domain: 'delivery', w: 1,
    label: 'Session length', unit: 'mins',
    direction: 'lower-worse',
    bands: [
      [45, 600, 0, 'full session'], [35, 44, 1, 'slightly short'], [25, 34, 2, 'short'],
      [15, 24, 3, 'very short'], [0, 14, 4, 'barely started'],
    ],
    benchmark: '45 minutes or more',
  },

  // ── Risk — separate, weight 0, never folded into either index ────────────
  cbtRiskAssessment: {
    kind: 'ordinal', domain: 'risk', w: 3, critical: true,
    label: 'Suicide / self-harm risk',
    map: {
      'No suicidal/self-harm ideation': 0,
      'Passive suicidal ideation (no plan/intent)': 2,
      'Self-harm urges present (No suicidal intent)': 2,
      'Active suicidal ideation without plan/intent': 3,
      'Active suicidal ideation WITH plan/intent (Urgent Action Required)': 4,
    },
    benchmark: 'No suicidal/self-harm ideation',
  },
  // Deliberately unscored. Writing a new safety plan is the CORRECT RESPONSE to
  // rising risk, not a worse finding — scoring it as severity would invert its
  // meaning and punish good practice. It is shown as a status line instead, and
  // its absence beside recorded ideation is what raises a flag.
  cbtSafetyPlan: { 
    kind: 'meta', domain: 'risk', label: 'Safety plan status',
    caution: 'Extract the status of the safety plan if the clinician explicitly mentions reviewing safety, risk, or safety protocols with the patient',
  },

  // ── Recorded context: no severity, but it belongs in the record ──────────
  cbtSessionDate:     { kind: 'meta',      domain: 'delivery', label: 'Session date' },
  cbtSessionNum:      { kind: 'meta',      domain: 'delivery', label: 'Session number' },
  cbtTotalSessions:   { kind: 'meta',      domain: 'delivery', label: 'Planned sessions' },
  cbtModality:        { kind: 'meta',      domain: 'delivery', label: 'Session modality' },
  cbtBillingCode:     { kind: 'meta',      domain: 'delivery', label: 'Billing code' },
  cbtTherapist:       { kind: 'meta',      domain: 'delivery', label: 'Therapist' },
  cbtPrimaryModality: { kind: 'meta',      domain: 'delivery', label: 'Primary approach' },
  cbtInterventions:   { 
    kind: 'meta',      domain: 'delivery', label: 'Techniques used',
    caution: 'Map natural descriptions of therapy exercises (like breathing exercises, challenging negative thoughts, or practicing scary situations) to the closest matching formal technique',
  },
  cbtNextSession:     { kind: 'meta',      domain: 'delivery', label: 'Next session' },
  cbtAgenda:          { 
    kind: 'narrative', domain: 'delivery', label: 'Agenda / target problem',
    caution: 'Extract the main topics, homework review, or goals the therapist and patient agreed to focus on during the hour, even if they never explicitly say the word agenda',
  },
  cbtClinicalNotes:   { kind: 'narrative', domain: 'delivery', label: 'Clinical narrative' },

  // ── Derived — computed, never dictated. See DERIVED below. ───────────────
  sudsChange: {
    kind: 'banded', domain: 'response', w: 1, derived: true,
    label: 'Distress relief across the hour', unit: 'pts down',
    direction: 'lower-worse',
    bands: [
      [30, 200, 0, 'strong relief'], [20, 29, 1, 'good relief'], [10, 19, 2, 'some relief'],
      [1, 9, 3, 'little relief'], [-200, 0, 4, 'no relief or worse'],
    ],
    benchmark: 'down 30 points or more by the end',
  },
  sessionInterval: {
    kind: 'banded', domain: 'delivery', w: 1, derived: true,
    label: 'Interval since previous session', unit: 'days',
    direction: 'higher-worse',
    bands: [
      [0, 10, 0, 'on schedule'], [11, 17, 1, 'a week late'], [18, 24, 2, 'two weeks late'],
      [25, 35, 3, 'a month'], [36, 3650, 4, 'over five weeks'],
    ],
    benchmark: '7–10 days',
  },
  courseDose: {
    kind: 'meta', domain: 'delivery', derived: true, label: 'Position in the course',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL IMPRESSIONS — the conversation's route to a severity
//
// A consultation does not contain a PHQ-9 total. It contains "I'm still low in
// the evenings, but I'm getting to work" — which supports a BAND and supports no
// number at all. SCORE_CAUTION above is what stops the model turning that into
// "PHQ-9 around 15", and it is right to: a total asserts that nine items were
// rated over a two-week window, and once written it is plotted, compared against
// the previous session and flagged on exactly like a measurement.
//
// So each instrument gains a sibling that holds the band directly. Two rules make
// this safe rather than merely convenient:
//
//   1. The options are GENERATED from the instrument's own bands[] words, so an
//      impression can never disagree with its instrument about what "moderate"
//      means, and a cut-point edited above updates both.
//   2. The instrument always wins where both are present (see scoreSession), and
//      the dashboard marks an inferred point as inferred.
// ─────────────────────────────────────────────────────────────────────────────

const IMPRESSION_CAUTION =
  'read this from how the patient describes things, never from a number — it is the clinician\'s ' +
  'impression, not a test score. If a total for the instrument WAS stated, fill that instead and ' +
  'leave this empty. Leave it out entirely if the conversation says nothing about this area';

const capitalise = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);

/**
 * Build an impression spec from the instrument it stands in for.
 *
 * Same domain and weight as its target, so substituting one for the other cannot
 * shift a domain's weighting. `fallbackFor` is what scoreSession reads to
 * suppress this field when the real instrument was administered.
 */
function impressionSpecFor(targetKey, label, extraCaution = '') {
  const target = FIELD_SCALE[targetKey];
  const map = {};
  (target.bands || []).forEach(([, , score, word]) => {
    const option = capitalise(word || bandOf(score));
    // Band words repeat in places — GAD-7 calls both 15–17 and 18–21 'severe'.
    // bands[] ascends by score, so first-seen is the LOWEST score carrying that
    // word, and that is the one to keep: an impression must not claim the top of
    // a range it cannot measure.
    if (!(option in map)) map[option] = score;
  });
  return {
    kind: 'ordinal',
    domain: target.domain,
    w: target.w || 1,
    inferred: true,
    fallbackFor: targetKey,
    label,
    map,
    benchmark: capitalise((target.bands || [])[0]?.[3] || bandOf(0)),
    caution: extraCaution ? `${IMPRESSION_CAUTION}. ${extraCaution}` : IMPRESSION_CAUTION,
  };
}

Object.assign(FIELD_SCALE, {
  cbtMoodImpression: impressionSpecFor('cbtPhq9', 'Depression — clinical impression'),
  cbtAnxietyImpression: impressionSpecFor('cbtGad7', 'Anxiety — clinical impression'),
  cbtOcdImpression: impressionSpecFor(
    'cbtYbocs',
    'Obsessive–compulsive — clinical impression'
  ),
  cbtDistressImpression: impressionSpecFor(
    'cbtPreSuds',
    'Distress on arrival — clinical impression',
    'Extract how panicked, overwhelmed, or tense the patient describes feeling upon arriving at the session'
  ),
  // Stands in for a DERIVED field. sudsChange needs both SUDs numbers; a
  // conversation gives "much calmer than when you came in" instead, and these are
  // the same relief bands sudsChange itself scores on. cbtPostSuds needs no
  // sibling — it is unscored and exists only to feed sudsChange.
  cbtReliefImpression: impressionSpecFor(
    'sudsChange',
    'Relief across the session — clinical impression',
    'Extract how much calmer, more relaxed, or relieved the patient feels at the end of the session compared to arrival'
  ),
});

/**
 * Option lists for the impression selects, exported so the FORM reads them from
 * the scale instead of retyping them. A retyped option that drifted by one word
 * would score as unmapped and silently stop counting.
 */
export const IMPRESSION_OPTIONS = Object.fromEntries(
  Object.keys(FIELD_SCALE)
    .filter((k) => FIELD_SCALE[k].inferred)
    .map((k) => [k, Object.keys(FIELD_SCALE[k].map)])
);

/** Impression key → the instrument key(s) whose measurement supersedes it. */
export const IMPRESSION_FALLBACKS = Object.fromEntries(
  Object.keys(FIELD_SCALE)
    .filter((k) => FIELD_SCALE[k].inferred)
    .map((k) => [k, [FIELD_SCALE[k].fallbackFor].flat().filter(Boolean)])
);

/** Keys carrying a severity score — everything except meta and narrative. */
export const SCORED_KEYS = Object.keys(FIELD_SCALE).filter(
  (k) => !['meta', 'narrative'].includes(FIELD_SCALE[k].kind)
);

/** Keys the form actually holds, i.e. everything a dictation could fill. */
export const DICTATED_KEYS = Object.keys(FIELD_SCALE).filter((k) => !FIELD_SCALE[k].derived);

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED FIELDS
//
// scoreField sees one value. Three of the most informative signals in a course
// of therapy are cross-field or cross-session, so they are computed into
// pseudo-values BEFORE scoring and then flow through the ordinary scorer, which
// keeps them visible in the field table like any other row instead of hiding in
// a special case.
// ─────────────────────────────────────────────────────────────────────────────

export const DERIVED = [
  {
    // Distress should be lower at the end of a session than at the start. This
    // is the single best per-session read on whether the hour did anything.
    k: 'sudsChange',
    compute: (data) => {
      const pre = firstNumber(data.cbtPreSuds);
      const post = firstNumber(data.cbtPostSuds);
      if (pre === null || post === null) {
        return { value: null, note: 'needs both the pre- and post-session ratings' };
      }
      return { value: pre - post };
    },
  },
  {
    // Attendance, without asking anyone to type it: weekly is the standard dose
    // and a five-week gap mid-course is a clinical event in itself.
    k: 'sessionInterval',
    compute: (data, prev) => {
      if (!prev) return { value: null, note: 'first session on record' };
      const days = daysBetween(prev.cbtSessionDate, data.cbtSessionDate);
      if (days === null) return { value: null, note: 'needs a date on both sessions' };
      if (days < 0) {
        return { value: null, note: 'dated before the previous session — check the date' };
      }
      // "Previous session" means the previous session ON RECORD, which is not
      // always the previous session that happened. Where the numbers show a gap
      // in the log — sessions held elsewhere, or entered into another system —
      // the elapsed days cover several intervals at once, and scoring that as a
      // late appointment would be wrong. Say so instead of scoring it.
      const n = firstNumber(data.cbtSessionNum);
      const p = firstNumber(prev.cbtSessionNum);
      if (n !== null && p !== null && n - p > 1) {
        const missing = n - p === 2 ? `session ${p + 1} is` : `sessions ${p + 1}–${n - 1} are`;
        return {
          value: null,
          note: `${days} days since the last session on record, but ${missing} not logged here — that gap covers more than one interval`,
        };
      }
      return { value: days };
    },
  },
  {
    // Unscored: being early in a course is not a finding. It is the context the
    // rest of the numbers have to be read in.
    k: 'courseDose',
    compute: (data) => {
      const n = firstNumber(data.cbtSessionNum);
      const t = firstNumber(data.cbtTotalSessions);
      if (n === null) return { value: null };
      if (!t) return { value: `session ${n}` };
      return { value: `session ${n} of ${t} · ${Math.round((n / t) * 100)}% of course` };
    },
  },
];

/** Pseudo-values for one session. `prev` is the previous session's raw data. */
export function deriveValues(data = {}, prev = null) {
  const values = {};
  const notes = {};
  DERIVED.forEach((d) => {
    const out = d.compute(data, prev) || {};
    values[d.k] = out.value ?? null;
    if (out.note) notes[d.k] = out.note;
  });
  return { values, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODALITY / TECHNIQUE FIT — advisory only, never scored
//
// cbtInterventions is a single-select, and one supportive session inside a CBT
// course during a crisis week is good practice, not drift. Scoring per-session
// fidelity off one dropdown would therefore be clinically wrong. What IS worth
// saying out loud is a sustained pattern, so this is checked across three
// consecutive sessions and contributes nothing to either index.
// ─────────────────────────────────────────────────────────────────────────────

export const MODALITY_TECHNIQUES = {
  'Cognitive Behavioral Therapy (CBT)': [
    'Cognitive Restructuring / Thought Records',
    'Behavioral Activation / Activity Scheduling',
    'Graded Exposure (In-Vivo / Imaginal)',
    'Diaphragmatic Breathing / Progressive Muscle Relaxation',
    'Mindfulness & Grounding Techniques',
    'Socratic Questioning & Downward Arrow Technique',
    'Decatastrophizing & Probability Estimation',
  ],
  'Dialectical Behavior Therapy (DBT)': [
    'Distress Tolerance & Emotion Regulation Skills (DBT)',
    'Mindfulness & Grounding Techniques',
    'Diaphragmatic Breathing / Progressive Muscle Relaxation',
  ],
  'Acceptance & Commitment Therapy (ACT)': [
    'Mindfulness & Grounding Techniques',
    'Behavioral Activation / Activity Scheduling',
    'Graded Exposure (In-Vivo / Imaginal)',
  ],
  'Exposure & Response Prevention (ERP)': [
    'Graded Exposure (In-Vivo / Imaginal)',
    'Distress Tolerance & Emotion Regulation Skills (DBT)',
    'Diaphragmatic Breathing / Progressive Muscle Relaxation',
    'Decatastrophizing & Probability Estimation',
  ],
  'EMDR / Trauma-Focused Therapy': [
    'Graded Exposure (In-Vivo / Imaginal)',
    'Mindfulness & Grounding Techniques',
    'Diaphragmatic Breathing / Progressive Muscle Relaxation',
    'Distress Tolerance & Emotion Regulation Skills (DBT)',
  ],
  'Psychodynamic / Interpersonal Therapy': [
    'Socratic Questioning & Downward Arrow Technique',
  ],
  'Supportive Psychotherapy': [
    'Mindfulness & Grounding Techniques',
    'Diaphragmatic Breathing / Progressive Muscle Relaxation',
    'Distress Tolerance & Emotion Regulation Skills (DBT)',
    'Behavioral Activation / Activity Scheduling',
  ],
};

/** True when the recorded technique sits outside the stated modality's set. */
const offModality = (data = {}) => {
  const modality = MODALITY_TECHNIQUES[String(data.cbtPrimaryModality || '').trim()];
  const technique = String(data.cbtInterventions || '').trim();
  if (!modality || !technique) return false;
  return !modality.some((t) => normKey(t) === normKey(technique));
};

/**
 * Advisory raised only when the last three consecutive sessions all used a
 * technique outside the stated primary modality — a course that has quietly
 * become a different treatment than the one in the plan.
 */
export function modalityDrift(points = []) {
  const last3 = points.slice(-3);
  if (last3.length < 3) return null;
  if (!last3.every((p) => offModality(p.data || {}))) return null;
  const modality = last3[last3.length - 1].data?.cbtPrimaryModality || 'the stated modality';
  const used = [...new Set(last3.map((p) => p.data?.cbtInterventions).filter(Boolean))];
  return {
    modality,
    techniques: used,
    detail:
      `The last three sessions are recorded as ${modality}, but the technique used each time ` +
      `sits outside it (${used.join('; ')}). Either the treatment plan or the technique field ` +
      'needs updating — this is a record-keeping observation, and does not affect any score.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCALE AS EXTRACTION GUIDANCE
//
// The same ladder rendered as one line per field and shipped to the dictation
// endpoint alongside the field spec. A therapy hour almost never states a value
// — the patient says "I did about half of the thought records", not
// "homework: Completed partially" — so an extractor holding only an option list
// has nothing to place that sentence against and drops the field.
//
// It stays guidance, not authority: the backend validates every returned value
// against the field's real option list, so a clumsy line here can lose a field
// but can never put a value into the form that the form does not allow.
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

/** One line of mapping guidance for a field, or null if it needs none. */
export function guideFor(key) {
  const spec = FIELD_SCALE[key];
  // Derived fields are computed from other answers and must never be asked for.
  if (!spec || spec.derived) return null;

  const bits = [];
  if (spec.kind === 'ordinal') {
    if (!spec.map) return null;
    // An impression's options ARE the band names, so spelling the mapping out
    // would read "Mild = Mild | Moderate = Moderate" — noise. Its caution carries the
    // guidance that actually matters instead.
    if (!spec.inferred) bits.push(`how severe each option is — ${bandGroups(spec.map)}`);
  } else if (spec.kind === 'banded') {
    const ladder = (spec.bands || [])
      .map(([lo, hi, score, word]) => `${lo}–${hi} ${word || BANDS[Math.round(score)]}`)
      .join(' | ');
    const scaleOf = spec.range
      ? `a total from ${spec.range[0]} to ${spec.range[1]}`
      : `a number${spec.unit ? ` in ${spec.unit}` : ''}`;
    bits.push(`${scaleOf} — ${ladder}`);
  } else if (spec.kind === 'meta' && spec.range) {
    // A number the scale records but does not band — still worth telling the
    // extractor what range it lives on, so "40 out of 100" is not read as 40%.
    bits.push(`a rating from ${spec.range[0]} to ${spec.range[1]}`);
  }

  if (spec.benchmark) bits.push(`no concern looks like: ${spec.benchmark}`);
  if (spec.unassessed?.length) {
    bits.push(
      `${spec.unassessed.map((u) => `"${u}"`).join(' / ')} means NOT APPLICABLE — ` +
      'never use it to mean it was done'
    );
  }
  // Mirrors the scoring rule that silence on a risk field is reported, never
  // assumed normal: if nothing was said, the field must arrive empty so the
  // dashboard can show NOT ASSESSED instead of a fabricated "no ideation".
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

const numDisplay = (spec, num) => {
  if (spec.range) return `${num} / ${spec.range[1]}`;
  if (spec.unit) return `${num} ${spec.unit}`;
  return String(num);
};

/**
 * Score ONE field.
 *
 * An unrecognised value comes back assessed:false with unmapped:true — it is
 * surfaced in the dashboard rather than scored 0, because "we do not recognise
 * this answer" and "this answer is normal" must never look alike.
 */
export function scoreField(key, raw) {
  const spec = FIELD_SCALE[key];
  if (!spec) return null;

  const base = {
    k: key,
    label: spec.label || key,
    domain: spec.domain || null,
    index: spec.domain ? DOMAINS[spec.domain]?.index || null : null,
    kind: spec.kind,
    derived: !!spec.derived,
    // True for a band read off the conversation rather than an administered
    // total. Travels with the datapoint all the way to the chart marker, so a
    // judgement is never displayed as a measurement.
    inferred: !!spec.inferred,
    weight: spec.w || 1,
    benchmark: spec.benchmark || null,
    instrument: spec.instrument || null,
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

  // Explicit "not applicable" answers must not be scored as findings.
  if ((spec.unassessed || []).some((u) => normKey(u) === normKey(raw))) {
    base.detail = 'not applicable';
    return base;
  }

  if (spec.kind === 'meta' || spec.kind === 'narrative') {
    base.assessed = true; // recorded, but carries no score
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

  if (spec.kind === 'banded') {
    const num = typeof raw === 'number' ? raw : firstNumber(raw);
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
      display: numDisplay(spec, num),
      // The instrument's own word for this band, so a PHQ-9 of 12 does not read
      // as merely "Mild" to someone who knows the instrument calls it moderate.
      detail: hit[3] ? `${spec.instrument || spec.label}: ${hit[3]}` : '',
    };
  }

  return base;
}

/** Weighted mean of a set of domains, as a percentage of maximum severity. */
const indexOver = (keys, domains) => {
  const scored = keys.map((d) => domains[d]).filter((x) => x && x.score !== null);
  const w = scored.reduce((t, d) => t + d.weight, 0);
  const pct = w ? Math.round(scored.reduce((t, d) => t + d.weight * d.score, 0) / w) : null;
  return {
    score: pct,
    band: bandOf100(pct),
    covered: scored.length,
    total: keys.length,
    // True when any contributing domain rested on a conversation-derived band, so
    // the index's own trend point can be drawn as inferred.
    inferred: scored.some((d) => d.inferred),
  };
};

/** A rise of this many points since the previous session is a deterioration. */
export const DETERIORATION_RISE = { cbtPhq9: 5, cbtGad7: 5, cbtYbocs: 5 };

/** The same gate for impression fields, in band steps rather than raw points. */
export const IMPRESSION_RISE = 2;

/** Stated wherever the risk block is shown — a total is not a risk screen. */
export const RISK_CAVEAT =
  'A PHQ-9 total can be low while its item 9 (thoughts of being better off dead) is positive. ' +
  'Only the total is stored here, so it is not a risk screen — the risk field above is.';

/**
 * Score a whole session.
 *
 * `prev` is the PREVIOUS session's raw data. It is needed twice: to derive the
 * attendance interval, and to detect deterioration. Both indices, every domain
 * mean and every delta on the dashboard are computed against the immediately
 * previous session and never against the first — a first-to-last comparison
 * reports "better" straight through a relapse.
 */
export function scoreSession(data = {}, prev = null) {
  const { values: derivedValues, notes: derivedNotes } = deriveValues(data, prev);
  const merged = { ...data, ...derivedValues };

  const fields = {};
  Object.keys(FIELD_SCALE).forEach((k) => {
    const scored = scoreField(k, merged[k]);
    if (!scored) return;
    if (!scored.assessed && derivedNotes[k]) scored.detail = derivedNotes[k];
    fields[k] = scored;
  });

  // An impression is the conversation's route to a severity; the instrument is
  // the measurement. Where both are present the measurement wins, and blanking
  // `assessed` is all that takes: every consumer below — the domain means, the
  // scored list, both indices, the coverage count — already filters on it, so the
  // same severity cannot be counted twice and nothing else needs to know.
  Object.entries(IMPRESSION_FALLBACKS).forEach(([key, targets]) => {
    if (!fields[key]?.assessed) return;
    const measured = targets.find((t) => fields[t]?.assessed);
    if (!measured) return;
    const spec = FIELD_SCALE[measured];
    fields[key] = {
      ...fields[key],
      assessed: false,
      superseded: true,
      detail: `superseded by the administered ${spec.instrument || spec.label}`,
    };
  });

  const domains = {};
  Object.keys(DOMAINS).forEach((d) => {
    const members = SCORED_KEYS.filter((k) => FIELD_SCALE[k].domain === d);
    const assessed = members.filter((k) => fields[k]?.assessed);
    const wSum = assessed.reduce((t, k) => t + fields[k].weight, 0);
    const sSum = assessed.reduce((t, k) => t + fields[k].weight * fields[k].score, 0);
    const pct = wSum ? Math.round((sSum / (wSum * MAX_SCORE)) * 100) : null;
    domains[d] = {
      key: d,
      ...DOMAINS[d],
      score: pct,
      band: bandOf100(pct),
      covered: assessed.length,
      total: members.length,
      // At least one scored member is a clinical impression rather than an
      // administered total.
      inferred: assessed.some((k) => fields[k].inferred),
      members,
      // Every field in the domain, scored or not, so the field table can also
      // show the narrative and meta rows that belong to it.
      allMembers: Object.keys(FIELD_SCALE).filter((k) => FIELD_SCALE[k].domain === d),
      missing: members.filter((k) => !fields[k]?.assessed),
    };
  });

  const symptom = indexOver(SYMPTOM_DOMAINS, domains);
  const process = indexOver(PROCESS_DOMAINS, domains);

  // ── Risk: read off its own field, never averaged into anything ────────────
  const rf = fields.cbtRiskAssessment;
  const pf = fields.cbtSafetyPlan;
  const risk = {
    key: RISK_DOMAIN,
    label: DOMAINS.risk.label,
    assessed: !!rf?.assessed,
    level: rf?.assessed ? rf.score : null,   // 0–4, the raw ladder step
    band: rf?.assessed ? rf.band : null,
    value: rf?.assessed ? rf.display : null,
    planAssessed: !!pf?.assessed,
    planValue: pf?.assessed ? pf.display : null,
  };

  const scoredList = SCORED_KEYS.map((k) => fields[k]).filter(Boolean);
  const criticalMissing = scoredList.filter((f) => f.critical && !f.assessed);

  // ── Safety and deterioration gates ───────────────────────────────────────
  const flags = [];

  if (!risk.assessed) {
    flags.push({
      level: 'amber',
      title: 'Risk not assessed',
      detail:
        'Suicide and self-harm risk was not recorded for this session. "Not asked" and "no ' +
        'ideation" are different clinical facts — confirm before signing the note.',
    });
  }

  if (risk.level !== null && risk.level >= 3 && !risk.planAssessed) {
    flags.push({
      level: 'red',
      title: 'Active ideation recorded with no safety-plan status',
      detail:
        `Risk is recorded as "${risk.value}" and the safety-plan field is empty. A safety plan ` +
        'must be reviewed, updated or newly created, and recorded, before this session is closed.',
    });
  } else if (risk.level !== null && risk.level >= 1 && !risk.planAssessed) {
    flags.push({
      level: 'amber',
      title: 'Ideation recorded with no safety-plan status',
      detail:
        `Risk is recorded as "${risk.value}" but the safety-plan field is empty. Record whether ` +
        'a plan was reviewed, updated or newly created.',
    });
  }

  Object.entries(DETERIORATION_RISE).forEach(([k, threshold]) => {
    const now = firstNumber(data[k]);
    const before = prev ? firstNumber(prev[k]) : null;
    if (now === null || before === null) return;
    const rise = now - before;
    if (rise < threshold) return;
    const name = FIELD_SCALE[k].instrument || FIELD_SCALE[k].label;
    flags.push({
      level: 'amber',
      deterioration: true,
      title: `${name} up ${rise} points since the previous session`,
      detail:
        `${before} → ${now}. A rise of ${threshold} or more is treated here as real ` +
        'deterioration rather than noise, and is reported even when an index reads better ' +
        'overall — a weighted mean can improve while one instrument worsens.',
    });
  });

  // The gate above reads raw instrument totals, so a course tracked entirely on
  // impressions would never trip it. Two band steps is the equivalent threshold —
  // coarser than 5 points because a band is coarser than a total.
  Object.keys(IMPRESSION_FALLBACKS).forEach((k) => {
    const now = fields[k];                                 // blank when superseded,
    const before = prev ? scoreField(k, prev[k]) : null;    // so never a double flag
    if (!now?.assessed || !before?.assessed) return;
    const rise = now.score - before.score;
    if (rise < IMPRESSION_RISE) return;
    flags.push({
      level: 'amber',
      deterioration: true,
      title: `${FIELD_SCALE[k].label} worsened by ${rise} bands since the previous session`,
      detail:
        `${before.display} → ${now.display}. This is a clinical impression rather than a measured ` +
        'total, so administer the instrument before acting on the size of the change.',
    });
  });

  if (normKey(data.cbtProgress) === normKey('Temporary Regression')) {
    flags.push({
      level: 'amber',
      deterioration: true,
      title: 'Therapist recorded a temporary regression',
      detail: 'Progress towards treatment goals is logged as a regression for this session.',
    });
  }

  // The conjunction that matters most: things are getting worse AND ideation is
  // on the record. Either alone is amber; together it is not.
  if (flags.some((f) => f.deterioration) && risk.level !== null && risk.level >= 2) {
    flags.push({
      level: 'red',
      title: 'Deterioration alongside recorded ideation',
      detail:
        'Symptoms or progress have worsened since the previous session while suicidal or ' +
        `self-harm ideation is recorded ("${risk.value}"). Review risk before the patient leaves.`,
    });
  }

  return {
    scaleVersion: SCALE_VERSION,
    fields,
    domains,
    symptom,
    process,
    risk,
    flags,
    course: fields.courseDose?.assessed ? fields.courseDose.display : null,
    interval: fields.sessionInterval?.assessed ? fields.sessionInterval.value : null,
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
 * Cheap fingerprint of the answers a therapist actually typed, used to tell
 * "still being filled in" apart from "already saved, untouched since".
 *
 * Derived keys are excluded on purpose: sessionInterval is measured against a
 * different neighbour for a saved session than for the live form, so including
 * it would make an untouched just-saved form look like a new session and leave
 * a duplicate point on the chart labelled "unsaved".
 */
const FINGERPRINT_KEYS = SCORED_KEYS.filter((k) => !FIELD_SCALE[k].derived);

const fingerprint = (scores) =>
  FINGERPRINT_KEYS.map((k) => (scores.fields[k]?.assessed ? scores.fields[k].display : '')).join(' | ');

/**
 * A session needs this many scored answers before it is drawn as a provisional
 * point. Lower than the MSE scale's five: a short but complete session log
 * legitimately has fewer fields to fill.
 */
export const PROVISIONAL_MIN_FIELDS = 3;

/**
 * Score every saved session oldest → newest, chaining each one's `prev` so the
 * derived interval and the deterioration gates have something to compare with.
 *
 * BOTH sides of every delta are re-scored from stored `data` with the CURRENT
 * scale, so a comparison stays apples-to-apples after the scale is re-weighted.
 *
 * `provisional` is the session being typed right now: shown as the latest point
 * so the therapist watches it take shape, but kept out of the saved trend line
 * so an unsaved half-filled form cannot rewrite the course.
 */
export function buildTrend(sessions = [], { dateKey = 'cbtSessionDate', provisional = null } = {}) {
  const ordered = [...sessions]
    .map((s) => ({
      id: s.id,
      no: s.session_no,
      data: s.data || {},
      dateLabel: (s.data || {})[dateKey] || (s.saved_at ? String(s.saved_at).slice(0, 10) : '—'),
      sortKey: (s.data || {})[dateKey] || s.saved_at || '',
      saved: true,
    }))
    .sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));

  const visits = ordered.map((v, i) => ({
    ...v,
    scores: scoreSession(v.data, i > 0 ? ordered[i - 1].data : null),
  }));

  let current = visits[visits.length - 1] || null;
  const previous = visits[visits.length - 2] || null;

  if (provisional) {
    const last = visits[visits.length - 1];
    // The form still holds whatever was just saved. If its date matches the last
    // saved session it IS that session, so it must be compared with the one
    // before — otherwise the interval would come out as zero days.
    const sameSession =
      last && provisional[dateKey] && String(provisional[dateKey]) === String(last.data[dateKey] ?? '');
    const priorForForm = sameSession ? visits[visits.length - 2] : last;
    const scores = scoreSession(provisional, priorForForm?.data || null);
    const unchanged = last && fingerprint(last.scores) === fingerprint(scores);
    if (scores.coverage.assessed >= PROVISIONAL_MIN_FIELDS && !unchanged) {
      current = {
        id: '__provisional__',
        no: null,
        data: provisional,
        dateLabel: provisional[dateKey] || 'today',
        scores,
        saved: false,
      };
    }
  }

  return {
    visits,                                  // saved only — the trend line
    points: current && !current.saved ? [...visits, current] : visits,
    current,
    previous: current && !current.saved ? visits[visits.length - 1] || null : previous,
  };
}

/** One index's score per session, for its progression chart. */
export const indexSeries = (points = [], which) =>
  points.map((p) => ({
    label: p.dateLabel,
    value: p.scores[which]?.score ?? null,
    band: p.scores[which]?.band ?? null,
    saved: p.saved,
    // Drawn as an open, dashed marker: this point rests at least partly on a
    // clinical impression rather than an administered total.
    inferred: !!p.scores[which]?.inferred,
  }));

export const symptomSeries = (points = []) => indexSeries(points, 'symptom');
export const processSeries = (points = []) => indexSeries(points, 'process');

/** One domain's score per session, for its sparkline. */
export const domainSeries = (points = [], domain) =>
  points.map((p) => ({
    label: p.dateLabel,
    value: p.scores.domains[domain]?.score ?? null,
    band: p.scores.domains[domain]?.band ?? null,
    saved: p.saved,
    inferred: !!p.scores.domains[domain]?.inferred,
  }));

/** Risk level per session, so a spike is visible across the course. */
export const riskSeries = (points = []) =>
  points.map((p) => ({
    label: p.dateLabel,
    value: p.scores.risk.level === null ? null : Math.round((p.scores.risk.level / MAX_SCORE) * 100),
    band: p.scores.risk.band,
    saved: p.saved,
  }));
