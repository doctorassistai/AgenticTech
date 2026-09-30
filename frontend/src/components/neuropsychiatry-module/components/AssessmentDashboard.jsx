import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DOMAIN_ORDER,
  RISK_DOMAIN,
  FIELD_SCALE,
  SCORED_KEYS,
  BANDS,
  bandRanges,
  buildTrend,
  compositeSeries,
  domainSeries,
  deltaOf,
} from '../context/clinicalScale';

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDashboard — the analytical view of an assessment over time.
//
// Three questions, in the order a clinician asks them:
//   1. Is anyone at risk right now?          → RiskPanel, pinned to the top
//   2. How ill is this patient, and where?   → domain cards vs the benchmark
//   3. Is this better or worse than before?  → trend chart + per-field deltas
//
// Everything it shows is DERIVED — scored from each session's stored `data` by
// clinicalScale.js. Nothing here is persisted, so re-weighting the scale
// re-draws history instead of leaving old numbers stranded, and both sides of
// every delta are always scored by the same instrument.
//
// Deliberately dependency-free: the charts are hand-rolled SVG, matching the
// rest of the module (no icon library, no chart library, inline styles).
// ─────────────────────────────────────────────────────────────────────────────

// One colour per severity band, indexed by score, plus a neutral for
// "not assessed" — which must never be mistaken for the green of "normal".
//
// The pieces below are `export`ed purely so a second dashboard on a different
// benchmark scale can reuse them rather than fork them. Nothing about MSE's own
// render path changes: they are the same declarations, in the same order, used
// the same way. TrendChart in particular must be shared, not copied — it
// carries the fix for the viewBox-scaling bug (measure the container, draw in
// real CSS pixels), and a duplicate would need that fix maintained twice.
export const BAND_COLOR = [
  { bg: '#eef6ee', fg: '#1e6b32', bd: '#cfe5d2' }, // Normal
  { bg: '#f4f7e9', fg: '#5f6b1e', bd: '#e3e8cd' }, // Borderline
  { bg: '#fdf6e8', fg: '#8a5a12', bd: '#f0e2c8' }, // Mild
  { bg: '#fdf0e6', fg: '#a8531f', bd: '#f3ddcb' }, // Moderate
  { bg: '#fdf2f2', fg: '#a8181f', bd: '#f3d2d4' }, // Severe
];
export const NEUTRAL = { bg: '#f7f7f7', fg: '#7a7a7a', bd: '#e8e8e8' };
export const WORSE = '#a8181f';
export const BETTER = '#1e6b32';
export const MUTED = '#7a7a7a';

export const colorForBand = (band) => {
  const i = BANDS.indexOf(band);
  return i < 0 ? NEUTRAL : BAND_COLOR[i];
};

// ── Small presentational pieces ──────────────────────────────────────────────

export const Chip = ({ band, children, title }) => {
  const c = colorForBand(band);
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: '2px',
        fontSize: '10.5px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
      }}
    >
      {children || band || 'Not assessed'}
    </span>
  );
};

/**
 * A change in severity. Direction is stated in words as well as an arrow — an
 * arrow alone is ambiguous when the underlying scale can be either polarity.
 */
export const Delta = ({ delta, suffix = '' }) => {
  if (!delta) return <span style={{ color: MUTED, fontSize: '10.5px' }}>—</span>;
  if (delta.dir === 'same') {
    return <span style={{ color: MUTED, fontSize: '10.5px' }}>no change</span>;
  }
  const worse = delta.dir === 'worse';
  return (
    <span style={{ color: worse ? WORSE : BETTER, fontSize: '10.5px', fontWeight: 500 }}>
      {worse ? '▲' : '▼'} {delta.label}
      {suffix} {worse ? 'worse' : 'better'}
    </span>
  );
};

