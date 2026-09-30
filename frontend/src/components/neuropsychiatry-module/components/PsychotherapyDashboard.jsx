import React, { useMemo, useState } from 'react';
import {
  MUTED,
  colorForBand,
  Chip,
  Delta,
  Sparkline,
  TrendChart,
  DomainCard,
  Header,
} from './AssessmentDashboard';
import {
  INDEXES,
  DOMAIN_ORDER,
  SYMPTOM_DOMAINS,
  PROCESS_DOMAINS,
  RISK_DOMAIN,
  RISK_CAVEAT,
  PROVISIONAL_MIN_FIELDS,
  buildTrend,
  indexSeries,
  domainSeries,
  riskSeries,
  deltaOf,
  modalityDrift,
} from '../context/psychotherapyScale';

// ─────────────────────────────────────────────────────────────────────────────
// PsychotherapyDashboard — a course of therapy, scored and plotted.
//
// Two indices, side by side, never averaged together:
//
//   Symptom Burden   is the patient getting better?
//   Therapy Process  is the therapy itself working?
//
// That separation is the whole point. A patient who arrives every week, does
// every thought record and talks warmly to their therapist scores well on
// process — and can still be exactly as depressed as they were in session one.
// One blended number would report that as "moderate progress" and nobody would
// look again. Two numbers make the gap between them visible, and the gap is the
// clinically interesting part.
//
// Risk sits above both and is inside neither: it is an action threshold, not a
// severity, and averaging it into anything is how it gets missed.
//
// The presentation primitives (chips, deltas, sparklines, the trend chart) are
// imported from AssessmentDashboard rather than copied. The scale, however, is
// entirely separate — context/psychotherapyScale.js — because an examination
// scale and a course-of-treatment scale must be editable independently.
// ─────────────────────────────────────────────────────────────────────────────

const PANEL = { border: '1px solid #e8e8e8', borderRadius: '3px', padding: '11px 12px' };

