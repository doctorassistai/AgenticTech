// PatientRecordsTable.jsx — Doctorassist.AI website theme
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Calendar, FileText, Activity,
  X, ZoomIn, ZoomOut, Download, Move, Table, FileIcon
} from 'lucide-react';

/* ─────────────────────────────────────────
   THEME TOKENS  (matches doctorassist.ai)
───────────────────────────────────────── */
const T = {
  bg:        '#ffffff',
  bgAlt:     '#fafafa',
  bgTert:    '#f5f5f5',
  text:      '#000000',
  textSec:   '#444444',
  textMuted: '#888888',
  border:    '#e0e0e0',
  borderStr: '#000000',
  font:      "'Open Sans', sans-serif",
};

/* ─────────────────────────────────────────
   SHARED INLINE STYLES
───────────────────────────────────────── */
const ST = {
  /* section wrapper */
  section: {
    border: `1px solid ${T.border}`,
    marginBottom: '2rem',
    fontFamily: T.font,
    fontWeight: 300,
  },
  /* section header bar */
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.875rem 1.25rem',
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    cursor: 'pointer',
    userSelect: 'none',
  },
  sectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  sectionLabel: {
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.15em',
    color: T.textMuted,
    fontWeight: 400,
  },
  sectionTitle: {
    fontSize: '0.82rem',
    fontWeight: 400,
    color: T.text,
    margin: 0,
  },
  sectionMeta: {
    fontSize: '0.65rem',
    color: T.textMuted,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  /* table */
  tableWrap: { overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: '480px' },
  th: {
    textAlign: 'left',
    padding: '0.6rem 1rem',
    fontSize: '0.6rem',
    fontWeight: 400,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '0.7rem 1rem',
    fontSize: '0.78rem',
    fontWeight: 300,
    color: T.textSec,
    borderBottom: `1px solid ${T.border}`,
    verticalAlign: 'top',
  },
  tdBold: {
    padding: '0.7rem 1rem',
    fontSize: '0.78rem',
    fontWeight: 400,
    color: T.text,
    borderBottom: `1px solid ${T.border}`,
    verticalAlign: 'top',
  },

  /* badge */
  badge: {
    padding: '0.18rem 0.5rem',
    border: `1px solid ${T.border}`,
    fontSize: '0.6rem',
    fontWeight: 400,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: T.textSec,
    display: 'inline-block',
  },

  /* action / outline buttons */
  actionBtn: {
    padding: '0.3rem 0.75rem',
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: '0.65rem',
    fontWeight: 400,
    cursor: 'pointer',
    fontFamily: T.font,
    transition: 'all 0.15s',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    letterSpacing: '0.05em',
  },
  outlineBtn: {
    padding: '0.3rem 0.75rem',
    background: T.bg,
    color: T.textSec,
    border: `1px solid ${T.border}`,
    fontSize: '0.65rem',
    fontWeight: 400,
    cursor: 'pointer',
    fontFamily: T.font,
    transition: 'all 0.15s',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
  },

  /* chevron toggle icon */
  chevron: { color: T.textMuted, flexShrink: 0 },

  /* collapsible body */
  collapsibleBody: {
    padding: '1.25rem 1.5rem',
    borderTop: `1px solid ${T.border}`,
    background: T.bg,
  },

  /* clinical abstract callout */
  callout: {
    borderLeft: `2px solid ${T.borderStr}`,
    padding: '0.875rem 1.25rem',
    background: T.bgAlt,
    marginBottom: '1rem',
  },
  calloutLabel: {
    fontSize: '0.6rem',
    textTransform: 'uppercase',
    letterSpacing: '0.15em',
    color: T.textMuted,
    fontWeight: 400,
    display: 'block',
    marginBottom: '0.35rem',
  },
  calloutText: {
    fontSize: '0.82rem',
    color: T.textSec,
    lineHeight: 1.7,
    margin: 0,
  },

  /* empty state */
  empty: {
    padding: '2.5rem',
    textAlign: 'center',
    fontSize: '0.78rem',
    color: T.textMuted,
    fontWeight: 300,
    letterSpacing: '0.05em',
  },

  /* loading */
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '2.5rem',
    fontSize: '0.78rem',
    color: T.textMuted,
    fontFamily: T.font,
    fontWeight: 300,
  },

  /* page-level heading */
  pageLabel: {
    fontSize: '0.6rem',
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
    color: T.textMuted,
    fontWeight: 400,
    display: 'block',
    marginBottom: '0.25rem',
    fontFamily: T.font,
  },
  pageTitle: {
    fontSize: '1.4rem',
    fontWeight: 300,
    letterSpacing: '-0.02em',
    color: T.text,
    margin: '0 0 1.5rem',
    fontFamily: T.font,
  },
};