/** Tiny inline trend, one domain across visits. Gaps are breaks, not zeros. */
export const Sparkline = ({ series, width = 92, height = 24 }) => {
  const pts = series.filter((s) => s.value !== null && s.value !== undefined);
  if (pts.length < 2) {
    return <span style={{ color: '#c4c4c4', fontSize: '10px' }}>—</span>;
  }
  const n = series.length;
  const x = (i) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2);
  const y = (v) => height - 3 - (v / 100) * (height - 6);

  const segments = [];
  let run = [];
  series.forEach((s, i) => {
    if (s.value === null || s.value === undefined) {
      if (run.length > 1) segments.push(run);
      run = [];
      return;
    }
    run.push(`${x(i)},${y(s.value)}`);
  });
  if (run.length > 1) segments.push(run);

  const last = series[n - 1];
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <line x1="0" y1={y(0)} x2={width} y2={y(0)} stroke="#f0f0f0" strokeWidth="1" />
      {segments.map((seg, i) => (
        <polyline
          key={i}
          points={seg.join(' ')}
          fill="none"
          stroke="#4a4a4a"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      ))}
      {last && last.value !== null && last.value !== undefined && (
        <circle
          cx={x(n - 1)}
          cy={y(last.value)}
          r="2.6"
          fill={last.saved === false ? '#ffffff' : '#1a1a1a'}
          stroke="#1a1a1a"
          strokeWidth="1.2"
          // Same convention as the trend chart's markers: a broken ring means the
          // latest value is a clinical impression, not an administered score.
          strokeDasharray={last.inferred ? '1.6 1.2' : undefined}
        />
      )}
    </svg>
  );
};

/**
 * Width of an element in real CSS pixels, kept current as the layout changes.
 *
 * The chart needs this because an SVG drawn in viewBox units and stretched to
 * width="100%" scales EVERYTHING by the ratio between the two. At 640 units in
 * a 1560px column that is 2.4x, so 9px axis labels rendered at 22px, the dots
 * at 10px, the line at 4px, and the last date ran off the right edge. Drawing
 * at the measured width instead makes one unit one pixel, so the chart's type
 * sits at the same size as the text around it and the padding means what it says.
 */
export const useMeasuredWidth = (ref, fallback = 640) => {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setW(Math.max(300, Math.round(el.clientWidth || fallback)));
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-08-24" → "24 Aug", which is what fits under a data point. Parsed off
 * the string rather than through Date, so a date-only value cannot shift a day
 * either way across a timezone boundary. A value that is not an ISO date — the
 * provisional visit says "today" — passes through as itself.
 */
export const shortDate = (label, withYear = false) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(label || ''));
  if (!m) return String(label || '—').slice(0, 12);
  const d = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim();
  return withYear ? `${d} '${m[1].slice(2)}` : d;
};

/**
 * The progression chart. Y is severity 0–100, so UP IS WORSE everywhere on this
 * dashboard — the one convention that has to hold, since the underlying fields
 * point in both directions (MMSE 30 is good, AIMS 30 is not).
 *
 * The severity bands are painted as horizontal zones behind the line, because
 * that is what a clinician reads off a trend: not "47 became 10" but "he came
 * down out of Mild into Normal". Zone edges come from bandRanges(), i.e. from
 * the scale's own banding, so they cannot disagree with the band chips.
 *
 * An unsaved examination is drawn as a hollow point on a dashed leg, so a
 * half-finished form is visibly not yet part of the record.
 */