const short = (s, n = 96) => {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ── One index: score, band, movement since last session, and its own trend ──

const IndexTile = ({ meta, now, before, series, sessionCount }) => {
  const c = colorForBand(now.band);
  const delta = before && before.score !== null && now.score !== null
    ? deltaOf(now.score, before.score)
    : null;

  return (
    <div style={{ ...PANEL, borderTop: `2px solid ${now.score === null ? '#e8e8e8' : c.fg}` }}>
      <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#1a1a1a' }}>{meta.label}</div>
      <div style={{ fontSize: '10px', color: MUTED, marginTop: '2px', minHeight: '26px' }}>
        {meta.caption}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
        <span style={{ fontSize: '27px', fontWeight: 600, lineHeight: 1, color: now.score === null ? '#c4c4c4' : '#1a1a1a' }}>
          {now.score === null ? '—' : now.score}
        </span>
        <span style={{ fontSize: '11.5px', color: MUTED }}>/ 100</span>
        <Chip band={now.band} />
        {delta && <Delta delta={delta} suffix=" pts" />}
      </div>

      <div style={{ fontSize: '10px', color: '#a4a4a4', marginTop: '4px' }}>
        {now.covered} of {now.total} domains scored
        {delta ? ' · change is against the previous session' : ''}
      </div>

      <div style={{ marginTop: '9px' }}>
        {sessionCount < 2 ? (
          <div style={{ fontSize: '11px', color: MUTED, padding: '8px 0' }}>
            First session on record — save a second one and the trend appears here.
          </div>
        ) : (
          <TrendChart series={series} label={meta.label} />
        )}
      </div>
    </div>
  );
};

// ── Risk: pinned above both indices, and part of neither ────────────────────

const RiskStrip = ({ current, previous, points }) => {
  const risk = current.scores.risk;
  const prevRisk = previous?.scores.risk;
  const c = risk.assessed ? colorForBand(risk.band) : null;

  // Not assessed is amber, never green: "we did not ask about suicide" and
  // "there is no suicidal ideation" are different clinical facts.
  const frame = risk.assessed
    ? { border: `1px solid ${c.bd}`, background: c.bg, color: c.fg }
    : { border: '1px solid #f0e2c8', background: '#fdf9f0', color: '#8a5a12' };

  return (
    <div style={{ ...frame, borderRadius: '3px', padding: '10px 12px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.85 }}>
            Suicide / self-harm risk
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '3px' }}>
            {risk.assessed ? risk.value : 'NOT ASSESSED — must be confirmed'}
          </div>
          <div style={{ fontSize: '11px', marginTop: '3px', opacity: 0.9 }}>
            Safety plan:{' '}
            <strong style={{ fontWeight: 600 }}>
              {risk.planValue || 'not recorded'}
            </strong>
            {prevRisk?.assessed && risk.assessed && (
              <>
                {' · previous session: '}
                {prevRisk.value}
              </>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {risk.assessed && <Chip band={risk.band} />}
          <div style={{ marginTop: '6px' }}>
            <Sparkline series={riskSeries(points)} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: '10px', marginTop: '7px', opacity: 0.8, lineHeight: 1.5 }}>
        Excluded from both indices by design. {RISK_CAVEAT}
      </div>
    </div>
  );
};

// ── Safety and deterioration gates ──────────────────────────────────────────

const FlagList = ({ flags }) => {
  if (!flags.length) return null;
  const order = { red: 0, amber: 1 };
  const sorted = [...flags].sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return (
    <div style={{ marginBottom: '12px', display: 'grid', gap: '7px' }}>
      {sorted.map((f, i) => {
        const red = f.level === 'red';
        return (
          <div
            key={i}
            style={{
              border: `1px solid ${red ? '#f3d2d4' : '#f0e2c8'}`,
              background: red ? '#fdf2f2' : '#fdf9f0',
              color: red ? '#a8181f' : '#8a5a12',
              borderRadius: '3px',
              padding: '8px 11px',
              fontSize: '11px',
              lineHeight: 1.55,
            }}
          >
            <strong style={{ fontWeight: 600 }}>
              {red ? 'Action required — ' : ''}
              {f.title}
            </strong>
            <div style={{ marginTop: '2px' }}>{f.detail}</div>
          </div>
        );
      })}
    </div>
  );
};

// ── Per-field detail ────────────────────────────────────────────────────────

const COLS =
  'minmax(150px, 1.7fr) minmax(120px, 1.3fr) minmax(72px, 0.7fr) minmax(104px, 0.9fr) minmax(110px, 1fr) minmax(88px, 0.9fr)';

const FieldTable = ({ current, previous, showUnassessed }) => {
  const order = [...DOMAIN_ORDER, RISK_DOMAIN];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '8px', fontSize: '10px', color: '#a4a4a4', paddingBottom: '4px' }}>
        <span>field</span>
        <span>this session</span>
        <span>band</span>
        <span>benchmark</span>
        <span>previous</span>
        <span>change</span>
      </div>
      {order.map((d) => {
        const dom = current.scores.domains[d];
        if (!dom) return null;
        const rows = (dom.allMembers || dom.members)
          .map((k) => ({ f: current.scores.fields[k], p: previous?.scores.fields[k] }))
          .filter(({ f }) => f && (showUnassessed || f.assessed));
        if (!rows.length) return null;
        return (
          <div key={d} style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#4a4a4a', padding: '5px 0', borderBottom: '1px solid #e8e8e8' }}>
              {dom.label}
              <span style={{ fontWeight: 400, color: MUTED, marginLeft: '7px', fontSize: '10px' }}>
                {dom.index ? INDEXES[dom.index].label : 'not in either index'}
              </span>
            </div>
            {rows.map(({ f, p }) => (
              <div
                key={f.k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  gap: '8px',
                  alignItems: 'center',
                  fontSize: '11.5px',
                  padding: '4px 0',
                  borderBottom: '1px solid #f7f7f7',
                  opacity: f.assessed ? 1 : 0.6,
                }}
              >
                <span style={{ color: '#4a4a4a' }}>
                  {f.label}
                  {f.derived && (
                    <span style={{ color: '#a4a4a4', fontSize: '10px' }}> · derived</span>
                  )}
                  {f.inferred && (
                    <span style={{ color: '#8a5a12', fontSize: '10px' }}> · impression</span>
                  )}
                  {f.detail && (
                    <span style={{ color: MUTED, fontSize: '10px', display: 'block' }}>{f.detail}</span>
                  )}
                </span>
                <span style={{ color: '#1a1a1a' }}>
                  {f.assessed ? short(f.display) || '—' : <span style={{ color: MUTED }}>not assessed</span>}
                </span>
                <span>{f.score !== null ? <Chip band={f.band} /> : null}</span>
                <span style={{ color: MUTED, fontSize: '10.5px' }}>{f.benchmark || '—'}</span>
                <span style={{ color: MUTED, fontSize: '10.5px' }}>{p?.assessed ? short(p.display, 40) : '—'}</span>
                <span>
                  {p?.assessed && f.assessed && f.score !== null && p.score !== null ? (
                    <Delta delta={deltaOf(f.score, p.score)} />
                  ) : (
                    <span style={{ color: '#c4c4c4', fontSize: '10.5px' }}>—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

// ── The dashboard ───────────────────────────────────────────────────────────

const DomainGroup = ({ heading, caption, keys, current, previous, points, focus, setFocus }) => (
  <div style={{ marginBottom: '12px' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
      <strong style={{ fontSize: '11.5px', color: '#1a1a1a' }}>{heading}</strong>
      <span style={{ fontSize: '10px', color: MUTED }}>{caption}</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: '9px' }}>
      {keys.map((d) => (
        <DomainCard
          key={d}
          dom={current.scores.domains[d]}
          prevDom={previous?.scores.domains[d]}
          series={domainSeries(points, d)}
          selected={focus === d}
          onSelect={(k) => setFocus(focus === k ? null : k)}
        />
      ))}
    </div>
  </div>
);

const PsychotherapyDashboard = ({
  sessions = [],
  provisional = null,
  dateKey = 'cbtSessionDate',
  title = 'CBT / Psychotherapy Progress Dashboard',
}) => {
  const [open, setOpen] = useState(true);
  const [focus, setFocus] = useState(null);
  const [showFields, setShowFields] = useState(false);
  const [showUnassessed, setShowUnassessed] = useState(false);

  // Scored only while the panel is open: `provisional` is the live formData, so
  // it changes identity on every keystroke and would otherwise re-score the
  // whole session behind a collapsed panel.
  const trend = useMemo(
    () => (open ? buildTrend(sessions, { dateKey, provisional }) : null),
    [open, sessions, provisional, dateKey]
  );

  const hasAny = (sessions?.length || 0) > 0 || !!provisional;
  if (!hasAny) return null;

  const wrap = { marginBottom: '18px', border: '1px solid #e8e8e8', borderRadius: '4px', background: '#ffffff' };
  const count = sessions?.length || 0;

  if (!open) {
    return (
      <div style={wrap}>
        <Header
          title={title}
          open={false}
          onToggle={() => setOpen(true)}
          summary={count ? `${count} session${count === 1 ? '' : 's'}` : 'no sessions yet'}
        />
      </div>
    );
  }

  if (!trend || !trend.current) {
    return (
      <div style={wrap}>
        <Header title={title} open onToggle={() => setOpen(false)} summary="nothing scored yet" />
        <div style={{ padding: '13px 14px', borderTop: '1px solid #e8e8e8', fontSize: '11.5px', color: MUTED }}>
          No scored findings yet. Record or type up the session below and this dashboard scores it
          live against the benchmark scale — it needs at least {PROVISIONAL_MIN_FIELDS} answered
          fields before it will show an index.
        </div>
      </div>
    );
  }

  const { current, previous, points } = trend;
  const scores = current.scores;
  const drift = modalityDrift(points);
  const cov = scores.coverage;

  // Legend shown only when something on the chart really is an impression, so a
  // course tracked entirely on administered instruments carries no extra caveat.
  const anyInferred = points.some(
    (p) => p.scores.symptom?.inferred || p.scores.process?.inferred
  );

  const summaryBits = [
    scores.symptom.score === null ? 'symptoms —' : `symptoms ${scores.symptom.score}`,
    scores.process.score === null ? 'process —' : `process ${scores.process.score}`,
  ];

  return (
    <div style={wrap}>
      <Header
        title={title}
        open
        onToggle={() => setOpen(false)}
        summary={summaryBits.join(' · ')}
      />

      <div style={{ padding: '13px 14px', borderTop: '1px solid #e8e8e8' }}>
        {/* ── Where in the course this session sits ────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '11.5px',
            color: '#4a4a4a',
            marginBottom: '12px',
          }}
        >
          <div>
            <strong style={{ fontWeight: 600 }}>{current.dateLabel}</strong>
            {current.saved === false && (
              <span style={{ color: '#8a5a12', marginLeft: '6px', fontSize: '10.5px' }}>unsaved</span>
            )}
            {scores.course && <span style={{ color: MUTED }}>{` · ${scores.course}`}</span>}
            {scores.interval !== null && (
              <span style={{ color: MUTED }}>
                {` · ${scores.interval} day${scores.interval === 1 ? '' : 's'} since the previous session`}
              </span>
            )}
          </div>
          <div style={{ color: MUTED, fontSize: '10.5px', textAlign: 'right' }}>
            <div>{previous ? `previous: ${previous.dateLabel}` : 'first session on record'}</div>
            <div>{cov.assessed} of {cov.total} scored fields answered</div>
            {anyInferred && (
              <div style={{ color: '#8a5a12' }}>
                broken markers = clinical impression, not an administered score
              </div>
            )}
          </div>
        </div>

        <RiskStrip current={current} previous={previous} points={points} />
        <FlagList flags={scores.flags} />

        {/* ── The two indices, side by side and never averaged ─────────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <IndexTile
            meta={INDEXES.symptom}
            now={scores.symptom}
            before={previous?.scores.symptom}
            series={indexSeries(points, 'symptom')}
            sessionCount={points.length}
          />
          <IndexTile
            meta={INDEXES.process}
            now={scores.process}
            before={previous?.scores.process}
            series={indexSeries(points, 'process')}
            sessionCount={points.length}
          />
        </div>

        {/* Said plainly, because two tidy numbers invite being quoted as if they
            were validated instruments. They are weighted means, for trend. */}
        <div style={{ fontSize: '10px', color: '#a4a4a4', marginBottom: '14px', lineHeight: 1.55 }}>
          Both indices are weighted means over their domains, on a 0–100 severity scale where
          higher is worse — for trend only, not validated instruments. A picture concentrated in
          one domain is flattened by any mean, so read the domain cards beside the totals. Symptom
          burden and therapy process are kept apart on purpose: strong engagement must never make
          an unimproving patient look better.
        </div>

        <DomainGroup
          heading="Symptom burden"
          caption="the instruments and the mental state · click a card to plot it"
          keys={SYMPTOM_DOMAINS}
          current={current}
          previous={previous}
          points={points}
          focus={focus}
          setFocus={setFocus}
        />
        <DomainGroup
          heading="Therapy process"
          caption="alliance, response, homework and dose"
          keys={PROCESS_DOMAINS}
          current={current}
          previous={previous}
          points={points}
          focus={focus}
          setFocus={setFocus}
        />

        {/* ── One domain, full width, when a card is selected ──────────────── */}
        {focus && (
          <div style={{ ...PANEL, marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
              <strong style={{ fontSize: '12px', color: '#1a1a1a' }}>
                {scores.domains[focus].label}
              </strong>
              <span style={{ fontSize: '10.5px', color: MUTED }}>
                click the card again to close
              </span>
            </div>
            {points.length < 2 ? (
              <div style={{ fontSize: '11.5px', color: MUTED, padding: '8px 0' }}>
                First session on record — save a second one and the trend appears here.
              </div>
            ) : (
              <TrendChart series={domainSeries(points, focus)} label={scores.domains[focus].label} />
            )}
          </div>
        )}

        {/* ── Data quality — stated, never implied ─────────────────────────── */}
        {(cov.criticalMissing.length > 0 || cov.unmapped.length > 0 || drift) && (
          <div
            style={{
              border: '1px solid #f0e2c8',
              background: '#fdf9f0',
              borderRadius: '3px',
              padding: '9px 11px',
              fontSize: '11px',
              color: '#8a5a12',
              marginBottom: '12px',
              lineHeight: 1.6,
            }}
          >
            {cov.criticalMissing.length > 0 && (
              <div>
                <strong style={{ fontWeight: 600 }}>Not assessed (must be confirmed):</strong>{' '}
                {cov.criticalMissing.join(', ')}
              </div>
            )}
            {cov.unmapped.length > 0 && (
              <div>
                <strong style={{ fontWeight: 600 }}>Unrecognised values, excluded from every score:</strong>{' '}
                {cov.unmapped.join(', ')} — the benchmark scale needs updating for these.
              </div>
            )}
            {drift && (
              <div>
                <strong style={{ fontWeight: 600 }}>Modality and technique do not match:</strong>{' '}
                {drift.detail}
              </div>
            )}
          </div>
        )}

        {/* ── All fields ──────────────────────────────────────────────────── */}
        <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: '9px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowFields((s) => !s)}
              style={{
                border: '1px solid #d4d4d4',
                borderRadius: '2px',
                background: '#ffffff',
                color: '#4a4a4a',
                fontFamily: 'inherit',
                fontSize: '11.5px',
                padding: '5px 11px',
                cursor: 'pointer',
              }}
            >
              {showFields ? 'Hide field-by-field values' : 'Field-by-field values'}
            </button>
            {showFields && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#4a4a4a', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showUnassessed}
                  onChange={(e) => setShowUnassessed(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                include everything left blank
              </label>
            )}
          </div>
          {showFields && (
            <div style={{ marginTop: '10px' }}>
              <FieldTable current={current} previous={previous} showUnassessed={showUnassessed} />
            </div>
          )}
        </div>

        <div style={{ fontSize: '10px', color: '#b4b4b4', marginTop: '10px', lineHeight: 1.55 }}>
          Scored with benchmark scale {scores.scaleVersion}. Bands and weights are
          clinician-editable in context/psychotherapyScale.js and require sign-off before clinical
          use — several cut-points on it have no published equivalent and are listed at the top of
          that file.
        </div>
      </div>
    </div>
  );
};

export default PsychotherapyDashboard;
