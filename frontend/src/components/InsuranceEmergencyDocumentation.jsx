import React, { useState, useCallback } from 'react';

const API_BASE = 'https://doctorassist.ai/api';

// ── Spinner ───────────────────────────────────────────────────────────────────
const Spin = ({ size = 18, color = '#000' }) => (
  <span style={{
    display: 'inline-block', width: size, height: size,
    border: `2px solid ${color}22`, borderTopColor: color,
    borderRadius: '50%', animation: 'ins-spin .6s linear infinite', flexShrink: 0,
  }} />
);

// ── Utilities ─────────────────────────────────────────────────────────────────
const getPath = (obj, path) =>
  path.split('.').reduce((acc, k) => (acc != null ? acc[k] : undefined), obj);

const setPath = (obj, path, value) => {
  const next = JSON.parse(JSON.stringify(obj));
  const keys = path.split('.');
  let ref = next;
  for (let i = 0; i < keys.length - 1; i++) {
    if (ref[keys[i]] == null) ref[keys[i]] = {};
    ref = ref[keys[i]];
  }
  ref[keys[keys.length - 1]] = value;
  return next;
};

const hasValue = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
};

const fmt = (v) => {
  if (!hasValue(v)) return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

// ── Timestamp formatter — converts any ISO/date string to readable IST ────────
const fmtTimestamp = (val) => {
  if (!val) return val;
  const str = String(val);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: true,
        }) + ' IST';
      }
    } catch (e) { /* fall through */ }
  }
  return str;
};

const IST_OPTIONS = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
const nowIST = () => new Date().toLocaleString('en-IN', IST_OPTIONS).replace(',', '') + ' IST';

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', fontSize: 13, border: '1.5px solid #cbd5e1',
  borderRadius: 4, padding: '6px 9px', boxSizing: 'border-box',
  fontFamily: "'DM Sans', sans-serif", background: '#fffef8',
  outline: 'none', transition: 'border-color 0.15s',
};
const textareaStyle = {
  ...inputStyle, resize: 'vertical', lineHeight: 1.6,
};

// ── Section Heading ───────────────────────────────────────────────────────────
const SecHead = ({ children }) => (
  <div style={{
    gridColumn: '1 / -1',
    display: 'flex', alignItems: 'center', gap: 12,
    marginTop: 28, marginBottom: 6,
  }}>
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '1.4px',
      textTransform: 'uppercase', color: '#000', whiteSpace: 'nowrap',
    }}>{children}</span>
    <span style={{ flex: 1, height: '1px', background: '#000' }} />
  </div>
);