/* ─────────────────────────────────────────
   UTILITIES
───────────────────────────────────────── */
const API_BASE = import.meta.env.VITE_BACKEND_URL;

const formatDate = (ds) => {
  if (!ds) return 'N/A';
  try {
    return new Date(ds).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ds; }
};

const renderCellValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.reference_range) return `${value.reference_range}${value.flag ? ` (${value.flag})` : ''}`;
    return JSON.stringify(value);
  }
  return String(value);
};

const normalizeBackendDocuments = (apiResponse) => {
  const medicalRecords = [];
  const analysisRecords = [];
  apiResponse.forEach((doc) => {
    (doc.processed_data || []).forEach((pdata) => {
      if (pdata?.structured_data && Object.keys(pdata.structured_data).length > 0) {
        analysisRecords.push({
          document_type: doc.document_id,
          created_at: doc.created_at,
          dictation_id: doc.dictation_id,
          conversation_id: doc.conversation_id,
          structured_data: pdata.structured_data,
          clinical_abstract: pdata.clinical_abstract,
          file_url: doc.file_url,
        });
      }
      if (pdata?.content) {
        try {
          const parsed = JSON.parse(pdata.content);
          medicalRecords.push({
            document_type: doc.document_id,
            created_at: doc.created_at,
            file_url: doc.file_url,
            reports: parsed.segments?.map(seg => ({
              report_type: seg.report_type,
              data: seg.extracted_data,
              report_date: parsed.document_summary?.processing_timestamp,
            })) || [],
          });
        } catch (e) { console.error('❌ Invalid JSON in processed_data.content', e); }
      }
    });
  });
  return { medicalRecords, analysisRecords };
};

const BLOCKED_KEYS = [
  'patient_details', 'patient detail', 'patient', 'doctor_details',
  'reporting doctor details', 'doctor', 'lab_details', 'lab detail',
  'metadata', 'facility', 'department', 'object with content',
];

const extractTests = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.tests)) return obj.tests;
  for (const key of Object.keys(obj)) {
    if (BLOCKED_KEYS.includes(key.toLowerCase())) continue;
    const found = extractTests(obj[key]);
    if (found) return found;
  }
  return null;
};

const normalizeLabTests = (tests) => tests.map(t => ({
  parameter: t.parameter || t.test_name || 'Result',
  value: t.value ?? t.result ?? '—',
  unit: t.unit || '',
  reference: t.reference_range || t.normal_range || '',
  status: t.flag || t.status || '',
}));