export const TrendChart = ({ series, label }) => {
  const box = useRef(null);
  const W = useMeasuredWidth(box);
  const [hover, setHover] = useState(null);

  const H = 190;
  const PAD = { t: 16, r: 62, b: 34, l: 30 };
  // Points are held off the frame edge, so the first and last never sit on the
  // border and their labels have somewhere to go.
  const INSET = 12;
  const iw = Math.max(60, W - PAD.l - PAD.r);
  const ih = H - PAD.t - PAD.b;
  const n = series.length;
  const pw = Math.max(1, iw - INSET * 2);
  const x = (i) => (n === 1 ? PAD.l + iw / 2 : PAD.l + INSET + (i / (n - 1)) * pw);
  const y = (v) => PAD.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

  const solid = [];
  const dashed = [];
  series.forEach((s, i) => {
    if (s.value === null || s.value === undefined) return;
    const p = `${x(i)},${y(s.value)}`;
    if (s.saved === false) {
      const prev = series[i - 1];
      if (prev && prev.value !== null && prev.value !== undefined) {
        dashed.push(`${x(i - 1)},${y(prev.value)}`, p);
      }
    } else {
      solid.push(p);
    }
  });

  // Crowded labels are thinned, never shrunk or rotated: an unreadable date is
  // worse than an absent one. First, last and hovered visits always show.
  const multiYear = new Set(series.map((s) => String(s.label || '').slice(0, 4))).size > 1;
  const stride = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 58))));
  const showDate = (i) => i === 0 || i === n - 1 || i === hover || i % stride === 0;
  const showValue = (i) => n <= 6 || i === 0 || i === n - 1 || i === hover;
  // Anchoring the end points inward is what stops the first value colliding
  // with the y-axis and the last date being clipped by the panel edge.
  const anchorAt = (i) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');

  const real = series.filter((s) => s.value !== null && s.value !== undefined);
  const latest = real[real.length - 1] || null;
  const prior = real.length > 1 ? real[real.length - 2] : null;
  // The caption's delta is against the PREVIOUS examination, not the first.
  // A first-to-last comparison reports "better" straight through a relapse —
  // 47 down to 10 and back up to 45 is a 2-point improvement and a crisis.
  const leg = latest && prior ? deltaOf(latest.value, prior.value) : null;
  const lo = real.length ? Math.min(...real.map((s) => s.value)) : null;
  const hi = real.length ? Math.max(...real.map((s) => s.value)) : null;

  return (
    <div ref={box} style={{ width: '100%', overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {bandRanges().map((z) => {
          const c = colorForBand(z.band);
          const top = y(z.to);
          const bottom = y(z.from);
          return (
            <g key={z.band}>
              <rect x={PAD.l} y={top} width={iw} height={Math.max(0, bottom - top)} fill={c.bg} />
              <line x1={PAD.l} y1={top} x2={PAD.l + iw} y2={top} stroke="#ffffff" strokeWidth="1" />
              <text x={PAD.l + iw + 8} y={(top + bottom) / 2 + 3.2} fontSize="9.5" fill={c.fg}>
                {z.band}
              </text>
            </g>
          );
        })}
        <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="none" stroke="#e8e8e8" strokeWidth="1" />

        {/* Numeric anchors only — the zones carry the meaning */}
        {[0, 50, 100].map((g) => (
          <text key={g} x={PAD.l - 6} y={y(g) + 3.2} textAnchor="end" fontSize="8.5" fill="#b4b4b4">
            {g}
          </text>
        ))}

        {solid.length > 1 && (
          <polyline
            points={solid.join(' ')}
            fill="none"
            stroke="#2f2f2f"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {dashed.length > 1 && (
          <polyline
            points={dashed.join(' ')}
            fill="none"
            stroke="#8a8a8a"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            strokeLinecap="round"
          />
        )}

        {series.map((s, i) => {
          if (s.value === null || s.value === undefined) return null;
          const c = colorForBand(s.band);
          const cx = x(i);
          const cy = y(s.value);
          const on = hover === i;
          const unsaved = s.saved === false;
          return (
            <g key={i}>
              {on && (
                <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t + ih} stroke="#c0c0c0" strokeWidth="1" strokeDasharray="2 3" />
              )}
              {/* White collar, so a point stays legible against its zone tint */}
              <circle cx={cx} cy={cy} r={on ? 6.2 : 5} fill="#ffffff" />
              <circle
                cx={cx}
                cy={cy}
                r={on ? 4.6 : 3.6}
                fill={unsaved ? '#ffffff' : c.fg}
                stroke={unsaved ? MUTED : c.fg}
                strokeWidth="1.5"
                // A broken ring marks a point that rests on a clinical impression
                // read from the consultation rather than an administered score.
                // Distinct from the hollow "unsaved" marker, and additive: a
                // series that never sets `inferred` draws exactly as before.
                strokeDasharray={s.inferred ? '2 1.6' : undefined}
              />
              {showValue(i) && (
                <text
                  x={cx}
                  y={cy < PAD.t + 18 ? cy + 16 : cy - 11}
                  textAnchor={anchorAt(i)}
                  fontSize="10.5"
                  fontWeight="600"
                  fill="#1a1a1a"
                >
                  {s.value}
                </text>
              )}
              {showDate(i) && (
                <text x={cx} y={H - 13} textAnchor={anchorAt(i)} fontSize="9.5" fill={on ? '#1a1a1a' : MUTED}>
                  {shortDate(s.label, multiYear)}
                </text>
              )}
              {unsaved && (
                <text x={cx} y={H - 3} textAnchor={anchorAt(i)} fontSize="8.5" fill="#a4a4a4">
                  unsaved
                </text>
              )}
            </g>
          );
        })}

        {/* Hit targets last, so every point is hoverable regardless of draw order */}
        {series.map((s, i) =>
          s.value === null || s.value === undefined ? null : (
            <circle
              key={`hit-${i}`}
              cx={x(i)}
              cy={y(s.value)}
              r="14"
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              <title>
                {`${shortDate(s.label, true)} · ${s.value}/100 · ${s.band || 'not scored'}`}
                {s.saved === false ? ' · unsaved' : ''}
                {s.inferred ? ' · clinical impression, not administered' : ''}
              </title>
            </circle>
          )
        )}
      </svg>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          fontSize: '10.5px',
          color: MUTED,
          marginTop: '5px',
        }}
      >
        <span>{label} · higher is more severe</span>
        {latest && (
          <span>
            {`${real.length} examination${real.length === 1 ? '' : 's'} · latest `}
            <strong style={{ color: '#1a1a1a', fontWeight: 600 }}>{latest.value}</strong>
            {` (${shortDate(latest.label, multiYear)})`}
            {leg && (
              <>
                {' · '}
                <Delta delta={leg} suffix=" pts" />
                {` since ${shortDate(prior.label, multiYear)}`}
              </>
            )}
            {real.length > 2 && lo !== hi && ` · range ${lo}–${hi}`}
          </span>
        )}
      </div>
    </div>
  );
};