// ── Universal Cell — ALWAYS editable in edit mode ─────────────────────────────
const Cell = ({ label, value, path, editMode, onChange, fullWidth = false, type = 'auto' }) => {
  const isArr = Array.isArray(value);
  const isBool = typeof value === 'boolean';

  if (!editMode && !hasValue(value)) return null;

  const display = fmt(value);

  const renderEditor = () => {
    if (type === 'select' || isBool) {
      return (
        <select
          value={String(value ?? 'false')}
          onChange={e => {
            const v = e.target.value;
            onChange(path, v === 'true' ? true : v === 'false' ? false : v);
          }}
          style={inputStyle}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    if (isArr) {
      return (
        <textarea
          value={(value || []).join('\n')}
          onChange={e => onChange(path, e.target.value ? e.target.value.split('\n') : [])}
          rows={Math.max(2, (value || []).length + 1)}
          style={textareaStyle}
          placeholder={`Enter each ${label.toLowerCase()} on a new line`}
        />
      );
    }
    const strVal = value != null ? String(value) : '';
    const rows = Math.max(1, Math.ceil(strVal.length / 70));
    return (
      <textarea
        value={strVal}
        onChange={e => onChange(path, e.target.value)}
        rows={rows > 3 ? rows : 1}
        style={rows > 1 ? textareaStyle : inputStyle}
        placeholder={`Enter ${label.toLowerCase()}`}
      />
    );
  };

  return (
    <div style={{
      gridColumn: fullWidth ? '1 / -1' : undefined,
      borderBottom: '1px solid #e8e8e8',
      paddingBottom: 10, paddingTop: 6,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.9px',
        textTransform: 'uppercase', marginBottom: 4,
      }}>{label}</div>
      {editMode ? renderEditor() : (
        <div style={{ fontSize: 13, color: '#111', lineHeight: 1.6 }}>
          {isArr ? (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {value.map((item, i) => <li key={i} style={{ marginBottom: 3 }}>{item}</li>)}
            </ul>
          ) : display}
        </div>
      )}
    </div>
  );
};

// ── ICD codes ─────────────────────────────────────────────────────────────────
const IcdRow = ({ codes }) => {
  if (!codes || codes.length === 0) return null;
  return (
    <div style={{ gridColumn: '1 / -1', paddingBottom: 10, paddingTop: 6, borderBottom: '1px solid #e8e8e8' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.9px', textTransform: 'uppercase', marginBottom: 6 }}>ICD-10 Codes</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {codes.map((c, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #000', borderRadius: 2, padding: '3px 8px', fontSize: 11 }}>
            <strong style={{ fontWeight: 700 }}>{c.code}</strong>
            <span style={{ color: '#555' }}>{c.description}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Claimable services table ──────────────────────────────────────────────────
const ServicesTable = ({ services }) => {
  if (!services || services.length === 0) return null;
  return (
    <div style={{ gridColumn: '1 / -1', paddingBottom: 10, paddingTop: 6, borderBottom: '1px solid #e8e8e8', overflowX: 'auto' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.9px', textTransform: 'uppercase', marginBottom: 8 }}>Claimable Services</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#000', color: '#fff' }}>
            {['Service', 'Category', 'Justification'].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, letterSpacing: '0.5px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {services.map((s, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9f9f9', borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '7px 10px', fontWeight: 600 }}>{s.service}</td>
              <td style={{ padding: '7px 10px', color: '#555' }}>{s.category}</td>
              <td style={{ padding: '7px 10px', color: '#555' }}>{s.justification}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Readiness bar ─────────────────────────────────────────────────────────────
const ReadinessBar = ({ score, ready }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: '1px solid #e8e8e8' }}>
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.9px' }}>Claim Readiness</span>
        <span style={{ fontSize: 11, fontWeight: 700 }}>{score ?? 0}%</span>
      </div>
      <div style={{ height: 6, background: '#e8e8e8', borderRadius: 3 }}>
        <div style={{ height: 6, borderRadius: 3, width: `${score ?? 0}%`, background: score >= 75 ? '#000' : score >= 40 ? '#555' : '#aaa', transition: 'width 0.4s ease' }} />
      </div>
    </div>
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', border: `1.5px solid ${ready ? '#000' : '#aaa'}`, borderRadius: 2, color: ready ? '#000' : '#aaa', whiteSpace: 'nowrap' }}>
      {ready ? 'Ready to submit' : 'Not ready'}
    </span>
  </div>
);

// ── Stat cards ────────────────────────────────────────────────────────────────
const StatCards = ({ pkg }) => {
  const cra = pkg?.claim_readiness_assessment || {};
  const ica = pkg?.insurance_claim_assessment || {};
  const ii = pkg?.insurance_information || {};
  const cards = [
    { label: 'Readiness', value: `${cra.readiness_score_percent ?? 0}%` },
    { label: 'Confidence', value: `${ica.eligibility_confidence_score ?? 0}/100` },
    { label: 'Est. Claim', value: ica.total_estimated_claim_amount_inr ? `₹${ica.total_estimated_claim_amount_inr}` : '—' },
    { label: 'Policy Holder', value: ii.policy_holder_name || '—' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
      {cards.map((c, i) => (
        <div key={i} style={{ border: '1px solid #e8e8e8', borderRadius: 4, padding: '12px 14px', background: '#fafafa' }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4, fontWeight: 700 }}>{c.label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#000' }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// PDF GENERATION
// — Alternating L/R sections (1→L, 2→R, 3→L, 4→R …)
// — All ISO timestamps auto-converted to IST human-readable
// — Text strictly clipped within column width, no overflow
// ═════════════════════════════════════════════════════════════════════════════
const generatePDF = async (data, patientId) => {
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Page constants ────────────────────────────────────────────────────────
  const W = 210, H = 297;
  const mL = 10, mR = 10;
  const HEADER_H = 38;
  const CONT_H = 18;
  const FOOTER_Y = H - 14;
  const CONTENT_BOTTOM = H - 18;
  const colGap = 6;
  const colW = (W - mL - mR - colGap) / 2;
  const LX = mL;
  const RX = mL + colW + colGap;

  const BLACK = [0, 0, 0], WHITE = [255, 255, 255], GRAY = [110, 110, 110];
  const LGRAY = [220, 220, 220], RED = [180, 30, 30], YELLOW = [140, 100, 0];

  // ── Data extraction ───────────────────────────────────────────────────────
  const pkg = data?.insurance_claim_package || {};
  const pi = pkg.patient_identification || {};
  const ec = pkg.emergency_contact || {};
  const ii = pkg.insurance_information || {};
  const eed = pkg.emergency_event_documentation || {};
  const pcd = pkg.paramedic_clinical_documentation || {};
  const vsr = pkg.vital_signs_record || {};
  const hd = pkg.hemodynamic_assessment || {};
  const ra = pkg.respiratory_assessment || {};
  const imv = pkg.image_monitor_vitals || {};
  const ct = pkg.clinical_trend || {};
  const dtd = pkg.doctor_teleconsultation_documentation || {};
  const aai = pkg.approved_ai_analysis || {};
  const asd = pkg.ambulance_service_documentation || {};
  const ica = pkg.insurance_claim_assessment || {};
  const sdi = pkg.supporting_documents_inventory || {};
  const ps = pkg.package_summary || {};
  const cra = pkg.claim_readiness_assessment || {};

  // ── Format value — auto-convert ISO timestamps, no raw ISO in output ──────
  const fmtVal = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) {
      const parts = v.map(fmtVal).filter(Boolean);
      return parts.length ? parts.join(', ') : null;
    }
    if (typeof v === 'object') return JSON.stringify(v);
    const str = String(v).trim();
    if (!str) return null;
    // Auto-detect ISO 8601 timestamps → convert to IST, never show raw ISO
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
      try {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          return d.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
            hour12: true,
          }) + ' IST';
        }
      } catch (e) { /* fall through */ }
    }
    return str;
  };

  const hasVal = (v) => {
    const f = fmtVal(v);
    return f !== null && f !== undefined && String(f).trim() !== '';
  };

  const score = cra.readiness_score_percent ?? 0;
  const genD = new Date();
  const generatedAt = genD.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  }) + ' IST';

  // ── Per-column Y cursors ──────────────────────────────────────────────────
  let yL = HEADER_H + 4;
  let yR = HEADER_H + 4;
  let currentPage = 1;

  const drawPageDecorations = (pageIndex) => {
    doc.setPage(pageIndex);
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.3);
    doc.line(mL, FOOTER_Y, W - mR, FOOTER_Y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text('DoctorAssist.AI — EIDIS v3.0 — Emergency Insurance Documentation — CONFIDENTIAL', mL, H - 9);
    const topY = (pageIndex === 1) ? HEADER_H + 2 : CONT_H + 2;
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.25);
    doc.line(LX + colW + colGap / 2, topY, LX + colW + colGap / 2, FOOTER_Y - 1);
  };

  const addNewPage = () => {
    drawPageDecorations(currentPage);
    doc.addPage();
    currentPage++;
    doc.setFillColor(...BLACK);
    doc.rect(0, 0, W, CONT_H - 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...WHITE);
    doc.text('Insurance Claim Documentation — continued', mL, 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.text(`Patient: ${pi.full_name || patientId}`, W - mR, 11, { align: 'right' });
    yL = CONT_H + 2;
    yR = CONT_H + 2;
  };

  const ensureSpace = (side, needed) => {
    if (side === 'L') {
      if (yL + needed > CONTENT_BOTTOM) addNewPage();
    } else {
      if (yR + needed > CONTENT_BOTTOM) addNewPage();
    }
  };

  const getY = (side) => side === 'L' ? yL : yR;
  const getX = (side) => side === 'L' ? LX : RX;
  const addY = (side, delta) => { if (side === 'L') yL += delta; else yR += delta; };

  // ── Section header ────────────────────────────────────────────────────────
  const secHead = (title, side) => {
    ensureSpace(side, 11);
    const y = getY(side);
    const x = getX(side);
    doc.setFillColor(...BLACK);
    doc.rect(x, y, colW, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...WHITE);
    // Use splitTextToSize to prevent overflow, take only first line
    const titleLines = doc.splitTextToSize(title.toUpperCase(), colW - 4);
    doc.text(titleLines[0], x + 3, y + 5);
    addY(side, 9);
  };

  // ── Row renderer — strictly contained within colW ────────────────────────
  // Label fixed at LABEL_W mm, value gets the rest. Both word-wrapped.
  const LABEL_W = 30;
  const VAL_W = colW - LABEL_W - 3;
  const LINE_H = 3.8;

  const row = (label, rawValue, side) => {
    const valStr = fmtVal(rawValue);
    if (!hasVal(valStr)) return;

    const x = getX(side);
    const valX = x + LABEL_W + 2;

    // Ensure plain string, strip any unusual whitespace
    const safeLabel = String(label).replace(/\s+/g, ' ').trim();
    const safeVal = String(valStr).replace(/\s+/g, ' ').trim();

    const labelLines = doc.splitTextToSize(safeLabel, LABEL_W - 1);
    const valLines = doc.splitTextToSize(safeVal, VAL_W);

    const lineCount = Math.max(labelLines.length, valLines.length);
    const rowH = lineCount * LINE_H + 4.5;

    ensureSpace(side, rowH);
    const y = getY(side);

    // Label — grey, bold, small
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(...GRAY);
    labelLines.forEach((line, li) => {
      doc.text(line, x + 1, y + 3.2 + li * LINE_H);
    });

    // Value — black, normal, slightly larger
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...BLACK);
    valLines.forEach((line, li) => {
      doc.text(line, valX, y + 3.2 + li * LINE_H);
    });

    // Divider
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.15);
    doc.line(x, y + rowH - 0.5, x + colW, y + rowH - 0.5);

    addY(side, rowH);
  };

  // ── Note / warning box ────────────────────────────────────────────────────
  const noteBox = (text, side, color = YELLOW) => {
    if (!hasVal(text)) return;
    const x = getX(side);
    const safeText = String(fmtVal(text) || text).replace(/\s+/g, ' ').trim();
    const lines = doc.splitTextToSize(safeText, colW - 6);
    const h = lines.length * LINE_H + 6;
    ensureSpace(side, h + 2);
    const y = getY(side);
    const bg = color === RED ? [255, 245, 245] : [255, 251, 235];
    doc.setFillColor(...bg);
    doc.setDrawColor(...color);
    doc.setLineWidth(0.3);
    doc.rect(x, y, colW, h, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...color);
    lines.forEach((l, li) => doc.text(l, x + 3, y + 4.2 + li * LINE_H));
    addY(side, h + 2);
  };

  const rowArr = (label, arr, side) => {
    if (!arr || arr.length === 0) return;
    row(label, Array.isArray(arr) ? arr.join(', ') : arr, side);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 HEADER
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFillColor(...BLACK);
  doc.rect(0, 0, W, HEADER_H, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...WHITE);
  doc.text('Insurance Claim Documentation', mL, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(170, 170, 170);
  doc.text('EIDIS v3.0 — Emergency Insurance Documentation Intelligence System', mL, 18);
  doc.text(`Patient ID: ${patientId}`, mL, 23);
  doc.text(`Generated: ${generatedAt}`, mL, 28);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(score >= 75 ? 255 : 200, score >= 75 ? 255 : 200, score >= 75 ? 255 : 200);
  doc.text(`${score}%`, W - mR, 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(150, 150, 150);
  doc.text('READINESS SCORE', W - mR, 23, { align: 'right' });

  const conf = ica.eligibility_confidence_score;
  const claimAmt = ica.total_estimated_claim_amount_inr;
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  if (conf) doc.text(`Confidence: ${conf}/100`, W - mR, 29, { align: 'right' });
  if (claimAmt) doc.text(`Est. Claim: Rs.${claimAmt}`, W - mR - (conf ? 40 : 0), 29, { align: 'right' });

  // ══════════════════════════════════════════════════════════════════════════
  // SECTIONS — alternating L / R
  // Each call to writeSec(title, side, fn) writes a section to that side.
  // We track a sectionIndex and alternate: even → L, odd → R
  // ══════════════════════════════════════════════════════════════════════════

  // Helper: write a section to a specific side
  // sectionFn receives (side) and calls row/rowArr/noteBox with it
  const section = (title, sectionFn, side) => {
    secHead(title, side);
    sectionFn(side);
  };

  // Build ordered section list: [title, renderFn]
  // We'll assign them alternating sides in order
  const sections = [];

  sections.push(['Patient Identification', (s) => {
    row('Patient ID', pi.patient_id, s);
    row('Full Name', pi.full_name, s);
    row('Age', pi.age, s);
    row('Gender', pi.gender, s);
    row('Contact', pi.contact_number, s);
    row('Address', pi.address, s);
    row('Blood Group', pi.blood_group, s);
    row('Reg. Source', pi.registration_source, s);
  }]);

  sections.push(['Emergency Contact', (s) => {
    row('Name', ec.name, s);
    row('Relationship', ec.relationship, s);
    row('Phone', ec.phone_number, s);
    row('Alt. Phone', ec.alternate_phone, s);
  }]);

  sections.push(['Insurance Information', (s) => {
    row('Provider', ii.insurance_provider_name, s);
    row('Policy #', ii.policy_number, s);
    row('Member ID', ii.member_id, s);
    row('Group #', ii.group_number, s);
    row('Claim #', ii.claim_number, s);
    row('Policy Holder', ii.policy_holder_name, s);
    row('Valid From', ii.coverage_valid_from, s);
    row('Valid To', ii.coverage_valid_to, s);
    row('Active at Incident', ii.coverage_active_at_incident, s);
    row('Pre-auth Ref', ii.pre_authorisation_reference_number, s);
    row('Co-pay', ii.co_pay_amount, s);
    row('Deductible', ii.deductible_amount, s);
    row('Est. Claim Amt', ii.estimated_claim_amount_stated, s);
    row('Provider NPI', ii.attending_provider_npi, s);
    row('Att. Provider', ii.attending_provider_name, s);
  }]);

  sections.push(['Vital Signs Record', (s) => {
    row('Timestamp', vsr.measurement_timestamp_ist, s);
    row('Blood Pressure', vsr.blood_pressure_display, s);
    row('Heart Rate', vsr.heart_rate_bpm ? `${vsr.heart_rate_bpm} bpm` : null, s);
    row('HR Classification', vsr.heart_rate_classification, s);
    row('Resp. Rate', vsr.respiratory_rate_bpm ? `${vsr.respiratory_rate_bpm} bpm` : null, s);
    row('RR Classification', vsr.respiratory_rate_classification, s);
    row('SpO2 Room Air', vsr.spo2_on_room_air_percent ? `${vsr.spo2_on_room_air_percent}%` : null, s);
    row('SpO2 RA Class', vsr.spo2_room_air_classification, s);
    row('SpO2 on O2', vsr.spo2_on_oxygen_percent ? `${vsr.spo2_on_oxygen_percent}%` : null, s);
    row('SpO2 O2 Class', vsr.spo2_on_o2_classification, s);
    row('Temperature', vsr.temperature_celsius ? `${vsr.temperature_celsius}C / ${vsr.temperature_fahrenheit || ''}F` : null, s);
    row('Temp Class', vsr.temperature_classification, s);
    row('Glucose', vsr.glucose_mgdl ? `${vsr.glucose_mgdl} mg/dL` : null, s);
    row('Pupils', vsr.pupil_response, s);
    row('Skin Colour', vsr.skin_colour, s);
    row('Skin Moisture', vsr.skin_moisture, s);
    if (vsr.critical_vitals_flags && vsr.critical_vitals_flags.length > 0) {
      noteBox(`Critical: ${vsr.critical_vitals_flags.join(' | ')}`, s, RED);
    }
  }]);

  sections.push(['Emergency Event', (s) => {
    row('Incident Date', eed.incident_date, s);
    row('Date/Time IST', eed.incident_datetime_display, s);
    row('Pickup Location', eed.pickup_location, s);
    row('Chief Complaint', eed.chief_complaint, s);
    row('Mechanism', eed.mechanism_of_injury, s);
    row('Severity', eed.emergency_severity_level, s);
    row('Triage Colour', eed.triage_colour, s);
    row('Response Time', eed.response_time_minutes ? `${eed.response_time_minutes} min` : null, s);
  }]);

  sections.push(['Hemodynamic Assessment', (s) => {
    row('Status', hd.hemodynamic_status, s);
    row('Shock Suspected', fmtVal(hd.shock_suspected), s);
    row('Shock Type', hd.shock_type, s);
    row('Shock Stage', hd.shock_stage, s);
    row('Shock Class', hd.shock_class, s);
    row('Pulse Quality', hd.pulse_quality, s);
    row('Capillary Refill', hd.capillary_refill, s);
    row('Narrative', hd.hemodynamic_narrative, s);
    if (hasVal(hd.decompensation_warning)) noteBox(`Warning: ${hd.decompensation_warning}`, s, RED);
  }]);

  sections.push(['Paramedic Documentation', (s) => {
    row('GCS Score', pcd.gcs_score ? `${pcd.gcs_score}/15` : null, s);
    row('Consciousness', pcd.consciousness_level, s);
    row('Pain Score', pcd.pain_score, s);
    row('Allergies', pcd.allergies, s);
    row('Current Meds', pcd.current_medications, s);
    row('Medical History', pcd.medical_history, s);
    row('Symptoms', pcd.symptoms_reported, s);
    row('Findings', pcd.physical_findings, s);
    row('Interventions', pcd.interventions_performed, s);
    row('Transcript', pcd.transcript_summary, s);
  }]);

  sections.push(['Respiratory Assessment', (s) => {
    row('Adequacy', ra.respiratory_adequacy, s);
    row('Failure Risk', ra.respiratory_failure_risk, s);
    row('Pneumothorax', fmtVal(ra.pneumothorax_suspected), s);
    row('Haemothorax', fmtVal(ra.hemothorax_suspected), s);
    row('Air Entry L', fmtVal(ra.reduced_air_entry_left), s);
    row('Air Entry R', fmtVal(ra.reduced_air_entry_right), s);
    row('O2 Therapy', ra.oxygen_therapy, s);
    row('O2 Flow Rate', ra.oxygen_flow_rate, s);
    row('Airway Status', ra.airway_status, s);
    row('Narrative', ra.respiratory_narrative, s);
    if (hasVal(ra.chest_decompression_watch)) noteBox(`Watch: ${ra.chest_decompression_watch}`, s, RED);
  }]);

  sections.push(['Clinical Trend', (s) => {
    row('Overall Trend', ct.overall_trend, s);
    row('Summary', ct.trend_summary, s);
    rowArr('Improving', ct.improving_parameters, s);
    rowArr('Worsening', ct.worsening_parameters, s);
    if (hasVal(ct.trajectory_note)) noteBox(`Note: ${ct.trajectory_note}`, s, YELLOW);
  }]);

  if (imv.available) {
    sections.push(['Image Monitor Vitals', (s) => {
      row('Timestamp', imv.monitor_timestamp_ist, s);
      row('Heart Rate', imv.hr_bpm ? `${imv.hr_bpm} bpm` : null, s);
      row('SpO2', imv.spo2_percent ? `${imv.spo2_percent}%` : null, s);
      row('Resp. Rate', imv.rr_bpm ? `${imv.rr_bpm} bpm` : null, s);
      row('NIBP', imv.nibp_display, s);
      row('Temperature', imv.temperature_celsius ? `${imv.temperature_celsius}C` : null, s);
      row('ETCO2', imv.etco2_mmhg ? `${imv.etco2_mmhg} mmHg` : null, s);
      row('Pump 1 Flow', imv.pump1_flow_ml_hr ? `${imv.pump1_flow_ml_hr} ml/hr` : null, s);
      row('Pump 2 Flow', imv.pump2_flow_ml_hr ? `${imv.pump2_flow_ml_hr} ml/hr` : null, s);
      row('Pump 3 Flow', imv.pump3_flow_ml_hr ? `${imv.pump3_flow_ml_hr} ml/hr` : null, s);
      row('P1 Infused', imv.pump1_infused_ml ? `${imv.pump1_infused_ml} ml` : null, s);
      row('P2 Infused', imv.pump2_infused_ml ? `${imv.pump2_infused_ml} ml` : null, s);
      row('P3 Infused', imv.pump3_infused_ml ? `${imv.pump3_infused_ml} ml` : null, s);
      if (hasVal(imv.monitor_mismatch_note)) noteBox(`Note: ${imv.monitor_mismatch_note}`, s, YELLOW);
    }]);
  }

  sections.push(['Ambulance Service', (s) => {

   
    row('Hospital Arrival', asd.arrival_at_hospital_time_ist, s);
    row('Vehicle Reg.', asd.vehicle_registration, s);
    rowArr('Crew Members', asd.crew_members, s);
    row('Transport Position', asd.transport_position, s);
    row('Distance (km)', asd.distance_km, s);
    rowArr('Equipment', asd.equipment_used, s);
    rowArr('Consumables', asd.consumables_used, s);
    row('Notes', asd.notes, s);
  }]);

  sections.push(['Teleconsultation', (s) => {
    row('Available', fmtVal(dtd.consultation_available), s);
    row('# Consultations', dtd.number_of_consultations, s);
    row('First Contact', dtd.first_consultation_time_ist, s);
    row('Last Contact', dtd.last_consultation_time_ist, s);
    row('Doctor ID', dtd.consulting_doctor_id, s);
    row('Doctor Name', dtd.consulting_doctor_name, s);
    row('Provisional Dx', dtd.provisional_diagnosis, s);
    rowArr('Differential Dx', dtd.differential_diagnoses, s);
    row('Severity', dtd.severity_assessment_by_doctor, s);
    rowArr('Specialist Refs', dtd.specialist_referrals, s);
    row('Clinical Summary', dtd.clinical_assessment_summary, s);
    row('Management Plan', dtd.management_plan, s);
  }]);

  sections.push(['Injuries & Interventions', (s) => {
    rowArr('Injuries', pkg.injuries_documented, s);
    rowArr('Interventions', pkg.pre_hospital_interventions, s);
    rowArr('Medications Given', pkg.medications_administered, s);
  }]);

  sections.push(['Approved AI Analysis', (s) => {
    row('Available', fmtVal(aai.available), s);
    row('Risk Level', aai.risk_level, s);
    row('Approved At', aai.approved_at_ist, s);
    row('Approved By', aai.approved_by_doctor_id, s);
    row('AI Impression', aai.ai_impression, s);
    row('Physician Alert', aai.physician_alert, s);
    row('Recommendation', aai.recommendation, s);
  }]);

  sections.push(['ICD-10 Codes', (s) => {
    if (ica.icd_10_codes && ica.icd_10_codes.length > 0) {
      ica.icd_10_codes.forEach(c => row(c.code || '', c.description || '', s));
    }
  }]);

  sections.push(['Claim Assessment', (s) => {
    row('Claim Type', ica.claim_type, s);
    row('Emergency Claim', fmtVal(ica.emergency_claim), s);
    row('Pre-auth Obtained', fmtVal(ica.pre_authorisation_obtained), s);
    row('Est. Amount INR', ica.total_estimated_claim_amount_inr ? `Rs.${ica.total_estimated_claim_amount_inr}` : null, s);
    row('Confidence Score', ica.eligibility_confidence_score ? `${ica.eligibility_confidence_score}/100` : null, s);
    row('Submission Deadline', ica.claim_submission_deadline_days ? `${ica.claim_submission_deadline_days} days` : null, s);
    rowArr('Exclusions / Flags', ica.exclusions_and_flags, s);
    if (ica.claimable_services && ica.claimable_services.length > 0) {
      ica.claimable_services.forEach(sv => {
        row(sv.service || sv.category || '', `[${sv.category || ''}] ${sv.justification || ''}`, s);
      });
    }
  }]);

  sections.push(['Claim Readiness', (s) => {
    row('Ready to Submit', fmtVal(cra.ready_to_submit), s);
    row('Readiness Score', cra.readiness_score_percent ? `${cra.readiness_score_percent}%` : null, s);
    row('Est. Processing', cra.estimated_processing_time_days ? `${cra.estimated_processing_time_days} days` : null, s);
    row('Outcome Prediction', cra.claim_outcome_prediction, s);
    if (cra.blocking_issues && cra.blocking_issues.length > 0) {
      noteBox(`Blocking: ${cra.blocking_issues.join(' | ')}`, s, RED);
    }
  }]);

  // Supporting Documents
  const sdiEntries = Object.entries(sdi).filter(([, val]) =>
    val && typeof val === 'object' && val.available !== undefined
  );
  if (sdiEntries.length > 0) {
    sections.push(['Supporting Documents', (s) => {
      sdiEntries.forEach(([key, val]) => {
        const label = key.replace(/_/g, ' ');
        row(label, val.available ? 'Available' : 'Missing', s);
      });
    }]);
  }

  sections.push(['Package Summary', (s) => {
    row('Summary', ps.one_line_summary, s);
    row('Data Quality', ps.data_quality, s);
    rowArr('Key Facts', ps.key_facts, s);
    row('Clinical Narrative', ps.clinical_narrative_for_insurer, s);
  }]);

  // ── Render all sections alternating L / R ─────────────────────────────────
  sections.forEach(([title, fn], idx) => {
    const side = idx % 2 === 0 ? 'L' : 'R';
    section(title, fn, side);
  });

  // ── Finalize ──────────────────────────────────────────────────────────────
  drawPageDecorations(currentPage);

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text(`Page ${i} of ${totalPages}`, W - mR, H - 9, { align: 'right' });
  }

  doc.save(`Insurance_Claim_${patientId}_${new Date().toISOString().slice(0, 10)}.pdf`);
};

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function InsuranceDocumentation({ patientId }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [edited, setEdited] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = async () => {
    if (!patientId) { alert('No patient ID available'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/hms/users/ai-legacy/insurance/documentation/${patientId}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ include_intermediates: false }) }
      );
      const result = await res.json();
      if (result.status === 'success') {
        setData(result);
        setEdited(JSON.parse(JSON.stringify(result)));
      } else {
        setError(result.message || 'Generation failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = useCallback((path, value) => {
    setEdited(prev => setPath(prev, path, value));
  }, []);

  const pkg = edited?.insurance_claim_package || {};
  const pi = pkg.patient_identification || {};
  const ec = pkg.emergency_contact || {};
  const ii = pkg.insurance_information || {};
  const eed = pkg.emergency_event_documentation || {};
  const pcd = pkg.paramedic_clinical_documentation || {};
  const vsr = pkg.vital_signs_record || {};
  const hd = pkg.hemodynamic_assessment || {};
  const ra = pkg.respiratory_assessment || {};
  const imv = pkg.image_monitor_vitals || {};
  const ct = pkg.clinical_trend || {};
  const dtd = pkg.doctor_teleconsultation_documentation || {};
  const aai = pkg.approved_ai_analysis || {};
  const asd = pkg.ambulance_service_documentation || {};
  const ica = pkg.insurance_claim_assessment || {};
  const sdi = pkg.supporting_documents_inventory || {};
  const ps = pkg.package_summary || {};
  const cra = pkg.claim_readiness_assessment || {};

  const P = (path) => `insurance_claim_package.${path}`;

  const colStyle = { flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '1fr', gap: 0, alignContent: 'start' };
  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @keyframes ins-spin { to { transform: rotate(360deg); } }
        textarea:focus, select:focus, input:focus { border-color: #000 !important; box-shadow: 0 0 0 2px rgba(0,0,0,0.08); }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 18, marginBottom: 20, borderBottom: '2px solid #000' }}>
        <div>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 4, fontWeight: 700 }}>EIDIS v3.0</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.3px' }}>Insurance Claim Documentation</h2>
          <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0' }}>Emergency Insurance Documentation Intelligence System</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {data && !editMode && (
            <>
              <button onClick={() => setEditMode(true)} style={btnStyle('#fff', '#000', '1.5px solid #000')}>✏ Edit</button>
              <button
                onClick={async () => { setPdfLoading(true); try { await generatePDF(edited, patientId); } catch (e) { alert('PDF failed: ' + e.message); } finally { setPdfLoading(false); } }}
                disabled={pdfLoading}
                style={btnStyle(pdfLoading ? '#888' : '#000', '#fff')}
              >
                {pdfLoading ? <><Spin size={14} color="#fff" /> Generating…</> : '↓ Download PDF'}
              </button>
            </>
          )}
          {editMode && (
            <>
              <button onClick={() => { setEdited(JSON.parse(JSON.stringify(data))); setEditMode(false); }} style={btnStyle('#fff', '#555', '1.5px solid #ccc')}>✕ Cancel</button>
              <button onClick={() => { setData(edited); setEditMode(false); alert('Changes saved.'); }} style={btnStyle('#16a34a', '#fff')}>✓ Save</button>
            </>
          )}
          <button onClick={generate} disabled={loading} style={btnStyle(loading ? '#ccc' : '#000', loading ? '#888' : '#fff')}>
            {loading ? <><Spin size={14} color="#888" /> Processing…</> : '✦ Generate package'}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>{error}</div>
      )}

      {/* ── Edit banner ── */}
      {editMode && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '8px 14px', marginBottom: 16, fontSize: 12, color: '#92400e', fontWeight: 600 }}>
          ✏ Edit mode — all fields are editable. Click Save when done.
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !data && !error && (
        <div style={{ textAlign: 'center', padding: '60px 0', border: '2px dashed #e0e0e0', borderRadius: 6 }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No package generated yet</div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>Click "Generate package" to compile the full insurance claim from all available emergency data</div>
          <button onClick={generate} style={btnStyle('#000', '#fff')}>✦ Generate package</button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size={36} />
          <div style={{ fontSize: 14, color: '#666', marginTop: 16, fontWeight: 600 }}>Running Emergency Insurance Documentation pipeline…</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>I1 → I2 → I3 → I4 → I5+I6 → I7 → I7b</div>
        </div>
      )}

      {/* ── Results ── */}
      {data && edited && !loading && (
        <div>
          <StatCards pkg={pkg} />
          <ReadinessBar score={cra.readiness_score_percent} ready={cra.ready_to_submit} />

          {cra.blocking_issues && cra.blocking_issues.length > 0 && (
            <div style={{ margin: '14px 0', padding: '10px 14px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 6 }}>Blocking Issues</div>
              {cra.blocking_issues.map((b, i) => <div key={i} style={{ fontSize: 12, color: '#dc2626', marginBottom: 3 }}>⚠ {b}</div>)}
            </div>
          )}

          {cra.recommended_actions_before_submission && cra.recommended_actions_before_submission.length > 0 && (
            <div style={{ margin: '14px 0', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 6 }}>Recommended Actions Before Submission</div>
              {cra.recommended_actions_before_submission.map((a, i) => <div key={i} style={{ fontSize: 12, color: '#15803d', marginBottom: 3 }}>✓ {a}</div>)}
            </div>
          )}

          {(hasValue(ps.clinical_narrative_for_insurer) || editMode) && (
            <div style={{ margin: '14px 0', padding: '14px', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 6 }}>Clinical Narrative for Insurer</div>
              {editMode ? (
                <textarea
                  value={ps.clinical_narrative_for_insurer || ''}
                  onChange={e => handleChange(P('package_summary.clinical_narrative_for_insurer'), e.target.value)}
                  rows={4}
                  style={{ ...textareaStyle, width: '100%', boxSizing: 'border-box' }}
                  placeholder="Enter clinical narrative"
                />
              ) : (
                <p style={{ fontSize: 13, color: '#333', lineHeight: 1.7, margin: 0 }}>{ps.clinical_narrative_for_insurer}</p>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', margin: '0 0 8px' }}>
            <ServicesTable services={ica.claimable_services} />
            <IcdRow codes={ica.icd_10_codes} />
          </div>

          {/* ── Two-column grid ── */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'start' }}>

            {/* LEFT */}
            <div style={colStyle}>
              <div style={gridStyle}>
                <SecHead>Patient Identification</SecHead>
                <Cell label="Patient ID" value={pi.patient_id} path={P('patient_identification.patient_id')} editMode={editMode} onChange={handleChange} />
                <Cell label="Full Name" value={pi.full_name} path={P('patient_identification.full_name')} editMode={editMode} onChange={handleChange} />
                <Cell label="Age" value={pi.age} path={P('patient_identification.age')} editMode={editMode} onChange={handleChange} />
                <Cell label="Gender" value={pi.gender} path={P('patient_identification.gender')} editMode={editMode} onChange={handleChange} />
                <Cell label="Contact" value={pi.contact_number} path={P('patient_identification.contact_number')} editMode={editMode} onChange={handleChange} />
                <Cell label="Address" value={pi.address} path={P('patient_identification.address')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Blood Group" value={pi.blood_group} path={P('patient_identification.blood_group')} editMode={editMode} onChange={handleChange} />
                <Cell label="Reg. Source" value={pi.registration_source} path={P('patient_identification.registration_source')} editMode={editMode} onChange={handleChange} />

                <SecHead>Insurance Information</SecHead>
                <Cell label="Provider" value={ii.insurance_provider_name} path={P('insurance_information.insurance_provider_name')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Policy #" value={ii.policy_number} path={P('insurance_information.policy_number')} editMode={editMode} onChange={handleChange} />
                <Cell label="Member ID" value={ii.member_id} path={P('insurance_information.member_id')} editMode={editMode} onChange={handleChange} />
                <Cell label="Group #" value={ii.group_number} path={P('insurance_information.group_number')} editMode={editMode} onChange={handleChange} />
                <Cell label="Claim #" value={ii.claim_number} path={P('insurance_information.claim_number')} editMode={editMode} onChange={handleChange} />
                <Cell label="Policy Holder" value={ii.policy_holder_name} path={P('insurance_information.policy_holder_name')} editMode={editMode} onChange={handleChange} />
                <Cell label="Valid From" value={ii.coverage_valid_from} path={P('insurance_information.coverage_valid_from')} editMode={editMode} onChange={handleChange} />
                <Cell label="Valid To" value={ii.coverage_valid_to} path={P('insurance_information.coverage_valid_to')} editMode={editMode} onChange={handleChange} />
                <Cell label="Active at Incident" value={ii.coverage_active_at_incident} path={P('insurance_information.coverage_active_at_incident')} editMode={editMode} onChange={handleChange} />
                <Cell label="Pre-auth Ref" value={ii.pre_authorisation_reference_number} path={P('insurance_information.pre_authorisation_reference_number')} editMode={editMode} onChange={handleChange} />
                <Cell label="Co-pay" value={ii.co_pay_amount} path={P('insurance_information.co_pay_amount')} editMode={editMode} onChange={handleChange} />
                <Cell label="Deductible" value={ii.deductible_amount} path={P('insurance_information.deductible_amount')} editMode={editMode} onChange={handleChange} />
                <Cell label="Est. Claim Amt" value={ii.estimated_claim_amount_stated} path={P('insurance_information.estimated_claim_amount_stated')} editMode={editMode} onChange={handleChange} />
                <Cell label="Provider NPI" value={ii.attending_provider_npi} path={P('insurance_information.attending_provider_npi')} editMode={editMode} onChange={handleChange} />
                <Cell label="Att. Provider" value={ii.attending_provider_name} path={P('insurance_information.attending_provider_name')} editMode={editMode} onChange={handleChange} />

                <SecHead>Emergency Event</SecHead>
                <Cell label="Incident Date" value={eed.incident_date} path={P('emergency_event_documentation.incident_date')} editMode={editMode} onChange={handleChange} />
                <Cell label="Date/Time IST" value={eed.incident_datetime_display} path={P('emergency_event_documentation.incident_datetime_display')} editMode={editMode} onChange={handleChange} />
                <Cell label="Pickup Location" value={eed.pickup_location} path={P('emergency_event_documentation.pickup_location')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Chief Complaint" value={eed.chief_complaint} path={P('emergency_event_documentation.chief_complaint')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Mechanism" value={eed.mechanism_of_injury} path={P('emergency_event_documentation.mechanism_of_injury')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Severity" value={eed.emergency_severity_level} path={P('emergency_event_documentation.emergency_severity_level')} editMode={editMode} onChange={handleChange} />
                <Cell label="Triage Colour" value={eed.triage_colour} path={P('emergency_event_documentation.triage_colour')} editMode={editMode} onChange={handleChange} />
                <Cell label="Response Time" value={eed.response_time_minutes} path={P('emergency_event_documentation.response_time_minutes')} editMode={editMode} onChange={handleChange} />

                <SecHead>Emergency Crew Documentation</SecHead>
                <Cell label="GCS Score" value={pcd.gcs_score} path={P('paramedic_clinical_documentation.gcs_score')} editMode={editMode} onChange={handleChange} />
                <Cell label="Consciousness" value={pcd.consciousness_level} path={P('paramedic_clinical_documentation.consciousness_level')} editMode={editMode} onChange={handleChange} />
                <Cell label="Pain Score" value={pcd.pain_score} path={P('paramedic_clinical_documentation.pain_score')} editMode={editMode} onChange={handleChange} />
                <Cell label="Allergies" value={pcd.allergies} path={P('paramedic_clinical_documentation.allergies')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Current Meds" value={pcd.current_medications} path={P('paramedic_clinical_documentation.current_medications')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Medical History" value={pcd.medical_history} path={P('paramedic_clinical_documentation.medical_history')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Symptoms" value={pcd.symptoms_reported} path={P('paramedic_clinical_documentation.symptoms_reported')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Physical Findings" value={pcd.physical_findings} path={P('paramedic_clinical_documentation.physical_findings')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Interventions" value={pcd.interventions_performed} path={P('paramedic_clinical_documentation.interventions_performed')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Transcript" value={pcd.transcript_summary} path={P('paramedic_clinical_documentation.transcript_summary')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Clinical Trend</SecHead>
                <Cell label="Overall Trend" value={ct.overall_trend} path={P('clinical_trend.overall_trend')} editMode={editMode} onChange={handleChange} />
                <Cell label="Summary" value={ct.trend_summary} path={P('clinical_trend.trend_summary')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Improving" value={ct.improving_parameters} path={P('clinical_trend.improving_parameters')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Worsening" value={ct.worsening_parameters} path={P('clinical_trend.worsening_parameters')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Trajectory Note" value={ct.trajectory_note} path={P('clinical_trend.trajectory_note')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Ambulance Service</SecHead>
              
                <Cell label="Hospital Arrival" value={asd.arrival_at_hospital_time_ist} path={P('ambulance_service_documentation.arrival_at_hospital_time_ist')} editMode={editMode} onChange={handleChange} />
                <Cell label="Vehicle Reg." value={asd.vehicle_registration} path={P('ambulance_service_documentation.vehicle_registration')} editMode={editMode} onChange={handleChange} />
                <Cell label="Crew Members" value={asd.crew_members} path={P('ambulance_service_documentation.crew_members')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Transport Position" value={asd.transport_position} path={P('ambulance_service_documentation.transport_position')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Distance (km)" value={asd.distance_km} path={P('ambulance_service_documentation.distance_km')} editMode={editMode} onChange={handleChange} />
                <Cell label="Equipment" value={asd.equipment_used} path={P('ambulance_service_documentation.equipment_used')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Consumables" value={asd.consumables_used} path={P('ambulance_service_documentation.consumables_used')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Notes" value={asd.notes} path={P('ambulance_service_documentation.notes')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Injuries & Interventions</SecHead>
                <Cell label="Injuries Documented" value={pkg.injuries_documented} path={P('injuries_documented')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Pre-hospital Interventions" value={pkg.pre_hospital_interventions} path={P('pre_hospital_interventions')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Medications Administered" value={pkg.medications_administered} path={P('medications_administered')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Supporting Documents</SecHead>
                {Object.entries(sdi).map(([key, val]) => {
                  if (!hasValue(val)) return null;
                  const label = key.replace(/_/g, ' ');
                  if (val.available === null || val.available === undefined) return null;
                  return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e8e8e8', padding: '6px 0', fontSize: 12 }}>
                      <span style={{ color: '#555', textTransform: 'capitalize' }}>{label}</span>
                      <span style={{ fontWeight: 700, fontSize: 11, color: val.available ? '#000' : '#aaa' }}>
                        {val.available ? '✓ Available' : '✗ Missing'}
                      </span>
                    </div>
                  );
                })}

                <SecHead>Package Summary</SecHead>
                <Cell label="One-line Summary" value={ps.one_line_summary} path={P('package_summary.one_line_summary')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Data Quality" value={ps.data_quality} path={P('package_summary.data_quality')} editMode={editMode} onChange={handleChange} />
                <Cell label="Key Facts" value={ps.key_facts} path={P('package_summary.key_facts')} editMode={editMode} onChange={handleChange} fullWidth />
              </div>
            </div>

            {/* RIGHT */}
            <div style={colStyle}>
              <div style={gridStyle}>
                <SecHead>Vital Signs Record</SecHead>
                <Cell label="Timestamp" value={vsr.measurement_timestamp_ist} path={P('vital_signs_record.measurement_timestamp_ist')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Blood Pressure" value={vsr.blood_pressure_display} path={P('vital_signs_record.blood_pressure_display')} editMode={editMode} onChange={handleChange} />
                <Cell label="Heart Rate" value={vsr.heart_rate_bpm} path={P('vital_signs_record.heart_rate_bpm')} editMode={editMode} onChange={handleChange} />
                <Cell label="HR Classification" value={vsr.heart_rate_classification} path={P('vital_signs_record.heart_rate_classification')} editMode={editMode} onChange={handleChange} />
                <Cell label="Resp. Rate" value={vsr.respiratory_rate_bpm} path={P('vital_signs_record.respiratory_rate_bpm')} editMode={editMode} onChange={handleChange} />
                <Cell label="RR Classification" value={vsr.respiratory_rate_classification} path={P('vital_signs_record.respiratory_rate_classification')} editMode={editMode} onChange={handleChange} />
                <Cell label="SpO2 Room Air %" value={vsr.spo2_on_room_air_percent} path={P('vital_signs_record.spo2_on_room_air_percent')} editMode={editMode} onChange={handleChange} />
                <Cell label="SpO2 RA Class" value={vsr.spo2_room_air_classification} path={P('vital_signs_record.spo2_room_air_classification')} editMode={editMode} onChange={handleChange} />
                <Cell label="SpO2 on O2 %" value={vsr.spo2_on_oxygen_percent} path={P('vital_signs_record.spo2_on_oxygen_percent')} editMode={editMode} onChange={handleChange} />
                <Cell label="SpO2 O2 Class" value={vsr.spo2_on_o2_classification} path={P('vital_signs_record.spo2_on_o2_classification')} editMode={editMode} onChange={handleChange} />
                <Cell label="Temperature °C" value={vsr.temperature_celsius} path={P('vital_signs_record.temperature_celsius')} editMode={editMode} onChange={handleChange} />
                <Cell label="Temperature °F" value={vsr.temperature_fahrenheit} path={P('vital_signs_record.temperature_fahrenheit')} editMode={editMode} onChange={handleChange} />
                <Cell label="Temp Classification" value={vsr.temperature_classification} path={P('vital_signs_record.temperature_classification')} editMode={editMode} onChange={handleChange} />
                <Cell label="Glucose mg/dL" value={vsr.glucose_mgdl} path={P('vital_signs_record.glucose_mgdl')} editMode={editMode} onChange={handleChange} />
                <Cell label="Pupil Response" value={vsr.pupil_response} path={P('vital_signs_record.pupil_response')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Skin Colour" value={vsr.skin_colour} path={P('vital_signs_record.skin_colour')} editMode={editMode} onChange={handleChange} />
                <Cell label="Skin Moisture" value={vsr.skin_moisture} path={P('vital_signs_record.skin_moisture')} editMode={editMode} onChange={handleChange} />
                {vsr.critical_vitals_flags && vsr.critical_vitals_flags.length > 0 && (
                  <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid #e8e8e8', paddingBottom: 8, paddingTop: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 4 }}>Critical Flags</div>
                    {vsr.critical_vitals_flags.map((f, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#dc2626', marginBottom: 4, lineHeight: 1.5 }}>⚠ {f}</div>
                    ))}
                  </div>
                )}

                <SecHead>Hemodynamic Assessment</SecHead>
                <Cell label="Status" value={hd.hemodynamic_status} path={P('hemodynamic_assessment.hemodynamic_status')} editMode={editMode} onChange={handleChange} />
                <Cell label="Shock Suspected" value={hd.shock_suspected} path={P('hemodynamic_assessment.shock_suspected')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Shock Type" value={hd.shock_type} path={P('hemodynamic_assessment.shock_type')} editMode={editMode} onChange={handleChange} />
                <Cell label="Shock Stage" value={hd.shock_stage} path={P('hemodynamic_assessment.shock_stage')} editMode={editMode} onChange={handleChange} />
                <Cell label="Shock Class" value={hd.shock_class} path={P('hemodynamic_assessment.shock_class')} editMode={editMode} onChange={handleChange} />
                <Cell label="Pulse Quality" value={hd.pulse_quality} path={P('hemodynamic_assessment.pulse_quality')} editMode={editMode} onChange={handleChange} />
                <Cell label="Cap. Refill" value={hd.capillary_refill} path={P('hemodynamic_assessment.capillary_refill')} editMode={editMode} onChange={handleChange} />
                <Cell label="Narrative" value={hd.hemodynamic_narrative} path={P('hemodynamic_assessment.hemodynamic_narrative')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Decompensation Warning" value={hd.decompensation_warning} path={P('hemodynamic_assessment.decompensation_warning')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Respiratory Assessment</SecHead>
                <Cell label="Adequacy" value={ra.respiratory_adequacy} path={P('respiratory_assessment.respiratory_adequacy')} editMode={editMode} onChange={handleChange} />
                <Cell label="Failure Risk" value={ra.respiratory_failure_risk} path={P('respiratory_assessment.respiratory_failure_risk')} editMode={editMode} onChange={handleChange} />
                <Cell label="Pneumothorax?" value={ra.pneumothorax_suspected} path={P('respiratory_assessment.pneumothorax_suspected')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Haemothorax?" value={ra.hemothorax_suspected} path={P('respiratory_assessment.hemothorax_suspected')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Red. Air Entry L" value={ra.reduced_air_entry_left} path={P('respiratory_assessment.reduced_air_entry_left')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Red. Air Entry R" value={ra.reduced_air_entry_right} path={P('respiratory_assessment.reduced_air_entry_right')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="O2 Therapy" value={ra.oxygen_therapy} path={P('respiratory_assessment.oxygen_therapy')} editMode={editMode} onChange={handleChange} />
                <Cell label="O2 Flow Rate" value={ra.oxygen_flow_rate} path={P('respiratory_assessment.oxygen_flow_rate')} editMode={editMode} onChange={handleChange} />
                <Cell label="Airway Status" value={ra.airway_status} path={P('respiratory_assessment.airway_status')} editMode={editMode} onChange={handleChange} />
                <Cell label="Narrative" value={ra.respiratory_narrative} path={P('respiratory_assessment.respiratory_narrative')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Chest Watch" value={ra.chest_decompression_watch} path={P('respiratory_assessment.chest_decompression_watch')} editMode={editMode} onChange={handleChange} fullWidth />

                {(imv.available || editMode) && (
                  <>
                    <SecHead>Image Monitor Vitals</SecHead>
                    <Cell label="Available" value={imv.available} path={P('image_monitor_vitals.available')} editMode={editMode} onChange={handleChange} type="select" />
                    <Cell label="Timestamp" value={imv.monitor_timestamp_ist} path={P('image_monitor_vitals.monitor_timestamp_ist')} editMode={editMode} onChange={handleChange} fullWidth />
                    <Cell label="Heart Rate" value={imv.hr_bpm} path={P('image_monitor_vitals.hr_bpm')} editMode={editMode} onChange={handleChange} />
                    <Cell label="SpO2 %" value={imv.spo2_percent} path={P('image_monitor_vitals.spo2_percent')} editMode={editMode} onChange={handleChange} />
                    <Cell label="Resp. Rate" value={imv.rr_bpm} path={P('image_monitor_vitals.rr_bpm')} editMode={editMode} onChange={handleChange} />
                    <Cell label="NIBP" value={imv.nibp_display} path={P('image_monitor_vitals.nibp_display')} editMode={editMode} onChange={handleChange} />
                    <Cell label="Temperature °C" value={imv.temperature_celsius} path={P('image_monitor_vitals.temperature_celsius')} editMode={editMode} onChange={handleChange} />
                    <Cell label="ETCO2 mmHg" value={imv.etco2_mmhg} path={P('image_monitor_vitals.etco2_mmhg')} editMode={editMode} onChange={handleChange} />
                    <Cell label="Pump 1 Flow ml/hr" value={imv.pump1_flow_ml_hr} path={P('image_monitor_vitals.pump1_flow_ml_hr')} editMode={editMode} onChange={handleChange} />
                    <Cell label="Pump 2 Flow ml/hr" value={imv.pump2_flow_ml_hr} path={P('image_monitor_vitals.pump2_flow_ml_hr')} editMode={editMode} onChange={handleChange} />
                    <Cell label="Pump 3 Flow ml/hr" value={imv.pump3_flow_ml_hr} path={P('image_monitor_vitals.pump3_flow_ml_hr')} editMode={editMode} onChange={handleChange} />
                    <Cell label="P1 Infused ml" value={imv.pump1_infused_ml} path={P('image_monitor_vitals.pump1_infused_ml')} editMode={editMode} onChange={handleChange} />
                    <Cell label="P2 Infused ml" value={imv.pump2_infused_ml} path={P('image_monitor_vitals.pump2_infused_ml')} editMode={editMode} onChange={handleChange} />
                    <Cell label="P3 Infused ml" value={imv.pump3_infused_ml} path={P('image_monitor_vitals.pump3_infused_ml')} editMode={editMode} onChange={handleChange} />
                    <Cell label="Mismatch Note" value={imv.monitor_mismatch_note} path={P('image_monitor_vitals.monitor_mismatch_note')} editMode={editMode} onChange={handleChange} fullWidth />
                  </>
                )}

                <SecHead>Teleconsultation</SecHead>
                <Cell label="Available" value={dtd.consultation_available} path={P('doctor_teleconsultation_documentation.consultation_available')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="# Consultations" value={dtd.number_of_consultations} path={P('doctor_teleconsultation_documentation.number_of_consultations')} editMode={editMode} onChange={handleChange} />
                <Cell label="First Contact" value={dtd.first_consultation_time_ist} path={P('doctor_teleconsultation_documentation.first_consultation_time_ist')} editMode={editMode} onChange={handleChange} />
                <Cell label="Last Contact" value={dtd.last_consultation_time_ist} path={P('doctor_teleconsultation_documentation.last_consultation_time_ist')} editMode={editMode} onChange={handleChange} />
                <Cell label="Doctor ID" value={dtd.consulting_doctor_id} path={P('doctor_teleconsultation_documentation.consulting_doctor_id')} editMode={editMode} onChange={handleChange} />
                <Cell label="Doctor Name" value={dtd.consulting_doctor_name} path={P('doctor_teleconsultation_documentation.consulting_doctor_name')} editMode={editMode} onChange={handleChange} />
                <Cell label="Provisional Dx" value={dtd.provisional_diagnosis} path={P('doctor_teleconsultation_documentation.provisional_diagnosis')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Differential Dx" value={dtd.differential_diagnoses} path={P('doctor_teleconsultation_documentation.differential_diagnoses')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Severity" value={dtd.severity_assessment_by_doctor} path={P('doctor_teleconsultation_documentation.severity_assessment_by_doctor')} editMode={editMode} onChange={handleChange} />
                <Cell label="Specialist Refs" value={dtd.specialist_referrals} path={P('doctor_teleconsultation_documentation.specialist_referrals')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Clinical Summary" value={dtd.clinical_assessment_summary} path={P('doctor_teleconsultation_documentation.clinical_assessment_summary')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Management Plan" value={dtd.management_plan} path={P('doctor_teleconsultation_documentation.management_plan')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Approved AI Analysis</SecHead>
                <Cell label="Available" value={aai.available} path={P('approved_ai_analysis.available')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Risk Level" value={aai.risk_level} path={P('approved_ai_analysis.risk_level')} editMode={editMode} onChange={handleChange} />
                <Cell label="Approved At" value={aai.approved_at_ist} path={P('approved_ai_analysis.approved_at_ist')} editMode={editMode} onChange={handleChange} />
                <Cell label="Approved By" value={aai.approved_by_doctor_id} path={P('approved_ai_analysis.approved_by_doctor_id')} editMode={editMode} onChange={handleChange} />
                <Cell label="AI Impression" value={aai.ai_impression} path={P('approved_ai_analysis.ai_impression')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Physician Alert" value={aai.physician_alert} path={P('approved_ai_analysis.physician_alert')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Recommendation" value={aai.recommendation} path={P('approved_ai_analysis.recommendation')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Claim Assessment</SecHead>
                <Cell label="Claim Type" value={ica.claim_type} path={P('insurance_claim_assessment.claim_type')} editMode={editMode} onChange={handleChange} fullWidth />
                <Cell label="Emergency Claim" value={ica.emergency_claim} path={P('insurance_claim_assessment.emergency_claim')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Pre-auth Obtained" value={ica.pre_authorisation_obtained} path={P('insurance_claim_assessment.pre_authorisation_obtained')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Est. Amount INR" value={ica.total_estimated_claim_amount_inr} path={P('insurance_claim_assessment.total_estimated_claim_amount_inr')} editMode={editMode} onChange={handleChange} />
                <Cell label="Confidence Score" value={ica.eligibility_confidence_score} path={P('insurance_claim_assessment.eligibility_confidence_score')} editMode={editMode} onChange={handleChange} />
                <Cell label="Submission Deadline" value={ica.claim_submission_deadline_days} path={P('insurance_claim_assessment.claim_submission_deadline_days')} editMode={editMode} onChange={handleChange} />
                <Cell label="Exclusions / Flags" value={ica.exclusions_and_flags} path={P('insurance_claim_assessment.exclusions_and_flags')} editMode={editMode} onChange={handleChange} fullWidth />

                <SecHead>Claim Readiness</SecHead>
                <Cell label="Ready to Submit" value={cra.ready_to_submit} path={P('claim_readiness_assessment.ready_to_submit')} editMode={editMode} onChange={handleChange} type="select" />
                <Cell label="Readiness Score %" value={cra.readiness_score_percent} path={P('claim_readiness_assessment.readiness_score_percent')} editMode={editMode} onChange={handleChange} />
                <Cell label="Est. Processing Days" value={cra.estimated_processing_time_days} path={P('claim_readiness_assessment.estimated_processing_time_days')} editMode={editMode} onChange={handleChange} />
                <Cell label="Outcome Prediction" value={cra.claim_outcome_prediction} path={P('claim_readiness_assessment.claim_outcome_prediction')} editMode={editMode} onChange={handleChange} fullWidth />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky save bar */}
      {editMode && data && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e8e8e8', padding: '12px 0', display: 'flex', gap: 12, zIndex: 100, marginTop: 20 }}>
          <button onClick={() => { setData(edited); setEditMode(false); alert('Changes saved.'); }} style={btnStyle('#16a34a', '#fff')}>✓ Save changes</button>
          <button onClick={() => { setEdited(JSON.parse(JSON.stringify(data))); setEditMode(false); }} style={btnStyle('#fff', '#555', '1.5px solid #ccc')}>✕ Cancel</button>
        </div>
      )}
    </div>
  );
}

const btnStyle = (bg, color, border = 'none') => ({
  background: bg, color, border,
  padding: '9px 20px', borderRadius: 4,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
  display: 'inline-flex', alignItems: 'center', gap: 7,
  transition: 'opacity 0.15s',
});