/* ─────────────────────────────────────────
   FLAT DATA TABLE  (website-themed)
───────────────────────────────────────── */
const FlatTable = ({ rows, columns }) => {
  if (!rows?.length) return null;
  const cols = columns || Object.keys(rows[0]);
  return (
    <div style={ST.tableWrap}>
      <table style={ST.table}>
        <thead>
          <tr>{cols.map(c => <th key={c} style={ST.th}>{c.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="da-tbl-row">
              {cols.map(c => <td key={c} style={ST.td}>{renderCellValue(row[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ─────────────────────────────────────────
   DYNAMIC DATA RENDERER
───────────────────────────────────────── */
const DynamicDataRenderer = ({ data }) => {
  if (!data || typeof data !== 'object') return null;
  const tests = extractTests(data);
  if (tests) {
    const rows = normalizeLabTests(tests);
    return <FlatTable rows={rows} columns={['parameter', 'value', 'unit', 'reference', 'status']} />;
  }
  const filteredEntries = Object.entries(data).filter(
    ([key, value]) => value && !BLOCKED_KEYS.includes(key.toLowerCase())
  );
  if (!filteredEntries.length) return null;
  return (
    <FlatTable
      rows={filteredEntries.map(([k, v]) => ({ parameter: k.replace(/_/g, ' '), value: v }))}
    />
  );
};

/* ─────────────────────────────────────────
   DRAGGABLE PDF VIEWER  (website-themed)
───────────────────────────────────────── */
const DraggablePDFViewer = ({ fileUrl, onClose, fileName }) => {
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const dragStart = useRef({ x: 0, y: 0 });
  const elStart = useRef({ x: 0, y: 0 });

  const onMouseDown = (e) => {
    if (!e.target.closest('.da-drag-handle')) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    elStart.current = { x: position.x, y: position.y };
  };
  const onMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    setPosition({
      x: elStart.current.x + e.clientX - dragStart.current.x,
      y: elStart.current.y + e.clientY - dragStart.current.y,
    });
  };
  const normalizeFileUrl = (url) => {
  if (!url) return url;

  return url.replaceAll(
    "doctorsworkspace.com",
    "doctorassist.ai"
  );
};
  const onMouseUp = () => setIsDragging(false);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    }
  }, [isDragging]);

  const normalizedUrl = useMemo(
  () => normalizeFileUrl(fileUrl),
  [fileUrl]
);

const iframeSrc = useMemo(
  () => `${normalizedUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`,
  [normalizedUrl]
);

  return (
    <div style={{
      position: 'fixed',
      left: position.x,
      top: position.y,
      zIndex: isDragging ? 10000 : 9999,
      width: 820,
      maxWidth: '92vw',
      height: 580,
      maxHeight: '82vh',
      fontFamily: T.font,
    }}>
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        border: `1px solid ${T.borderStr}`,
        background: T.bg,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}>
        {/* drag bar */}
        <div
          className="da-drag-handle"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            background: T.text, color: T.bg,
            cursor: isDragging ? 'grabbing' : 'grab',
            borderBottom: `1px solid ${T.borderStr}`,
            flexShrink: 0,
          }}
          onMouseDown={onMouseDown}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', fontWeight: 400 }}>
            <FileText size={14} />
            <span style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName || 'Document Viewer'}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', fontWeight: 300 }}>— drag to move</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { icon: <ZoomOut size={14} />, onClick: () => setZoom(z => Math.max(z - 0.25, 0.5)), title: 'Zoom out' },
              { icon: <ZoomIn size={14} />, onClick: () => setZoom(z => Math.min(z + 0.25, 3)), title: 'Zoom in' },
            ].map((btn, i) => (
              <button key={i} onClick={btn.onClick} title={btn.title}
                style={{ background: 'transparent', border: 'none', color: T.bg, cursor: 'pointer', padding: '4px 6px' }}>
                {btn.icon}
              </button>
            ))}
            <span style={{ fontSize: '0.65rem', minWidth: 36, textAlign: 'center', color: 'rgba(255,255,255,0.7)' }}>
              {Math.round(zoom * 100)}%
            </span>
            <a href={normalizedUrl} download title="Download"
              style={{ background: 'transparent', border: 'none', color: T.bg, cursor: 'pointer', padding: '4px 6px', display: 'inline-flex' }}>
              <Download size={14} />
            </a>
            <button onClick={onClose} title="Close"
              style={{ background: 'transparent', border: 'none', color: T.bg, cursor: 'pointer', padding: '4px 6px', marginLeft: '4px' }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* pdf frame */}
        <div style={{ flex: 1, background: T.bgTert, overflow: 'auto', padding: '1rem' }}>
          <div style={{
            transform: `scale(${zoom})`, transformOrigin: '0 0',
            width: `${100 / zoom}%`, height: `${100 / zoom}%`,
            transition: 'transform 0.1s ease-out',
          }}>
            <iframe src={iframeSrc} title="PDF Viewer"
              style={{ width: '100%', height: '100%', border: 'none', background: T.bg, display: 'block' }} />
          </div>
        </div>
      </div>
    </div>
  );
};

