import React, { useState } from 'react';
import { NeuropsychiatryProvider, useNeuropsychiatry } from './context/NeuropsychiatryContext';
import {
  PROCEDURE_SECTIONS,
  buildProcedureSession,
  procedureSessionResult,
  PROC_SLUG_TYPE,
} from './context/tabFieldMap';
import ProcedureTab from './tabs/ProcedureTab';
import Toast from './components/Toast';
import VoiceDictation from './components/VoiceDictation';
import SessionHistory, { formatSavedAt, sessionTime } from './components/SessionHistory';

// Fields already shown in an entry's header — skipped in the detail body.
const DETAIL_SKIP = ['procType', 'procCategory'];

const NeuropsychiatryProcedureContent = () => {
  const {
    formData,
    patientId,
    status,
    saving,
    loading,
    procedures,
    saveProcedureSession,
  } = useNeuropsychiatry();

  const [feedback, setFeedback] = useState(null); // { ok, text } | null

  // Flatten every session across every procedure into one date-wise list
  // (newest first) for the "History records" block.
  const allSessions = [];
  for (const [slug, proc] of Object.entries(procedures || {})) {
    const typeName = proc?.type || PROC_SLUG_TYPE[slug] || slug;
    for (const session of proc?.sessions || []) {
      allSessions.push({ slug, typeName, category: proc?.category, session });
    }
  }
  allSessions.sort(
    (a, b) => sessionTime(b.session, 'procDate') - sessionTime(a.session, 'procDate')
  );

  const historyEntries = allSessions.map(({ typeName, category, session }) => {
    const savedLabel = formatSavedAt(session.saved_at);
    return {
      id: session.id,
      dateLabel: session.data?.procDate || savedLabel || '—',
      title: typeName,
      note: procedureSessionResult(session.data),
      badge: `Session ${session.session_no}`,
      meta: category ? `${category}${savedLabel ? ` · saved ${savedLabel}` : ''}` : '',
      data: session.data,
      skipKeys: DETAIL_SKIP,
    };
  });

  // Each Save appends a session to the nested procedures→sessions model, so a
  // second procedure/type never overwrites an earlier one. buildProcedureSession
  // picks the common + selected-type fields out of the flat formData.
  const handleSave = async () => {
    const built = buildProcedureSession(formData);
    if (!built) {
      setFeedback({ ok: false, text: 'Select a Procedure Category and Type first.' });
      return;
    }
    const res = await saveProcedureSession(built);
    setFeedback(
      res.ok
        ? { ok: true, text: 'Procedure data saved successfully.' }
        : { ok: false, text: res.error || 'Failed to save procedure.' }
    );
  };

  return (
    <div
      style={{
        fontFamily: '"Open Sans", sans-serif',
        fontWeight: 300,
        background: '#ffffff',
        color: '#1a1a1a',
        fontSize: '13px',
        lineHeight: 1.5,
        padding: '16px 20px',
        borderRadius: '4px',
        border: '1px solid #e8e8e8',
      }}
    >
      {/* Floating save confirmation — pops up over the page, no inline banner */}
      <Toast toast={feedback} onClose={() => setFeedback(null)} />

      {/* Patient + case status — shows the record this entry attaches to */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid #e8e8e8',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: '#1a1a1a' }}>
            Procedure Entry
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#7a7a7a' }}>
            Attaches to the patient's active case
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: '#a8a8a8', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Patient
            </div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a' }}>
              {formData.hmsId || patientId || '—'}
            </div>
          </div>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 500,
              padding: '5px 11px',
              borderRadius: '3px',
              letterSpacing: '.03em',
              border: '1px solid',
              ...(status === 'Completed'
                ? { background: '#0a0a0a', color: '#ffffff', borderColor: '#0a0a0a' }
                : status === 'Active'
                ? { background: '#eef6ee', color: '#1e6b32', borderColor: '#cfe5d2' }
                : { background: '#f2f2f2', color: '#7a7a7a', borderColor: '#e8e8e8' }),
            }}
          >
            {loading ? 'Loading…' : status || 'Not saved'}
          </span>
        </div>
      </div>

      {/* ── Voice dictation — top of the page: record, read, or type the note,
             then autofill the long procedure form from it ─────────────────── */}
      <VoiceDictation section="procedure" />

      {/* ── History records — collapsible, default collapsed, date-wise ──────── */}
      <SessionHistory entries={historyEntries} />

      {/* ── Procedure entry (unchanged) ─────────────────────────────────────── */}
      <ProcedureTab />

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid #e8e8e8',
        }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          style={{
            border: 'none',
            borderRadius: '2px',
            padding: '9px 16px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: saving || loading ? 'not-allowed' : 'pointer',
            background: '#0a0a0a',
            color: '#ffffff',
            opacity: saving || loading ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Procedure data'}
        </button>
      </div>
    </div>
  );
};

const NeuropsychiatryProcedure = ({
  patientId: propPatientId,
  doctorId: propDoctorId,
  hospitalId: propHospitalId,
} = {}) => {
  // Resolve identifiers the same way as the main workflow (props win, else the
  // URL query string). The provider is scoped to PROCEDURE_SECTIONS so it only
  // hydrates/attaches procedures for the patient's active record.
  const searchParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const patientId =
    propPatientId || searchParams.get('patientId') || searchParams.get('patient_id') || '';
  const doctorId =
    propDoctorId || searchParams.get('doctorId') || searchParams.get('doctor_id') || '';
  const hospitalId =
    propHospitalId || searchParams.get('hospitalId') || searchParams.get('hospital_id') || '';

  return (
    <NeuropsychiatryProvider
      patientId={patientId}
      doctorId={doctorId}
      hospitalId={hospitalId}
      sections={PROCEDURE_SECTIONS}
    >
      <NeuropsychiatryProcedureContent />
    </NeuropsychiatryProvider>
  );
};

export default NeuropsychiatryProcedure;