// ── Risk: its own panel, above everything else ───────────────────────────────

/**
 * Risk is never folded into the composite score and never inferred from
 * silence. An unanswered risk field shows as NOT ASSESSED in amber, because
 * "we did not ask about suicide" and "there is no suicidal ideation" are
 * different clinical facts and the dashboard must not blur them.
 */
const RiskPanel = ({ current, previous }) => {
  const keys = SCORED_KEYS.filter((k) => FIELD_SCALE[k].domain === RISK_DOMAIN);
  const dom = current.scores.domains[RISK_DOMAIN];
  const prevDom = previous?.scores.domains[RISK_DOMAIN];
  const protective = current.scores.fields.protectiveFactors;
  const worst = keys
    .map((k) => current.scores.fields[k])
    .filter((f) => f?.assessed)
    .reduce((a, f) => (a === null || f.score > a.score ? f : a), null);
  const alarming = (worst?.score ?? 0) >= 3;

  return (
    <div
      style={{
        border: `1px solid ${alarming ? '#f3d2d4' : '#e8e8e8'}`,
        borderLeft: `3px solid ${alarming ? WORSE : '#d4d4d4'}`,
        borderRadius: '3px',
        background: alarming ? '#fffbfb' : '#ffffff',
        padding: '11px 13px',
        marginBottom: '14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '10px', marginBottom: '9px' }}>
        <strong style={{ fontSize: '12.5px', color: alarming ? WORSE : '#1a1a1a' }}>
          {alarming ? '⚠ ' : ''}Risk
        </strong>
        <Chip band={dom.band}>{dom.band || 'Not assessed'}{dom.score !== null ? ` · ${dom.score}` : ''}</Chip>
        <span style={{ fontSize: '10.5px', color: MUTED }}>
          {dom.covered} of {dom.total} assessed
        </span>
        {previous && <Delta delta={deltaOf(dom.score, prevDom?.score)} suffix=" pts" />}
      </div>

      <div style={{ display: 'grid', gap: '5px' }}>
        {keys.map((k) => {
          const f = current.scores.fields[k];
          const p = previous?.scores.fields[k];
          if (!f) return null;
          return (
            <div
              key={k}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(150px, 1.6fr) minmax(96px, 0.9fr) minmax(74px, 0.7fr) minmax(90px, 0.8fr) minmax(96px, 0.9fr)',
                gap: '8px',
                alignItems: 'center',
                fontSize: '11.5px',
                padding: '3px 0',
                borderTop: '1px solid #f4f4f4',
              }}
            >
              <span style={{ color: '#4a4a4a' }}>
                {f.label}
                {f.inferred && (
                  <span style={{ color: '#8a5a12', fontSize: '10px' }}> · impression</span>
                )}
              </span>
              {f.assessed ? (
                <Chip band={f.band}>{f.display}</Chip>
              ) : (
                <span style={{ color: '#8a5a12', fontSize: '10.5px', fontWeight: 500 }}>NOT ASSESSED</span>
              )}
              <span style={{ color: MUTED, fontSize: '10.5px' }}>
                {f.assessed ? f.band : ''}
              </span>
              <span style={{ color: MUTED, fontSize: '10.5px' }} title="benchmark — no abnormality">
                vs {f.benchmark || '—'}
              </span>
              <span>
                {p?.assessed && f.assessed ? (
                  <Delta delta={deltaOf(f.score, p.score)} />
                ) : (
                  <span style={{ color: '#c4c4c4', fontSize: '10.5px' }}>
                    {p?.assessed ? `was ${p.display}` : 'no prior'}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '8px', fontSize: '11px', color: '#4a4a4a', borderTop: '1px solid #f4f4f4', paddingTop: '7px' }}>
        <strong style={{ fontWeight: 600 }}>Protective factors:</strong>{' '}
        {protective?.assessed ? (
          protective.display
        ) : (
          <span style={{ color: MUTED }}>none recorded</span>
        )}
      </div>
    </div>
  );
};

// ── Domain cards ─────────────────────────────────────────────────────────────

export const DomainCard = ({ dom, prevDom, series, onSelect, selected }) => {
  const c = colorForBand(dom.band);
  const covered = dom.total ? Math.round((dom.covered / dom.total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(dom.key)}
      style={{
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        border: `1px solid ${selected ? '#1a1a1a' : '#e8e8e8'}`,
        borderTop: `2px solid ${dom.score === null ? '#e8e8e8' : c.fg}`,
        borderRadius: '3px',
        background: '#ffffff',
        padding: '9px 10px',
      }}
    >
      {/* Spans, not divs: the card is a <button>, whose content model is
          phrasing content only. Same layout, valid markup. */}
      <span style={{ display: 'block', fontSize: '11px', color: '#4a4a4a', marginBottom: '5px' }}>{dom.label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' }}>
        <span style={{ fontSize: '21px', fontWeight: 600, color: dom.score === null ? '#c4c4c4' : '#1a1a1a', lineHeight: 1 }}>
          {dom.score === null ? '—' : dom.score}
        </span>
        <Sparkline series={series} />
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '7px', flexWrap: 'wrap' }}>
        <Chip band={dom.band} />
        {prevDom && prevDom.score !== null && dom.score !== null && (
          <Delta delta={deltaOf(dom.score, prevDom.score)} suffix=" pts" />
        )}
      </span>
      {/* Coverage is shown as a bar, not buried in text: a 90 out of a domain
          where only 2 of 15 fields were assessed is not the same finding as a
          90 across all 15, and the reader has to be able to see which. */}
      <span style={{ display: 'block', marginTop: '7px' }}>
        <span style={{ display: 'block', height: '3px', background: '#f0f0f0', borderRadius: '2px', overflow: 'hidden' }}>
          <span style={{ display: 'block', width: `${covered}%`, height: '100%', background: covered === 100 ? '#cfe5d2' : '#e8d9bb' }} />
        </span>
        <span style={{ display: 'block', fontSize: '10px', color: MUTED, marginTop: '3px' }}>
          {dom.covered} of {dom.total} assessed
        </span>
      </span>
    </button>
  );
};

// ── Per-field detail ─────────────────────────────────────────────────────────

// One template for the legend and every row, so they cannot drift apart.
const FIELD_COLS =
  'minmax(150px, 1.7fr) minmax(120px, 1.3fr) minmax(72px, 0.7fr) minmax(96px, 0.9fr) minmax(110px, 1fr) minmax(90px, 0.9fr)';

const FieldTable = ({ current, previous, showUnassessed }) => {
  const order = [...DOMAIN_ORDER, RISK_DOMAIN];
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: FIELD_COLS,
          gap: '8px',
          fontSize: '10px',
          color: '#a4a4a4',
          paddingBottom: '4px',
        }}
      >
        <span>field</span>
        <span>this visit</span>
        <span>band</span>
        <span>benchmark</span>
        <span>previous</span>
        <span>change</span>
      </div>
      {order.map((d) => {
        const dom = current.scores.domains[d];
        const rows = dom.members
          .map((k) => ({ f: current.scores.fields[k], p: previous?.scores.fields[k] }))
          .filter(({ f }) => f && (showUnassessed || f.assessed));
        if (!rows.length) return null;
        return (
          <div key={d} style={{ marginBottom: '12px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#4a4a4a',
                padding: '5px 0',
                borderBottom: '1px solid #e8e8e8',
              }}
            >
              {dom.label}
            </div>
            {rows.map(({ f, p }) => (
              <div
                key={f.k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: FIELD_COLS,
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
                  {f.inferred && (
                    <span style={{ color: '#8a5a12', fontSize: '10px' }}> · impression</span>
                  )}
                  {f.detail && (
                    <span style={{ color: MUTED, fontSize: '10px', display: 'block' }}>{f.detail}</span>
                  )}
                </span>
                <span style={{ color: '#1a1a1a' }}>
                  {f.assessed ? f.display || '—' : <span style={{ color: MUTED }}>not assessed</span>}
                </span>
                <span>{f.score !== null ? <Chip band={f.band} /> : null}</span>
                <span style={{ color: MUTED, fontSize: '10.5px' }}>{f.benchmark || '—'}</span>
                <span style={{ color: MUTED, fontSize: '10.5px' }}>
                  {p?.assessed ? p.display : '—'}
                </span>
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

// ── The dashboard ────────────────────────────────────────────────────────────

const AssessmentDashboard = ({
  sessions = [],
  provisional = null,
  dateKey = 'mseDate',
  title = 'Assessment Dashboard',
}) => {
  const [open, setOpen] = useState(true);
  const [focus, setFocus] = useState('composite');
  const [showFields, setShowFields] = useState(false);
  const [showUnassessed, setShowUnassessed] = useState(false);

  // Scored only while the panel is open: `provisional` is the live formData, so
  // it changes identity on every keystroke and would otherwise re-score the
  // whole examination behind a collapsed panel.
  const trend = useMemo(
    () => (open ? buildTrend(sessions, { dateKey, provisional }) : null),
    [open, sessions, provisional, dateKey]
  );

  const hasAny = (sessions?.length || 0) > 0 || !!provisional;
  if (!hasAny) return null;

  const wrap = {
    marginBottom: '18px',
    border: '1px solid #e8e8e8',
    borderRadius: '4px',
    background: '#ffffff',
  };
  const count = sessions?.length || 0;

  if (!open) {
    return (
      <div style={wrap}>
        <Header
          title={title}
          open={false}
          onToggle={() => setOpen(true)}
          summary={count ? `${count} examination${count === 1 ? '' : 's'}` : 'no examinations yet'}
        />
      </div>
    );
  }

  // Open, but nothing scoreable yet — a fresh record, or a form with only a
  // date filled in. Say so rather than showing a 0, which would read as
  // "examined, and normal".
  if (!trend || !trend.current) {
    return (
      <div style={wrap}>
        <Header title={title} open onToggle={() => setOpen(false)} summary="nothing scored yet" />
        <div style={{ padding: '13px 14px', borderTop: '1px solid #e8e8e8', fontSize: '11.5px', color: MUTED }}>
          No scored findings yet. Dictate or fill in the examination below and this dashboard
          scores it live against the benchmark scale — it needs at least five answered fields
          before it will show a severity index.
        </div>
      </div>
    );
  }

  const { current, previous, points } = trend;
  const comp = current.scores.composite;
  const prevComp = previous?.scores.composite;
  const cov = current.scores.coverage;

  const series =
    focus === 'composite'
      ? compositeSeries(points).map((s, i) => ({ ...s, band: points[i].scores.composite.band }))
      : domainSeries(points, focus).map((s, i) => ({ ...s, band: points[i].scores.domains[focus]?.band }));

  return (
    <div style={wrap}>
      <Header
        title={title}
        open
        onToggle={() => setOpen(false)}
        summary={`${comp.score === null ? '—' : comp.score}/100 · ${comp.band || 'not scored'}`}
      />

      <div style={{ padding: '13px 14px', borderTop: '1px solid #e8e8e8' }}>
        {/* ── Headline: where this visit sits, and against what ────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '14px',
            marginBottom: '14px',
          }}
        >
          <div>
            <div style={{ fontSize: '10.5px', color: MUTED, marginBottom: '2px' }}>
              Composite severity index
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px' }}>
              <span style={{ fontSize: '30px', fontWeight: 600, color: '#1a1a1a', lineHeight: 1 }}>
                {comp.score === null ? '—' : comp.score}
              </span>
              <span style={{ fontSize: '12px', color: MUTED }}>/ 100</span>
              <Chip band={comp.band} />
              {prevComp && prevComp.score !== null && comp.score !== null && (
                <Delta delta={deltaOf(comp.score, prevComp.score)} suffix=" pts" />
              )}
            </div>
            {/* Said plainly, because a single number across nine domains invites
                being quoted as if it were a validated instrument. It is not. */}
            <div style={{ fontSize: '10px', color: '#a4a4a4', marginTop: '4px', maxWidth: '380px' }}>
              A weighted mean of the clinical domains, for trend only — not a validated
              instrument. Risk is excluded by design and shown separately.
            </div>
          </div>

          <div style={{ textAlign: 'right', fontSize: '11px', color: '#4a4a4a' }}>
            <div>
              <strong style={{ fontWeight: 600 }}>{current.dateLabel}</strong>
              {current.saved === false && (
                <span style={{ color: '#8a5a12', marginLeft: '6px', fontSize: '10.5px' }}>
                  unsaved
                </span>
              )}
            </div>
            <div style={{ color: MUTED, fontSize: '10.5px', marginTop: '2px' }}>
              {previous ? `previous: ${previous.dateLabel}` : 'first examination'}
            </div>
            <div style={{ color: MUTED, fontSize: '10.5px' }}>
              {cov.assessed} of {cov.total} fields assessed
            </div>
            {current.scores.composite?.inferred && (
              <div style={{ color: '#8a5a12', fontSize: '10.5px' }}>
                broken markers = clinical impression, not an administered score
              </div>
            )}
          </div>
        </div>

        <RiskPanel current={current} previous={previous} />

        {/* ── Domain cards — click one to plot it ──────────────────────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
            gap: '9px',
            marginBottom: '14px',
          }}
        >
          {DOMAIN_ORDER.map((d) => (
            <DomainCard
              key={d}
              dom={current.scores.domains[d]}
              prevDom={previous?.scores.domains[d]}
              series={domainSeries(points, d)}
              selected={focus === d}
              onSelect={(k) => setFocus(focus === k ? 'composite' : k)}
            />
          ))}
        </div>

        {/* ── Progression ─────────────────────────────────────────────────── */}
        <div style={{ border: '1px solid #e8e8e8', borderRadius: '3px', padding: '11px 12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
            <strong style={{ fontSize: '12px', color: '#1a1a1a' }}>Progression</strong>
            <span style={{ fontSize: '10.5px', color: MUTED }}>
              {focus === 'composite' ? 'composite index' : current.scores.domains[focus].label}
              {focus !== 'composite' && ' · click the card again for the composite'}
            </span>
          </div>
          {points.length < 2 ? (
            <div style={{ fontSize: '11.5px', color: MUTED, padding: '10px 0' }}>
              First examination on record — save a second one and the trend appears here.
            </div>
          ) : (
            <TrendChart
              series={series}
              label={focus === 'composite' ? 'Composite severity index' : current.scores.domains[focus].label}
            />
          )}
        </div>

        {/* ── Data quality — stated, never implied ────────────────────────── */}
        {(cov.criticalMissing.length > 0 || cov.unmapped.length > 0) && (
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
              {showFields ? 'Hide field-by-field values' : `Field-by-field values (${cov.assessed})`}
            </button>
            {showFields && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#4a4a4a', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showUnassessed}
                  onChange={(e) => setShowUnassessed(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                include the {cov.total - cov.assessed} not assessed
              </label>
            )}
          </div>
          {showFields && (
            <div style={{ marginTop: '10px' }}>
              <FieldTable current={current} previous={previous} showUnassessed={showUnassessed} />
            </div>
          )}
        </div>

        <div style={{ fontSize: '10px', color: '#b4b4b4', marginTop: '10px' }}>
          Scored with benchmark scale {current.scores.scaleVersion}. Bands and weights are
          clinician-editable in context/clinicalScale.js and require sign-off before clinical use.
        </div>
      </div>
    </div>
  );
};

export const Header = ({ title, open, onToggle, summary }) => (
  <button
    type="button"
    onClick={onToggle}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      width: '100%',
      border: 'none',
      borderRadius: open ? '4px 4px 0 0' : '4px',
      padding: '10px 14px',
      background: '#fafafa',
      fontFamily: 'inherit',
      cursor: 'pointer',
      textAlign: 'left',
    }}
  >
    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a1a' }}>
      {title}
      <span style={{ marginLeft: '9px', fontWeight: 400, color: MUTED, fontSize: '11.5px' }}>
        {summary}
      </span>
    </span>
    <span style={{ color: '#7a7a7a', fontSize: '10px' }}>{open ? '▲' : '▼'}</span>
  </button>
);

export default AssessmentDashboard;