const PDFViewer = ({ fileUrl, onClose, fileName }) =>
  <DraggablePDFViewer fileUrl={fileUrl} onClose={onClose} fileName={fileName} />;

/* ─────────────────────────────────────────
   COLLAPSIBLE ROW WRAPPER
───────────────────────────────────────── */
const CollapsibleRow = ({ label, meta, date, badge, onViewPdf, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={ST.section}>
      <div style={ST.sectionHeader} onClick={() => setOpen(o => !o)}>
        <div style={ST.sectionHeaderLeft}>
          <span style={ST.chevron}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          <div>
            <p style={ST.sectionTitle}>{label}</p>
            {date && (
              <span style={{ fontSize: '0.65rem', color: T.textMuted, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                <Calendar size={11} />{formatDate(date)}
              </span>
            )}
          </div>
          {badge && <span style={ST.badge}>{badge}</span>}
        </div>
        <div style={ST.sectionMeta}>
          {meta && <span>{meta}</span>}
          {onViewPdf && (
            <button
              style={ST.outlineBtn}
              onClick={(e) => { e.stopPropagation(); onViewPdf(); }}
            >
              <FileText size={12} /> View PDF
            </button>
          )}
          <span style={ST.chevron}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </div>
      </div>
      {open && <div style={ST.collapsibleBody}>{children}</div>}
    </div>
  );
};

/* ─────────────────────────────────────────
   REPORTS ANALYSIS SECTION
───────────────────────────────────────── */
const ReportsAnalysis = ({ records }) => {
  const [selectedPdf, setSelectedPdf] = useState(null);

  if (!records?.length) return null;

  const uploadReports      = records.filter(r => r.document_type?.toLowerCase().endsWith('.pdf'));
  const dictationReports   = records.filter(r => !r.document_type?.toLowerCase().endsWith('.pdf') && r.dictation_id);
  const conversationReports = records.filter(r => !r.document_type?.toLowerCase().endsWith('.pdf') && r.conversation_id);

  return (
    <div style={{ fontFamily: T.font }}>
      {selectedPdf && <PDFViewer fileUrl={selectedPdf.url} fileName={selectedPdf.name} onClose={() => setSelectedPdf(null)} />}

      {/* upload reports */}
      {uploadReports.map((item, idx) => (
        <CollapsibleRow
          key={`up-${idx}`}
          label={item.document_type}
          date={item.created_at}
          badge="Upload"
          onViewPdf={item.file_url ? () => setSelectedPdf({ url: item.file_url, name: item.document_type }) : null}
        >
          {item.clinical_abstract && (
            <div style={ST.callout}>
              <span style={ST.calloutLabel}>Clinical abstract</span>
              <p style={ST.calloutText}>{item.clinical_abstract}</p>
            </div>
          )}
          <div style={ST.tableWrap}>
            <table style={ST.table}>
              <thead>
                <tr>
                  {['Parameter', 'Value', 'Status', 'Reason'].map(h => <th key={h} style={ST.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(item.structured_data || {}).map(([param, details]) => (
                  <tr key={param} className="da-tbl-row">
                    <td style={ST.tdBold}>{param}</td>
                    <td style={ST.td}>{renderCellValue(details.value)}</td>
                    <td style={ST.td}><span style={ST.badge}>{renderCellValue(details.status) || '—'}</span></td>
                    <td style={ST.td}>{renderCellValue(details.reason) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleRow>
      ))}

      {/* dictation reports */}
      {Object.entries(
        dictationReports.reduce((acc, item) => {
          const k = item.dictation_id || 'no-id';
          if (!acc[k]) acc[k] = [];
          acc[k].push(item);
          return acc;
        }, {})
      ).map(([dictId, reports], idx) => {
        const rows = [];
        reports.forEach(item => {
          Object.entries(item.structured_data || {}).forEach(([key, value]) => {
            if (typeof value !== 'object') rows.push({ parameter: `${item.document_type} — ${key}`, value });
          });
        });
        return (
          <CollapsibleRow key={`dict-${dictId}`} label="Dictation Report" meta={`ID: ${dictId}`} badge="Dictation">
            <FlatTable rows={rows} />
          </CollapsibleRow>
        );
      })}

      {/* conversation reports */}
      {Object.entries(
        conversationReports.reduce((acc, item) => {
          const k = item.conversation_id;
          if (!acc[k]) acc[k] = [];
          acc[k].push(item);
          return acc;
        }, {})
      ).map(([convId, reports], idx) => {
        const rows = [];
        reports.forEach(item => {
          Object.entries(item.structured_data || {}).forEach(([key, value]) => {
            if (typeof value !== 'object') rows.push({ parameter: `${item.document_type} — ${key}`, value });
          });
        });
        return (
          <CollapsibleRow key={`conv-${convId}`} label="Conversation Report" meta={`ID: ${convId}`} badge="Conversation">
            <FlatTable rows={rows} />
          </CollapsibleRow>
        );
      })}
    </div>
  );
};

/* ─────────────────────────────────────────
   MEDICAL RECORDS VIEW
───────────────────────────────────────── */
const MedicalRecordsView = ({ records }) => {
  if (!records?.length) return null;

  const cleanValue = (value) => {
    if (!value || value === 'null') return null;
    if (Array.isArray(value)) {
      return value.filter(v => v && v !== 'null')
        .map(v => typeof v === 'object' ? Object.values(v).join(' — ') : v).join(', ');
    }
    if (typeof value === 'object') {
      return Object.entries(value).filter(([_, v]) => v && v !== 'null')
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' | ');
    }
    return value;
  };

  return (
    <div style={{ fontFamily: T.font }}>
      {records.map((doc, index) => {
        const mergedData = {};
        doc.reports?.forEach(report => {
          Object.entries(report.data || {}).forEach(([key, value]) => {
            const cleaned = cleanValue(value);
            if (cleaned) mergedData[key.replace(/_/g, ' ')] = cleaned;
          });
        });
        return (
          <CollapsibleRow key={index} label={doc.document_type} date={doc.created_at} badge="Record">
            {Object.keys(mergedData).length ? (
              <FlatTable
                rows={Object.entries(mergedData).map(([k, v]) => ({ parameter: k, value: v }))}
              />
            ) : (
              <p style={{ fontSize: '0.78rem', color: T.textMuted, margin: 0 }}>No data available</p>
            )}
          </CollapsibleRow>
        );
      })}
    </div>
  );
};

/* ─────────────────────────────────────────
   REPORT VIEWS SECTION  (th endpoint)
───────────────────────────────────────── */
const ReportViewsSection = ({ patientId }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPdf, setSelectedPdf] = useState(null);

  useEffect(() => {
    if (!patientId) return;
    setLoading(true);
    fetch(`${API_BASE}hms/users/data/context/th/patient/${patientId}`)
      .then(r => r.json())
      .then(json => setData(json.documents || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [patientId]);

  if (loading) {
    return (
      <div style={ST.loading}>
        <Activity size={14} className="animate-spin" />
        <span>Loading report views…</span>
      </div>
    );
  }

  const filtered = (data || []).filter(doc => {
    const tables   = doc?.sections?.tables || [];
    const sections = doc?.sections?.sections || [];
    return tables.some(t => t?.rows?.length > 0) || sections.some(s => s?.content?.trim());
  });

  if (!filtered.length) return null;

  return (
    <div style={{ fontFamily: T.font, marginBottom: '2rem' }}>
      {selectedPdf && <PDFViewer fileUrl={selectedPdf.url} fileName={selectedPdf.name} onClose={() => setSelectedPdf(null)} />}

      <div style={{ marginBottom: '1rem' }}>
        <span style={ST.pageLabel}>Medical records</span>
        <h2 style={{ ...ST.pageTitle, marginBottom: 0 }}>Report Views</h2>
      </div>

      {filtered.map((doc, idx) => {
        const fileName  = doc?.og_file_name || 'PDF Report';
        const fileUrl   = doc?.file_url;
        const fileExt   = fileName.split('.').pop()?.toUpperCase() || 'DOC';
        const tables    = doc?.sections?.tables || [];
        const sections  = doc?.sections?.sections || [];

        return (
          <CollapsibleRow
            key={idx}
            label={fileName}
            badge={fileExt}
            meta={`${tables.length + sections.length} section${tables.length + sections.length !== 1 ? 's' : ''}`}
            onViewPdf={fileUrl ? () => setSelectedPdf({ url: fileUrl, name: fileName }) : null}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* tables */}
              {tables.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.75rem' }}>
                    <Table size={13} color={T.textMuted} />
                    <span style={{ ...ST.sectionLabel, marginBottom: 0 }}>Data tables</span>
                  </div>
                  {tables.map((tbl, i) => (
                    <div key={i} style={{ border: `1px solid ${T.border}`, marginBottom: '1rem' }}>
                      {tbl.title && (
                        <div style={{ padding: '0.5rem 1rem', background: T.bgAlt, borderBottom: `1px solid ${T.border}` }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 400, color: T.textSec }}>{tbl.title}</span>
                        </div>
                      )}
                      <div style={ST.tableWrap}>
                        <table style={ST.table}>
                          {tbl.headers?.length > 0 && (
                            <thead>
                              <tr>{tbl.headers.map((h, j) => <th key={j} style={ST.th}>{h}</th>)}</tr>
                            </thead>
                          )}
                          <tbody>
                            {tbl.rows?.map((row, rIdx) => (
                              <tr key={rIdx} className="da-tbl-row">
                                {tbl.headers.map((h, cIdx) => (
                                  <td key={cIdx} style={ST.td}>
  {renderCellValue(row[h]) || '—'}
</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* text sections */}
              {sections.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.75rem' }}>
                    <FileText size={13} color={T.textMuted} />
                    <span style={{ ...ST.sectionLabel, marginBottom: 0 }}>Report content</span>
                  </div>
                  {sections.filter(s => s.content).map((sec, i) => (
                    <div key={i} style={{ border: `1px solid ${T.border}`, marginBottom: '0.75rem' }}>
                      {sec.title && (
                        <div style={{ padding: '0.5rem 1rem', background: T.bgAlt, borderBottom: `1px solid ${T.border}` }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 400, color: T.textSec }}>{sec.title}</span>
                        </div>
                      )}
                      <p style={{
                        margin: 0, padding: '0.875rem 1rem',
                        fontSize: '0.78rem', color: T.textSec,
                        lineHeight: 1.7, whiteSpace: 'pre-wrap', fontWeight: 300,
                      }}>
                        {sec.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </CollapsibleRow>
        );
      })}
    </div>
  );
};

/* ─────────────────────────────────────────
   ROOT COMPONENT
───────────────────────────────────────── */
const PatientRecordsTable = ({ patientId }) => {
  const [records, setRecords]           = useState({ records: [] });
  const [analysisRecords, setAnalysis]  = useState([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (!patientId) return;
    setLoading(true);
    fetch(`${API_BASE}hms/users/data/context/get_document_categories_by_patient?patient_id=${patientId}`)
      .then(r => r.json())
      .then(data => {
        const { medicalRecords, analysisRecords } = normalizeBackendDocuments(data.data || []);
        setRecords({ records: medicalRecords });
        setAnalysis(analysisRecords);
      })
      .catch(() => { setRecords({ records: [] }); setAnalysis([]); })
      .finally(() => setLoading(false));
  }, [patientId]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-tbl-row:hover td { background: #fafafa !important; }
        .da-records-root { font-family: 'Open Sans', sans-serif; font-weight: 300; color: #000; }
        @keyframes da-spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: da-spin 0.8s linear infinite; }
      `}</style>

      <div className="da-records-root">
        {loading ? (
          <div style={ST.loading}>
            <Activity size={14} className="animate-spin" />
            <span>Loading patient records…</span>
          </div>
        ) : (
          <>
            <ReportViewsSection patientId={patientId} />
            {analysisRecords.length > 0 && <ReportsAnalysis records={analysisRecords} />}
            {records.records.length > 0  && <MedicalRecordsView records={records.records} />}
            {analysisRecords.length === 0 && records.records.length === 0 && (
              <div style={ST.empty}>No patient records available.</div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default PatientRecordsTable;