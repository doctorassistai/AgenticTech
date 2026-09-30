// VoiceAssistant.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Mic, MicOff, Volume2, VolumeX, Loader, X,
  Calendar, UserPlus, CalendarPlus, Clock, Waves, Radio, User, Check,
  Activity, Shield, FileUp, FileText, Save, Edit3, Trash2, AlertCircle,
  Layers, CheckCircle, Stethoscope, Pill, Send, Sparkles, ArrowLeft, RefreshCw,
  UploadCloud, Brain, Zap, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import PatientSummary from './PatientSummary';
import PreTreatmentAssessmentPanel from './Pretreatmentassessmentpanel';
import LongitudinalSummaryTab from './LongitudinalSummaryTab';
import TumorBoard from './TumorBoard';

// ─── History-flow components ───
import DICOMViewer from './DICOMViewer';
import DocumentRetrieval from './DocumentRetrieval';
import VitalsPanel from './VitalsPanel';
import MedicationListPanel from './MedicationListPanel';
import InvestigationListPanel from './InvestigationListPanel';
import TreatmentPlanPanel from './TreatmentPlanPanel';
import ClinicalNotePanel from './ClinicalNotePanel';

// ─── Reuse the EMR documentation panels for consultation docs ───
import MedicationPanel from './MedicationPanel';
import InvestigationNotes from './InvestigationPanel';
import ClinicalNotesPanel from './ClinicalNotesPanel';
import TreatmentPlan from './TreatmentPlan';
import StructuredNotePanel from './StructuredNotePanel';

// ✅ NEW — agentic SafeRx panel (same one DoctorDashboard uses)
import AgenticMedicationPanel from './Agenticmedicationpanel';
import Appointments from './appointmentvoice.jsx';
// ✅ NEW — Clinical workflow modules (one per left-menu item)
import PatientStory          from './PatientStory';
import BaselineVerification  from './BaselineVerification';
import NextClinicalDecision  from './NextClinicalDecision';
import TumourBoard           from './TumourBoard';
import FirstLinePlan         from './FirstLinePlan';
import TreatmentReadiness    from './TreatmentReadiness';
import Dosing                from './Dosing';
import DoctorDecision        from './DoctorDecision';
import Radiation             from './Radiation';
import Surgery               from './Surgery';
import Execution             from './Execution';
import PatientApp            from './PatientApp';
import Toxicity              from './Toxicity';
import Response              from './Response';
import LineChange            from './LineChange';
import Surveillance          from './Surveillance';
import Timeline              from './Timeline';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const SUMMARY_POLL_INTERVAL_MS = 15000;
const REPORT_POLL_INTERVAL_MS = 10000;

/* ============================================================
   BRAND TOKENS
   ============================================================ */
const C = {
  black:        '#000000',
  white:        '#ffffff',
  bgPrimary:    '#ffffff',
  bgSecondary:  '#fafafa',
  bgTertiary:   '#f5f5f5',
  textPrimary:  '#000000',
  textSecond:   '#444444',
  textMuted:    '#888888',
  border:       '#e0e0e0',
  borderStrong: '#000000',
};

const PART_A_ALL_SECTIONS = [
  'visit_type', 'registration', 'history', 'family_history',
  'substance_abuse', 'previous_cancer',
  'menstrual_history', 'obstetric_history',
  'contraceptive_history', 'hrt_history',
];
const PART_C_ALL_SECTIONS = [
  'general_examination', 'breast_examination', 'cervical_examination',
  'prescription', 'follow_up_advise', 'follow_up_visit',
];

const CONSULTATION_DOC_FEATURES = [
  { id: 'documentation-medication-analysis', label: 'Medication' },
  { id: 'documentation-investigation-notes', label: 'Investigations' },
  { id: 'documentation-clinical-notes',      label: 'Clinical Notes' },
  { id: 'documentation-treatment-plan',      label: 'Treatment Plan' },
  { id: 'structured-note',                   label: 'Structured Note' },
];

/* ─── Admission form schema ────────────────────────────────── */
const ADMISSION_FIELDS = [
  { key: 'hms_id',         label: 'HMS / Patient ID',   type: 'text',   required: true },
  { key: 'name',           label: 'Full Name',          type: 'text',   required: true },
  { key: 'date_of_birth',  label: 'Date of Birth',      type: 'date',   required: true },
  { key: 'gender',         label: 'Gender',             type: 'text',   required: true },
  { key: 'phone_number',   label: 'Phone Number',       type: 'tel',    required: true },
  { key: 'email',          label: 'Email',              type: 'email',  required: false },
  { key: 'blood_group',    label: 'Blood Group',        type: 'text',   required: false },
  { key: 'marital_status', label: 'Marital Status',     type: 'text',   required: false },
  { key: 'address',        label: 'Address',            type: 'text',   required: false },
  { key: 'education',      label: 'Education',          type: 'text',   required: false },
  { key: 'occupation',     label: 'Occupation',         type: 'text',   required: false },
  { key: 'annual_income',  label: 'Annual Income',      type: 'text',   required: false },
  { key: 'family_history', label: 'Family History',     type: 'text',   required: false },
];

const EMPTY_ADMISSION = {
  hms_id: '', name: '', date_of_birth: '', gender: '', phone_number: '',
  email: '', blood_group: '', marital_status: '', address: '',
  education: '', occupation: '', annual_income: '', family_history: '',
  hospital_id: '', doctor_id: '',
};

/* ✅ NEW — Clinical workflow modules for the selected patient */
const WORKFLOW_MODULES = [
  { id: 'story',    label: 'Patient story',             Component: PatientStory },
  { id: 'baseline', label: 'Baseline & verification',   Component: BaselineVerification },
  { id: 'next',     label: 'Next clinical decision',    Component: NextClinicalDecision },
  { id: 'mdt',      label: 'Tumour board',              Component: TumourBoard },
  { id: 'plan',     label: 'First-line plan',           Component: FirstLinePlan },
  { id: 'ready',    label: 'Treatment readiness',       Component: TreatmentReadiness },
  { id: 'dose',     label: 'Dosing',                    Component: Dosing },
  { id: 'decide',   label: 'Doctor decision',           Component: DoctorDecision },
  { id: 'rad',      label: 'Radiation',                 Component: Radiation },
  { id: 'surg',     label: 'Surgery',                   Component: Surgery },
  { id: 'exec',     label: 'Execution',                 Component: Execution },
  { id: 'app',      label: 'Patient app and alerts',    Component: PatientApp },
  { id: 'tox',      label: 'Toxicity',                  Component: Toxicity },
  { id: 'resp',     label: 'Response',                  Component: Response },
  { id: 'line',     label: 'Line change',               Component: LineChange },
  { id: 'surv',     label: 'Surveillance',              Component: Surveillance },
  { id: 'timeline', label: 'Timeline',                  Component: Timeline },
];

function buildGreeting() {
  const hour = new Date().getHours();
  const salutation =
    hour < 12 ? 'Good morning, Doctor.' :
    hour < 17 ? 'Good afternoon, Doctor.' :
    'Good evening, Doctor.';
  return `${salutation} Would you like to check your appointments, take a new appointment, or start a new admission?`;
}

const BASE_QUICK_ACTIONS = [
  { key: 'list',  label: 'List Appointments', text: 'List appointments',     icon: <Calendar size={15} /> },
  { key: 'book',  label: 'Take Appointment',  text: 'Book a new appointment', icon: <CalendarPlus size={15} /> },
  { key: 'admit', label: 'New Admission',     text: 'New admission',         icon: <UserPlus size={15} /> },
];

const PATIENT_QUICK_ACTIONS = [
  // ✅ NEW — Patient Story entry point
  { key: 'story',      label: 'Patient Story',            text: 'Open patient story',       icon: <User size={15} /> },
  { key: 'vitals',     label: 'Vitals',                   text: 'Record vitals',            icon: <Activity size={15} /> },
  { key: 'screening',  label: 'Preventive Screening',     text: 'Preventive screening',     icon: <Shield size={15} /> },
  { key: 'summary',    label: 'Generate Patient Summary', text: 'Generate patient summary', icon: <FileText size={15} /> },
  { key: 'tumor',      label: 'Tumor Board',              text: 'Tumor board',              icon: <Stethoscope size={15} /> },
  { key: 'history',    label: 'History',                  text: 'Show patient history',     icon: <Clock size={15} /> },
  { key: 'report',     label: 'Report Upload',            text: 'Upload report',            icon: <FileUp size={15} /> },
];

/* ============================================================
   Small presentational helpers
   ============================================================ */
const SugBtn = ({ icon, label, sub, onClick, variant = 'ghost', disabled }) => (
  <button type="button" className={`va-sbtn ${variant}`} onClick={onClick} disabled={disabled}>
    <span className="va-sbtn-icon">{icon}</span>
    <span className="va-sbtn-text">
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </span>
  </button>
);

const PanelShell = ({ icon, title, status, children }) => (
  <div className="va-panel">
    <div className="va-panel-head">
      <div>
        <div className="va-panel-label">Doctor Assist</div>
        <span className="va-panel-title">
          {icon} {title}
        </span>
      </div>
      {status && <span className="va-panel-status">{status}</span>}
    </div>
    <div className="va-panel-body">
      <div className="va-panel-inner">{children}</div>
    </div>
  </div>
);

const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
const SEVERITY_COLOR = {
  low:    { fg: '#2e7d32', bg: '#f1f8e9', border: '#c8e6c9' },
  medium: { fg: '#6d3a00', bg: '#fff8f0', border: '#ffe0b2' },
  high:   { fg: '#c62828', bg: '#fce4ec', border: '#ffcdd2' },
};

/* ============================================================
   ConflictBanner
   ============================================================ */
const ConflictBanner = ({ reconciliation }) => {
  if (!reconciliation || !reconciliation.has_conflicts) return null;
  const sev = reconciliation.max_severity || 'high';
  const colors = SEVERITY_COLOR[sev] || SEVERITY_COLOR.high;

  return (
    <div
      className="va-card"
      style={{
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        padding: '12px 14px',
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <AlertCircle size={15} style={{ color: colors.fg, flexShrink: 0 }} />
        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: colors.fg,
          }}
        >
          Data conflicts detected ({reconciliation.conflicts?.length || 0}) · max severity {sev}
        </span>
      </div>

      {reconciliation.normalized?.chemotherapy_status && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '0.62rem', color: colors.fg, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
            Chemotherapy status
          </div>
          <div style={{ fontSize: '0.75rem', color: colors.fg, marginTop: 2 }}>
            Status: <b>{reconciliation.normalized.chemotherapy_status.status}</b>
            {reconciliation.normalized.chemotherapy_status.reported_total_cycles != null && (
              <> · Reported total: <b>{reconciliation.normalized.chemotherapy_status.reported_total_cycles}</b></>
            )}
            {Array.isArray(reconciliation.normalized.chemotherapy_status.explicitly_completed_cycles) && (
              <> · Explicitly completed: <b>{reconciliation.normalized.chemotherapy_status.explicitly_completed_cycles.join(', ') || '—'}</b></>
            )}
            {Array.isArray(reconciliation.normalized.chemotherapy_status.explicitly_planned_cycles) &&
             reconciliation.normalized.chemotherapy_status.explicitly_planned_cycles.length > 0 && (
              <> · Still planned: <b>{reconciliation.normalized.chemotherapy_status.explicitly_planned_cycles.join(', ')}</b></>
            )}
            {reconciliation.normalized.chemotherapy_status.verification_required && (
              <> · <b>Verification required</b></>
            )}
          </div>
        </div>
      )}

      {(reconciliation.conflicts || []).map((c, i) => {
        const sColors = SEVERITY_COLOR[c.severity] || SEVERITY_COLOR.high;
        return (
          <div
            key={i}
            style={{
              borderTop: i > 0 ? `1px solid ${colors.border}` : 'none',
              paddingTop: i > 0 ? 8 : 0,
              marginTop: i > 0 ? 8 : 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  color: sColors.fg,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {SEVERITY_LABEL[c.severity] || c.severity}
              </span>
              <span style={{ fontSize: '0.62rem', color: C.textMuted }}>· {c.topic}</span>
            </div>
            <div style={{ fontSize: '0.76rem', color: colors.fg, marginTop: 2, lineHeight: 1.5 }}>
              {c.summary}
            </div>
            {c.suggested_action && (
              <div style={{ fontSize: '0.68rem', color: colors.fg, marginTop: 4, fontStyle: 'italic' }}>
                → {c.suggested_action}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ============================================================
   Local parser for admission dictation
   ============================================================ */
function parseAdmissionDictation(text) {
  const out = {};
  const grab = (re) => {
    const m = text.match(re);
    return m ? (m[1] || '').trim() : '';
  };

  out.name           = grab(/\b(?:name|patient name)\s*(?:is|:)?\s*([A-Za-z .'-]+?)(?=,|\s+(?:dob|date of birth|age|gender|sex|phone|mobile|email|blood|marital|address|education|occupation|income|family|hms|id)|$)/i);
  out.date_of_birth  = grab(/\b(?:dob|date of birth)\s*(?:is|:)?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[\/.-][0-9]{2}[\/.-][0-9]{4})/i);
  out.gender         = grab(/\b(?:gender|sex)\s*(?:is|:)?\s*(male|female|other)\b/i);
  out.phone_number   = grab(/\b(?:phone|mobile|contact|phone number|mobile number)\s*(?:is|:)?\s*([+0-9\-\s]{7,15})/i);
  out.email          = grab(/\b(?:email|e-mail|mail)\s*(?:is|:)?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
  out.blood_group    = grab(/\b(?:blood group|blood)\s*(?:is|:)?\s*(A\+|A-|B\+|B-|AB\+|AB-|O\+|O-)/i);
  out.marital_status = grab(/\b(?:marital status|married)\s*(?:is|:)?\s*(single|married|divorced|widowed|separated)\b/i);
  out.address        = grab(/\b(?:address|residence)\s*(?:is|:)?\s*([^,]+?)(?=,|\s+(?:education|occupation|income|family|blood|phone|email)|$)/i);
  out.education      = grab(/\b(?:education|qualification)\s*(?:is|:)?\s*([^,]+?)(?=,|\s+(?:occupation|income|family)|$)/i);
  out.occupation     = grab(/\b(?:occupation|profession|job)\s*(?:is|:)?\s*([^,]+?)(?=,|\s+(?:income|family|annual)|$)/i);
  out.annual_income  = grab(/\b(?:annual income|income)\s*(?:is|:)?\s*(?:Rs\.?|INR|₹)?\s*([0-9,]+(?:\.[0-9]+)?)/i);
  out.family_history = grab(/\b(?:family history|family)\s*(?:is|:)?\s*([^,]+?)(?=,|\s+(?:hms|id)|$)/i);
  out.hms_id         = grab(/\b(?:hms id|hms|patient id|id)\s*(?:is|:)?\s*([A-Za-z0-9_-]+)/i);

  if (out.date_of_birth) {
    const d = out.date_of_birth;
    if (/^\d{2}[\/.-]\d{2}[\/.-]\d{4}$/.test(d)) {
      const [dd, mm, yyyy] = d.split(/[\/.-]/);
      out.date_of_birth = `${yyyy}-${mm}-${dd}`;
    }
  }
  if (out.gender) out.gender = out.gender.charAt(0).toUpperCase() + out.gender.slice(1).toLowerCase();

  return Object.fromEntries(Object.entries(out).filter(([_, v]) => v));
}

/* ✅ NEW — Helper to extract per-section values from the flat/nested draft.
   Handles both:
     - flat keys:    { "family_history_mother": "diabetes" }
     - nested keys:  { "family_history": { "mother": "diabetes" } }
*/
function getSectionValues(draft, sectionKey) {
  if (!draft || typeof draft !== 'object') return [];

  const flat = Object.entries(draft)
    .filter(([k]) => k === sectionKey || k.startsWith(`${sectionKey}_`))
    .map(([k, v]) => [
      k === sectionKey ? k : k.slice(sectionKey.length + 1),
      v,
    ]);

  if (flat.length > 0) return flat;

  const nested = draft[sectionKey];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return Object.entries(nested);
  }
  if (nested !== undefined && nested !== null && typeof nested !== 'object') {
    return [[sectionKey, nested]];
  }
  return [];
}

/* ✅ NEW — Human-readable section labels */
const SECTION_LABELS = {
  visit_type: 'Visit type',
  registration: 'Registration',
  history: 'History',
  family_history: 'Family history',
  substance_abuse: 'Substance abuse',
  previous_cancer: 'Previous cancer',
  menstrual_history: 'Menstrual history',
  obstetric_history: 'Obstetric history',
  contraceptive_history: 'Contraceptive history',
  hrt_history: 'HRT history',
  general_examination: 'General examination',
  breast_examination: 'Breast examination',
  cervical_examination: 'Cervical examination',
  prescription: 'Prescription',
  follow_up_advise: 'Follow-up advise',
  follow_up_visit: 'Follow-up visit',
};

const prettySection = (key) =>
  SECTION_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const prettyField = (key) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/* ✅ NEW — Format a single scalar value for display. */
function formatScalar(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return null;
}

/* ✅ NEW — Recursive value renderer (scalar / array / object). */
function renderValueRows(value, depth = 0, keyPrefix = '') {
  const pad = depth * 14;
  const rows = [];

  // ── Scalar ──
  const scalar = formatScalar(value);
  if (scalar !== null && typeof value !== 'object') {
    rows.push(
      <div
        key={`${keyPrefix}-scalar`}
        style={{ paddingLeft: pad, fontSize: '0.76rem', color: '#444', lineHeight: 1.7 }}
      >
        {scalar}
      </div>
    );
    return rows;
  }

  // ── Array ──
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          return Object.entries(item)
            .map(([k, v]) => `${prettyField(k)}: ${formatScalar(v) ?? ''}`)
            .join(' · ');
        }
        return formatScalar(item);
      })
      .filter(Boolean);

    if (items.length === 0) return rows;

    rows.push(
      <div
        key={`${keyPrefix}-arr`}
        style={{ paddingLeft: pad, fontSize: '0.76rem', color: '#444', lineHeight: 1.7 }}
      >
        {items.join(', ')}
      </div>
    );
    return rows;
  }

  // ── Object ──
  if (value && typeof value === 'object') {
    const visible = Object.entries(value).filter(([_, v]) => {
      if (v === null || v === undefined || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    });

    if (visible.length === 0) return rows;

    for (const [k, v] of visible) {
      const isContainer = v !== null && typeof v === 'object';

      rows.push(
        <div
          key={`${keyPrefix}-${k}`}
          style={{
            paddingLeft: pad,
            fontSize: '0.76rem',
            color: '#444',
            lineHeight: 1.7,
          }}
        >
          <span style={{ color: '#888' }}>{prettyField(k)}: </span>
          {!isContainer && (
            <b style={{ wordBreak: 'break-word' }}>{formatScalar(v)}</b>
          )}
        </div>
      );

      if (isContainer) {
        rows.push(...renderValueRows(v, depth + 1, `${keyPrefix}-${k}`));
      }
    }
    return rows;
  }

  return rows;
}

const VoiceAssistant = ({ onPatientSelect, appointmentId: appointmentIdProp, onClose }) => {
  const [searchParams] = useSearchParams();
  const doctorId = searchParams.get('doctor_id');
  const appointmentIdFromUrl = appointmentIdProp || searchParams.get('appointment_id');

  const [isLive, setIsLive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [typedInput, setTypedInput] = useState('');
  const [response, setResponse] = useState('');
  const [conversation, setConversation] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [currentPatientId, setCurrentPatientId] = useState(null);
  const [currentPatientName, setCurrentPatientName] = useState(null);
  const [currentAppointmentId, setCurrentAppointmentId] = useState(appointmentIdFromUrl || null);

  const [appointments, setAppointments] = useState([]);
  const [rightPanel, setRightPanel] = useState(null);
  const [patientMenuVisible, setPatientMenuVisible] = useState(false);

  // ✅ NEW — workflow view state
  const [workflowView, setWorkflowView] = useState('story');

  const [doctorName, setDoctorName] = useState('');
  const [doctorSpeciality, setDoctorSpeciality] = useState('');

  // Vitals
  const [pendingVitals, setPendingVitals] = useState(null);
  const [editableVitals, setEditableVitals] = useState({});
  const [awaitingVitalsConfirm, setAwaitingVitalsConfirm] = useState(false);
  const [vitalsSaved, setVitalsSaved] = useState(false);

  // Preventive
  const [preventiveSession, setPreventiveSession] = useState(null);
  // ✅ NEW — toggle between "show filled only" and "show all sections"
  const [showFilledOnly, setShowFilledOnly] = useState(true);

  // Summary
  const [summaryJob, setSummaryJob] = useState(null);

  // Pre-treatment / longitudinal triggers
  const [pretreatmentTrigger, setPretreatmentTrigger] = useState(0);
  const [longitudinalTrigger, setLongitudinalTrigger] = useState(0);

  // Consultation
  const [consultation, setConsultation] = useState(null);

  // ✅ NEW — Agentic SafeRx state
  const [agenticMedData, setAgenticMedData] = useState(null);
  const [isAgenticMedLoading, setIsAgenticMedLoading] = useState(false);
  const [useAgenticMedication, setUseAgenticMedication] = useState(false);

  // Clinical Reasoning / Autonomous state
  const [reasoningJob, setReasoningJob] = useState(null);
  const [autonomousJob, setAutonomousJob] = useState(null);
  const [reasoningHistory, setReasoningHistory] = useState([]);
  const [autonomousHistory, setAutonomousHistory] = useState([]);
  const [clinicalQueryInput, setClinicalQueryInput] = useState('');

  // Report upload flow
  const [reportStage, setReportStage] = useState(null);
  const [reportTiming, setReportTiming] = useState(null);
  const [reportCategoryMode, setReportCategoryMode] = useState(null);
  const [reportFile, setReportFile] = useState(null);
  const [reportUploading, setReportUploading] = useState(false);
  const [reportMessage, setReportMessage] = useState(null);
  const [reportProcessing, setReportProcessing] = useState(false);
  const [reportProcessStatus, setReportProcessStatus] = useState(null);

  // Pending investigations
  const [pendingInvestigations, setPendingInvestigations] = useState([]);
  const [loadingInvestigations, setLoadingInvestigations] = useState(false);
  const [investigationFiles, setInvestigationFiles] = useState({});
  const [uploadingInvestigationId, setUploadingInvestigationId] = useState(null);
  const [investigationMessage, setInvestigationMessage] = useState(null);

  // History flow
  const [historyStage, setHistoryStage] = useState(null);
  const [historyTab, setHistoryTab] = useState(null);

  /* ── New Admission (patient registration) flow ── */
  const [admissionStage, setAdmissionStage] = useState(null);
  const [admissionDictation, setAdmissionDictation] = useState('');
  const [admissionData, setAdmissionData] = useState({ ...EMPTY_ADMISSION });
  const [admissionMessage, setAdmissionMessage] = useState(null);
  const [admissionSubmitting, setAdmissionSubmitting] = useState(false);
  const [admissionResult, setAdmissionResult] = useState(null);
  const [showAdmissionJson, setShowAdmissionJson] = useState(false);

  const greeting = useMemo(() => buildGreeting(), []);

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const synthRef = useRef(window.speechSynthesis);
  const conversationRef = useRef([]);
  const streamRef = useRef(null);
  const isProcessingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const conversationIdRef = useRef(null);
  const currentPatientIdRef = useRef(null);
  const currentAppointmentIdRef = useRef(null);
  const preventiveSessionRef = useRef(null);
  const consultationRef = useRef(null);
  const summaryPollRef = useRef(null);
  const chatEndRef = useRef(null);
  const treatmentPlanRef = useRef(null);
  const reportPollRef = useRef(null);
  const reasoningEndRef = useRef(null);
  const autonomousEndRef = useRef(null);
  const agenticMedDataRef = useRef(null);

  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { currentPatientIdRef.current = currentPatientId; }, [currentPatientId]);
  useEffect(() => { currentAppointmentIdRef.current = currentAppointmentId; }, [currentAppointmentId]);
  useEffect(() => { preventiveSessionRef.current = preventiveSession; }, [preventiveSession]);
  useEffect(() => { consultationRef.current = consultation; }, [consultation]);
  useEffect(() => { agenticMedDataRef.current = agenticMedData; }, [agenticMedData]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation, isProcessing]);

  useEffect(() => {
    if (reasoningEndRef.current) reasoningEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [reasoningHistory]);
  useEffect(() => {
    if (autonomousEndRef.current) autonomousEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [autonomousHistory]);

  // Fetch doctor details once
  useEffect(() => {
    if (!doctorId) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doctor_id: doctorId }),
        });
        const data = await res.json();
        if (data.status === 'success') {
          setDoctorName(data.doctor_name || '');
          setDoctorSpeciality(data.doctor_speciality || '');
        }
      } catch { /* silent */ }
    })();
  }, [doctorId]);

  /* ============================================================
     TTS — no auto-restart of recording
     ============================================================ */
  const speakText = useCallback((text) => {
    if (!synthRef.current || !text) return;
    synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voices = synthRef.current.getVoices();
    const preferredVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Premium'));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    synthRef.current.speak(utterance);
  }, []);

  /* ============================================================
     HTTP helpers
     ============================================================ */
  const postProcess = useCallback(async ({ text, editedVitals = null, clinicalPanel = null }) => {
    const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        doctor_id: doctorId,
        conversation_id: conversationIdRef.current,
        patient_id: currentPatientIdRef.current,
        appointment_id: currentAppointmentIdRef.current,
        edited_vitals: editedVitals,
        clinical_panel: clinicalPanel,
      }),
    });
    return await res.json();
  }, [doctorId]);

  const postPreventiveDictate = useCallback(async ({ part, text, existing }) => {
    const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/preventive/dictate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: doctorId,
        patient_id: currentPatientIdRef.current,
        part,
        text,
        existing,
      }),
    });
    return await res.json();
  }, [doctorId]);

  const savePreventivePart = useCallback(async ({ part, data }) => {
    const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/preventive/save-part`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: doctorId,
        patient_id: currentPatientIdRef.current,
        appointment_id: currentAppointmentIdRef.current,
        part,
        data,
      }),
    });
    return await res.json();
  }, [doctorId]);

  /* ============================================================
     Consultation HTTP helpers
     ============================================================ */
  const consultationSafeRx = useCallback(async (dictation, useAgentic = false) => {
    const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/consultation/safe-rx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: currentPatientIdRef.current,
        doctor_id: doctorId,
        dictation,
        use_agentic: useAgentic,
      }),
    });
    return await res.json();
  }, [doctorId]);

  const runAgenticMedication = useCallback(async (dictationText) => {
    if (!dictationText?.trim()) return null;
    setIsAgenticMedLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/medication-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: currentPatientIdRef.current,
          doctor_id: doctorId,
          prescription_text: dictationText,
        }),
      });
      const json = await res.json();

      const cleaned = {
        prescriptions: (json.prescriptions || []).map(
          ({ raw_extracted_text, safety_alerts, ...rest }) => rest
        ),
      };

      setAgenticMedData(json);
      return cleaned;
    } catch (err) {
      console.error('❌ Agentic medication failed:', err);
      return null;
    } finally {
      setIsAgenticMedLoading(false);
    }
  }, [doctorId]);

  const consultationGenerateDocs = useCallback(async (dictation) => {
    const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/consultation/generate-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: currentPatientIdRef.current,
        doctor_id: doctorId,
        dictation,
      }),
    });
    return await res.json();
  }, [doctorId]);

  const consultationSaveDocs = useCallback(async (documents, dictation, analyzedDictation) => {
    const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/consultation/save-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: currentPatientIdRef.current,
        doctor_id: doctorId,
        documents,
        dictation: dictation || '',
        analyzed_dictation: analyzedDictation || null,
      }),
    });
    return await res.json();
  }, [doctorId]);

  const analyzeConsultationTranscript = useCallback(async (dictationText) => {
    if (!dictationText?.trim()) return null;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/analyze-transcript/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: dictationText,
          specialty: 'none',
          consultation_type: 'none',
          patient_id: currentPatientIdRef.current,
          doctor_id: doctorId,
          type_of_conversation: 'dictation',
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.data?.clinical_summary) return null;
      return {
        clinical_summary: json.data.clinical_summary,
        medications: Array.isArray(json.data.clinical_summary.medications)
          ? json.data.clinical_summary.medications : [],
        treatment_plan: Array.isArray(json.data.clinical_summary.treatment_plan)
          ? json.data.clinical_summary.treatment_plan : [],
        investigation_orders: Array.isArray(json.data.clinical_summary.investigation_orders)
          ? json.data.clinical_summary.investigation_orders : [],
      };
    } catch (err) {
      console.error('Analyze consultation transcript failed:', err);
      return null;
    }
  }, [doctorId]);

  const verifyConsultationTranscription = useCallback(async (dictationText) => {
    if (!dictationText?.trim()) return null;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/verify-transcription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: 'transcription',
          doctor_id: doctorId,
          patient_id: currentPatientIdRef.current,
          transcript: dictationText,
        }),
      });
      const json = await res.json().catch(() => ({}));
      console.log('verify-transcription response:', json);
      return json;
    } catch (err) {
      console.error('Verify consultation transcription failed:', err);
      return null;
    }
  }, [doctorId]);

  /* ============================================================
     Clinical Reasoning / Autonomous HTTP helpers
     ============================================================ */
  const runClinicalReasoning = useCallback(async (query) => {
    if (!currentPatientIdRef.current) {
      setError('Select a patient first');
      return null;
    }
    if (!query || !query.trim()) {
      setError('Type or dictate a question for the reasoning agent');
      return null;
    }
    setError('');
    setReasoningJob({ status: 'loading' });
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical/reasoning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: currentPatientIdRef.current,
          doctor_id: doctorId,
          query: query.trim(),
          conversation_id: conversationIdRef.current || '',
        }),
      });
      const json = await res.json();

      if (res.ok && json.status === 'clarification_needed') {
        const data = json;
        setReasoningJob({ status: 'done', data, clarification: true });
        setReasoningHistory(prev => [
          ...prev,
          {
            question: query.trim(),
            answer: data.answer || data.clarification?.reason || '',
            ts: new Date().toLocaleTimeString(),
            full: data,
            clarification: true,
          },
        ]);
        return data;
      }

      if (res.ok && json.status === 'success') {
        const data = json.data || json;
        setReasoningJob({ status: 'done', data });
        setReasoningHistory(prev => [
          ...prev,
          {
            question: query.trim(),
            answer: data.answer || data.clinical_picture || '',
            ts: new Date().toLocaleTimeString(),
            full: data,
          },
        ]);
        return data;
      }

      const msg = json.detail || 'Reasoning failed';
      setReasoningJob({ status: 'error', error: msg });
      setError(msg);
      return null;
    } catch (err) {
      console.error('Clinical reasoning error:', err);
      setReasoningJob({ status: 'error', error: 'Network error' });
      setError('Network error');
      return null;
    }
  }, [doctorId]);

  const runClinicalAutonomous = useCallback(async (query) => {
    if (!currentPatientIdRef.current) {
      setError('Select a patient first');
      return null;
    }
    if (!query || !query.trim()) {
      setError('Type or dictate a question for the autonomous agent');
      return null;
    }
    setError('');
    setAutonomousJob({ status: 'loading' });
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical/autonomous`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: currentPatientIdRef.current,
          doctor_id: doctorId,
          query: query.trim(),
          conversation_id: conversationIdRef.current || '',
        }),
      });
      const json = await res.json();

      if (res.ok && json.status === 'clarification_needed') {
        const data = json;
        setAutonomousJob({ status: 'done', data, clarification: true });
        setAutonomousHistory(prev => [
          ...prev,
          {
            question: query.trim(),
            answer: data.answer || data.clarification?.reason || '',
            ts: new Date().toLocaleTimeString(),
            full: data,
            clarification: true,
          },
        ]);
        return data;
      }

      if (res.ok && json.status === 'success') {
        const data = json.data || json;
        setAutonomousJob({ status: 'done', data });
        const reasoning = data.reasoning || {};
        setAutonomousHistory(prev => [
          ...prev,
          {
            question: query.trim(),
            answer: reasoning.answer || reasoning.clinical_picture || data.answer || '',
            ts: new Date().toLocaleTimeString(),
            full: data,
          },
        ]);
        return data;
      }

      const msg = json.detail || 'Autonomous run failed';
      setAutonomousJob({ status: 'error', error: msg });
      setError(msg);
      return null;
    } catch (err) {
      console.error('Clinical autonomous error:', err);
      setAutonomousJob({ status: 'error', error: 'Network error' });
      setError('Network error');
      return null;
    }
  }, [doctorId]);

  const confirmAutonomousAction = useCallback(async (action) => {
    if (!currentPatientIdRef.current) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical/autonomous/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: currentPatientIdRef.current,
          doctor_id: doctorId,
          action,
        }),
      });
      const json = await res.json();
      const result = json.data || json;

      setAutonomousJob(prev => {
        if (!prev || !prev.data) return prev;
        const pending = (prev.data.pending_actions || []).filter(a => a.id !== action.id);
        const executed = [...(prev.data.executed_actions || []), result];
        return { ...prev, data: { ...prev.data, pending_actions: pending, executed_actions: executed } };
      });

      if (result?.executed === false) {
        setError(result.result || 'Action could not be executed');
      }
    } catch (err) {
      console.error('Confirm action error:', err);
      setError('Failed to confirm that action');
    }
  }, [doctorId]);

  const dismissAutonomousAction = useCallback((actionId) => {
    setAutonomousJob(prev => {
      if (!prev || !prev.data) return prev;
      const pending = (prev.data.pending_actions || []).filter(a => a.id !== actionId);
      return { ...prev, data: { ...prev.data, pending_actions: pending } };
    });
  }, []);

  const closeReasoningPanel = useCallback(() => {
    setReasoningJob(null);
    setReasoningHistory([]);
    setClinicalQueryInput('');
    setRightPanel(null);
    setPatientMenuVisible(true);
  }, []);

  const closeAutonomousPanel = useCallback(() => {
    setAutonomousJob(null);
    setAutonomousHistory([]);
    setClinicalQueryInput('');
    setRightPanel(null);
    setPatientMenuVisible(true);
  }, []);

  const clearClinicalAgentMemory = useCallback(async () => {
    if (!conversationIdRef.current) return;
    try {
      await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical/clear-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationIdRef.current }),
      });
    } catch (err) {
      console.warn('clear clinical agent memory failed', err);
    }
  }, []);

  /* ============================================================
     Patient Summary — start + poll
     ============================================================ */
  const stopSummaryPolling = useCallback(() => {
    if (summaryPollRef.current) {
      clearInterval(summaryPollRef.current);
      summaryPollRef.current = null;
    }
  }, []);

  const checkSummaryStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/status/summary/${currentPatientIdRef.current}/${doctorId}`,
        { method: 'GET' }
      );
      const json = await res.json();
      return json?.status || 'processing';
    } catch (err) {
      console.error('Summary status check failed', err);
      return 'processing';
    }
  }, [doctorId]);

  const startPatientSummary = useCallback(async () => {
    if (!currentPatientIdRef.current || !doctorId) {
      setError('Select a patient first');
      return;
    }
    setError('');
    setSummaryJob({ status: 'processing', trigger: 0, error: '' });

    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/ai-legacy/clinical-reasoning-summary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: currentPatientIdRef.current,
            doctor_id: doctorId,
          }),
        }
      );

      if (!res.ok) {
        setSummaryJob({ status: 'failed', trigger: 0, error: 'Failed to start summary generation' });
        return;
      }

      stopSummaryPolling();
      summaryPollRef.current = setInterval(async () => {
        const status = await checkSummaryStatus();
        if (status === 'completed') {
          stopSummaryPolling();
          setSummaryJob(prev => ({
            status: 'completed',
            trigger: (prev?.trigger || 0) + 1,
            error: '',
          }));
        } else if (status === 'failed') {
          stopSummaryPolling();
          setSummaryJob(prev => ({
            status: 'failed',
            trigger: prev?.trigger || 0,
            error: 'Summary generation failed',
          }));
        }
      }, SUMMARY_POLL_INTERVAL_MS);
    } catch (err) {
      console.error('Failed to start patient summary:', err);
      setSummaryJob({ status: 'failed', trigger: 0, error: 'Network error' });
    }
  }, [doctorId, checkSummaryStatus, stopSummaryPolling]);

  /* ============================================================
     Consultation orchestration
     ============================================================ */
  const startConsultation = useCallback(() => {
    setPatientMenuVisible(false);
    setRightPanel('consultation');
    setConsultation({
      stage: 'dictating',
      dictation: '',
      medicationData: null,
      agenticMedicationData: null,
      documents: null,
      error: null,
      showSaveConfirm: false,
    });

    setAgenticMedData(null);
    setIsAgenticMedLoading(false);

    const msg = "Consultation started. Dictate or type the consultation notes — I'll show them on the right for review.";
    const newConv = [
      ...conversationRef.current,
      { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
    ];
    setConversation(newConv);
    conversationRef.current = newConv;
    setResponse(msg);
    speakText(msg);
  }, [speakText]);

  const runConsultationSafeRx = useCallback(async () => {
    const c = consultationRef.current;
    if (!c || !c.dictation.trim()) {
      setError('Add some dictation before running SafeRx');
      return;
    }
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError('');
    setConsultation(prev => ({ ...prev, stage: 'safedone', error: null }));

    try {
      if (useAgenticMedication) {
        const cleaned = await runAgenticMedication(c.dictation);
        if (cleaned) {
          setConsultation(prev => ({
            ...prev,
            stage: 'safedone',
            agenticMedicationData: cleaned,
            medicationData: null,
          }));
          const msg = 'Agentic SafeRx analysis complete. Review the AI-powered output on the right.';
          const newConv = [
            ...conversationRef.current,
            { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
          ];
          setConversation(newConv);
          conversationRef.current = newConv;
          setResponse(msg);
          speakText(msg);
        } else {
          setError('Agentic SafeRx failed');
          setConsultation(prev => ({ ...prev, stage: 'reviewing', error: 'Agentic SafeRx failed' }));
        }
      } else {
        const data = await consultationSafeRx(c.dictation, false);
        if (data && data.status === 'success') {
          const medData = data.data || {};
          setConsultation(prev => ({
            ...prev,
            stage: 'safedone',
            medicationData: medData,
            agenticMedicationData: null,
          }));
          const msg = 'SafeRx analysis complete. Review the medication output on the right, or generate documentation.';
          const newConv = [
            ...conversationRef.current,
            { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
          ];
          setConversation(newConv);
          conversationRef.current = newConv;
          setResponse(msg);
          speakText(msg);
        } else {
          setError('SafeRx failed');
          setConsultation(prev => ({ ...prev, stage: 'reviewing', error: 'SafeRx failed' }));
        }
      }
    } catch (err) {
      console.error('SafeRx error:', err);
      setError('SafeRx failed');
      setConsultation(prev => ({ ...prev, stage: 'reviewing', error: 'SafeRx failed' }));
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [consultationSafeRx, runAgenticMedication, useAgenticMedication, speakText]);

  const runConsultationGenerateDocs = useCallback(async () => {
    const c = consultationRef.current;
    if (!c || !c.dictation.trim()) {
      setError('Add some dictation before generating docs');
      return;
    }
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError('');
    setConsultation(prev => ({ ...prev, stage: 'generating', error: null }));

    try {
      const data = await consultationGenerateDocs(c.dictation);
      if (data && data.status === 'success') {
        setConsultation(prev => ({
          ...prev,
          stage: 'generated',
          documents: data.documents || {},
        }));
        const count = Object.values(data.documents || {}).filter(Boolean).length;
        const msg = `Generated ${count} documentation item${count === 1 ? '' : 's'}. Review and edit them on the right, then save.`;
        const newConv = [
          ...conversationRef.current,
          { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
        ];
        setConversation(newConv);
        conversationRef.current = newConv;
        setResponse(msg);
        speakText(msg);
      } else {
        setError('Documentation generation failed');
        setConsultation(prev => ({ ...prev, stage: 'reviewing', error: 'Documentation generation failed' }));
      }
    } catch (err) {
      console.error('Generate docs error:', err);
      setError('Documentation generation failed');
      setConsultation(prev => ({ ...prev, stage: 'reviewing', error: 'Documentation generation failed' }));
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [consultationGenerateDocs, speakText]);

  const runConsultationSaveDocs = useCallback(async () => {
    const c = consultationRef.current;
    if (!c || !c.documents) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError('');
    setConsultation(prev => ({ ...prev, stage: 'saving', showSaveConfirm: false }));

    try {
      let analyzedDictation = null;
      if (c.dictation?.trim()) {
        analyzedDictation = await analyzeConsultationTranscript(c.dictation);
      }

      if (c.dictation?.trim()) {
        await verifyConsultationTranscription(c.dictation);
      }

      let extraPlan = null;
      try {
        if (treatmentPlanRef.current?.saveTreatmentPlanData) {
          extraPlan = treatmentPlanRef.current.saveTreatmentPlanData();
        }
      } catch (err) {
        console.warn('TreatmentPlan saveTreatmentPlanData() failed:', err);
      }

      const documents = Object.entries(c.documents)
        .filter(([_, v]) => v != null)
        .map(([fid, val]) => {
          let finalVal = val;
          if (fid === 'documentation-treatment-plan' && extraPlan?.finaloutput) {
            finalVal = extraPlan.finaloutput;
          }
          if (fid === 'documentation-medication-analysis' && c.agenticMedicationData) {
            finalVal = c.agenticMedicationData;
          }
          return {
            status: 'success',
            feature_id: fid,
            feature_name: CONSULTATION_DOC_FEATURES.find(f => f.id === fid)?.label || fid,
            display_method: 'canvas',
            finaloutput: finalVal,
            metadata: {
              doctor_id: doctorId,
              patient_id: currentPatientIdRef.current,
              saved_from: 'voice-assistant-consultation',
              dictation_text: c.dictation || '',
              analyzed_dictation: analyzedDictation || null,
            },
          };
        });

      const data = await consultationSaveDocs(documents, c.dictation, analyzedDictation);

      if (data && data.status === 'success') {
        setConsultation(prev => ({ ...prev, stage: 'reviewing', showSaveConfirm: false }));
        setRightPanel(null);
        setPatientMenuVisible(true);
        const msg = `Saved ${documents.length} document${documents.length === 1 ? '' : 's'} successfully.`;
        const newConv = [
          ...conversationRef.current,
          { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
        ];
        setConversation(newConv);
        conversationRef.current = newConv;
        setResponse(msg);
        speakText(msg);
        setTimeout(() => {
          setConsultation(null);
          setAgenticMedData(null);
        }, 800);
      } else {
        setError('Save failed');
        setConsultation(prev => ({ ...prev, stage: 'generated', error: 'Save failed' }));
      }
    } catch (err) {
      console.error('Save docs error:', err);
      setError('Save failed');
      setConsultation(prev => ({ ...prev, stage: 'generated', error: 'Save failed' }));
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [
    consultationSaveDocs,
    analyzeConsultationTranscript,
    verifyConsultationTranscription,
    doctorId,
    speakText,
  ]);

  const updateConsultationDictation = useCallback((text) => {
    setConsultation(prev => prev ? { ...prev, dictation: text } : prev);
  }, []);

  const updateConsultationDocument = useCallback((fid, value) => {
    setConsultation(prev => prev ? {
      ...prev,
      documents: { ...(prev.documents || {}), [fid]: value },
    } : prev);
  }, []);

  const cancelConsultation = useCallback(() => {
    setConsultation(null);
    setAgenticMedData(null);
    setIsAgenticMedLoading(false);
    setRightPanel(null);
    setPatientMenuVisible(true);
    const msg = 'Consultation closed.';
    const newConv = [
      ...conversationRef.current,
      { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
    ];
    setConversation(newConv);
    conversationRef.current = newConv;
    setResponse(msg);
  }, []);

  /* ============================================================
     Report upload — helpers
     ============================================================ */
  const resetReportFlow = useCallback(() => {
    setReportStage(null);
    setReportTiming(null);
    setReportCategoryMode(null);
    setReportFile(null);
    setReportMessage(null);
    setReportProcessing(false);
    setReportProcessStatus(null);
    if (reportPollRef.current) {
      clearInterval(reportPollRef.current);
      reportPollRef.current = null;
    }
  }, []);

  const pollReportProcessingStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/status/${currentPatientIdRef.current}/${doctorId}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setReportProcessStatus(data);
      if (data.status === 'completed') {
        setReportProcessing(false);
        if (reportPollRef.current) {
          clearInterval(reportPollRef.current);
          reportPollRef.current = null;
        }
        setReportMessage({ type: 'success', text: 'Processing complete 🎉' });
        setReportStage('done');
      } else if (data.status === 'failed') {
        setReportProcessing(false);
        if (reportPollRef.current) {
          clearInterval(reportPollRef.current);
          reportPollRef.current = null;
        }
        setReportMessage({ type: 'error', text: 'Processing failed.' });
      }
    } catch (err) {
      console.error('report status poll failed', err);
    }
  }, [doctorId]);

  const startReportProcessingPolling = useCallback(() => {
    if (reportPollRef.current) return;
    setReportProcessing(true);
    pollReportProcessingStatus();
    reportPollRef.current = setInterval(pollReportProcessingStatus, REPORT_POLL_INTERVAL_MS);
  }, [pollReportProcessingStatus]);

  const handleReportFileChange = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setReportFile(f);
    setReportMessage(null);
  }, []);

  const handleReportUpload = useCallback(async () => {
    if (!reportFile) {
      setReportMessage({ type: 'error', text: 'Please select a file first.' });
      return;
    }
    const formData = new FormData();
    formData.append('doctor_id', doctorId);
    formData.append('patient_id', currentPatientIdRef.current);
    formData.append('appointment_id', currentAppointmentIdRef.current || '');
    formData.append('hospital_id', '');
    formData.append('report_timing', reportTiming === 'previous' ? 'previous' : 'current');
    formData.append('report_date', new Date().toISOString().slice(0, 10));
    formData.append('upload_mode', 'document');
    formData.append('file', reportFile);

    try {
      setReportUploading(true);
      setReportMessage(null);
      const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/proxy/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Upload failed');
      }
      setReportMessage({ type: 'info', text: 'Uploaded. Processing started…' });
      setReportFile(null);
      startReportProcessingPolling();
    } catch (err) {
      console.error('report upload failed', err);
      setReportMessage({ type: 'error', text: err.message || 'Upload failed.' });
    } finally {
      setReportUploading(false);
    }
  }, [reportFile, reportTiming, doctorId, startReportProcessingPolling]);

  const fetchPendingInvestigations = useCallback(async () => {
    setLoadingInvestigations(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/orchestration/oncology-investigations/pending?patient_id=${currentPatientIdRef.current}&doctor_id=${doctorId}`
      );
      if (!res.ok) { setPendingInvestigations([]); return; }
      const json = await res.json();
      if (json.status === 'success') {
        setPendingInvestigations(json.investigations || []);
      } else {
        setPendingInvestigations([]);
      }
    } catch (err) {
      console.error('❌ Failed to fetch pending investigations:', err);
      setPendingInvestigations([]);
    } finally {
      setLoadingInvestigations(false);
    }
  }, [doctorId]);

  const handlePendingInvestigationFileChange = useCallback((invId, e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setInvestigationFiles(prev => ({ ...prev, [invId]: f }));
    setInvestigationMessage(null);
  }, []);

  const handlePendingInvestigationUpload = useCallback(async (invId) => {
    const f = investigationFiles[invId];
    if (!f) {
      setInvestigationMessage({ id: invId, type: 'error', text: 'Select a file first.' });
      return;
    }
    const formData = new FormData();
    formData.append('doctor_id', doctorId);
    formData.append('patient_id', currentPatientIdRef.current);
    formData.append('investigation_id', invId);
    formData.append('file', f);

    try {
      setUploadingInvestigationId(invId);
      setInvestigationMessage(null);
      const res = await fetch(
        `${API_BASE_URL}hms/users/cm/storage/oncology-investigations/upload-file-url`,
        { method: 'POST', body: formData }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Upload failed');

      setPendingInvestigations(prev => prev.filter(x => x.id !== invId));
      setInvestigationFiles(prev => {
        const n = { ...prev };
        delete n[invId];
        return n;
      });
      setInvestigationMessage({ id: invId, type: 'success', text: 'Uploaded successfully.' });
    } catch (err) {
      console.error('investigation upload failed', err);
      setInvestigationMessage({ id: invId, type: 'error', text: err.message || 'Upload failed.' });
    } finally {
      setUploadingInvestigationId(null);
    }
  }, [investigationFiles, doctorId]);

  /* ============================================================
     History flow helpers
     ============================================================ */
  const resetHistoryFlow = useCallback(() => {
    setHistoryStage(null);
    setHistoryTab(null);
  }, []);

  /* ============================================================
     New Admission helpers
     ============================================================ */
  const resetAdmissionFlow = useCallback(() => {
    setAdmissionStage(null);
    setAdmissionDictation('');
    setAdmissionData({ ...EMPTY_ADMISSION });
    setAdmissionMessage(null);
    setAdmissionSubmitting(false);
    setAdmissionResult(null);
    setShowAdmissionJson(false);
  }, []);

  const submitAdmission = useCallback(async () => {
    if (admissionSubmitting) return;
    const missing = ADMISSION_FIELDS
      .filter((f) => f.required && !String(admissionData[f.key] || '').trim())
      .map((f) => f.label);

    if (missing.length) {
      setAdmissionMessage({
        type: 'error',
        text: `Please fill required fields: ${missing.join(', ')}`,
      });
      return;
    }

    const payload = {
      ...admissionData,
      hospital_id: admissionData.hospital_id || '',
      doctor_id: admissionData.doctor_id || doctorId || '',
      created_at: new Date().toISOString(),
    };

    try {
      setAdmissionSubmitting(true);
      setAdmissionMessage(null);
      setAdmissionStage('submitting');

      const res = await fetch(`${API_BASE_URL}hms/users/patients/patientadd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || (json.status && json.status !== 'success')) {
        throw new Error(json.message || json.detail || 'Registration failed');
      }

      setAdmissionResult(json);
      setAdmissionStage('done');
      setAdmissionMessage({ type: 'success', text: 'Patient registered successfully.' });

      const newConv = [
        ...conversationRef.current,
        {
          role: 'assistant',
          text: `Patient registered successfully. HMS ID: ${payload.hms_id}. Patient ID: ${json.patient_id || '—'}.`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ];
      setConversation(newConv);
      conversationRef.current = newConv;
      setResponse(`Patient registered successfully. HMS ID: ${payload.hms_id}.`);
      speakText('Patient registered successfully.');
    } catch (err) {
      console.error('admission submit failed', err);
      setAdmissionStage('reviewing');
      setAdmissionMessage({ type: 'error', text: err.message || 'Registration failed.' });
    } finally {
      setAdmissionSubmitting(false);
    }
  }, [admissionData, admissionSubmitting, doctorId, speakText]);

  /* ============================================================
     Apply backend /process response
     ============================================================ */
  const applyBackendResponse = useCallback((data, userText) => {
    if (!data || data.status !== 'success') return false;

    if (data.conversation_id) setConversationId(data.conversation_id);
    if (data.patient_id) setCurrentPatientId(data.patient_id);
    if (data.appointment_id) setCurrentAppointmentId(data.appointment_id);

    const act = data.action;

    if (act === 'show_appointments') {
      const list = (data.data && data.data.appointments) || [];
      setAppointments(list);
      setRightPanel('appointments');
    } else if (act === 'await_vitals_input') {
      setPatientMenuVisible(false);
      setAwaitingVitalsConfirm(false);
      if (data.intent !== 'EDIT_VITALS') {
        setPendingVitals(null);
        setEditableVitals({});
      }
      setVitalsSaved(false);
      setRightPanel('vitals');
    } else if (act === 'show_parsed_vitals') {
      const parsed = (data.data && data.data.parsed_vitals) || {};
      setPendingVitals(parsed);
      setEditableVitals(parsed);
      setAwaitingVitalsConfirm(true);
      setVitalsSaved(false);
      setPatientMenuVisible(false);
      setRightPanel('vitals');
    } else if (act === 'vitals_saved') {
      setPendingVitals(null);
      setEditableVitals({});
      setAwaitingVitalsConfirm(false);
      setVitalsSaved(true);
      setRightPanel(null);
      setPatientMenuVisible(true);
    } else if (act === 'show_patient_menu') {
      setPendingVitals(null);
      setEditableVitals({});
      setAwaitingVitalsConfirm(false);
      setRightPanel(null);
      setPatientMenuVisible(true);
      setPreventiveSession(null);
    } else if (act === 'open_preventive_screening') {
      window.dispatchEvent(new CustomEvent('voice:open-preventive-screening', {
        detail: {
          patientId: currentPatientIdRef.current,
          appointmentId: currentAppointmentIdRef.current,
        },
      }));
      setPatientMenuVisible(false);
      setPreventiveSession({
        part: null,
        awaitingDictation: false,
        awaitingNextPart: false,
        draft: {},
        filledSections: [],
        pendingSections: [],
      });
      setRightPanel('preventive');
    } else if (act === 'await_part_a_dictation') {
      setPatientMenuVisible(false);
      setPreventiveSession(prev => ({
        part: 'A',
        awaitingDictation: true,
        awaitingNextPart: false,
        draft: (prev && prev.draft) || {},
        filledSections: (prev && prev.filledSections) || [],
        pendingSections: (prev && prev.pendingSections) || PART_A_ALL_SECTIONS,
      }));
      setRightPanel('preventive');
    } else if (act === 'await_part_c_dictation') {
      setPatientMenuVisible(false);
      setPreventiveSession(prev => ({
        part: 'C',
        awaitingDictation: true,
        awaitingNextPart: false,
        draft: (prev && prev.draft) || {},
        filledSections: (prev && prev.filledSections) || [],
        pendingSections: (prev && prev.pendingSections) || PART_C_ALL_SECTIONS,
      }));
      setRightPanel('preventive');
    } else if (act === 'preventive_filled') {
      const filled = (data.data && data.data.filled_sections) || [];
      const allFilled = (data.data && data.data.all_filled_sections) || filled;
      const pending = (data.data && data.data.pending_sections) || [];
      setPreventiveSession(prev => ({
        ...(prev || {}),
        awaitingDictation: false,
        awaitingNextPart: false,
        draft: { ...((prev && prev.draft) || {}), ...((data.data && data.data.fields) || {}) },
        filledSections: allFilled,
        pendingSections: pending,
      }));
      window.dispatchEvent(new CustomEvent('voice:preventive-filled', {
        detail: {
          part: data.data?.part || (preventiveSessionRef.current && preventiveSessionRef.current.part),
          fields: (data.data && data.data.fields) || {},
          filledSections: allFilled,
          allFilledSections: allFilled,
          pendingSections: pending,
        },
      }));
    } else if (act === 'part_a_saved') {
      setPreventiveSession(prev => ({
        part: 'A',
        awaitingDictation: false,
        awaitingNextPart: true,
        draft: {},
        filledSections: (prev && prev.filledSections) || [],
        pendingSections: (prev && prev.pendingSections) || [],
      }));
      window.dispatchEvent(new CustomEvent('voice:preventive-saved', { detail: { part: 'A' } }));
    } else if (act === 'part_c_saved') {
      setPreventiveSession(prev => ({
        part: 'C',
        awaitingDictation: false,
        awaitingNextPart: false,
        draft: {},
        filledSections: (prev && prev.filledSections) || [],
        pendingSections: (prev && prev.pendingSections) || [],
      }));
      window.dispatchEvent(new CustomEvent('voice:preventive-saved', { detail: { part: 'C' } }));
    } else if (act === 'generate_patient_summary') {
      setPatientMenuVisible(false);
      setRightPanel('summary');
      startPatientSummary();
    } else if (act === 'generate_pretreatment') {
      setPretreatmentTrigger(t => t + 1);
      setPatientMenuVisible(false);
      setRightPanel('pretreatment');
    } else if (act === 'show_longitudinal_summary') {
      setLongitudinalTrigger(t => t + 1);
      setPatientMenuVisible(false);
      setRightPanel('longitudinal');
    } else if (act === 'show_tumor_board') {
      setPatientMenuVisible(false);
      setRightPanel('tumorboard');
    } else if (act === 'start_consultation') {
      startConsultation();
    } else if (act === 'consultation_safe_rx') {
      runConsultationSafeRx();
    } else if (act === 'consultation_generate_docs') {
      runConsultationGenerateDocs();
    } else if (act === 'consultation_save_docs') {
      setConsultation(prev => prev ? { ...prev, showSaveConfirm: true } : prev);
    } else if (act === 'consultation_cancel') {
      cancelConsultation();
    } else if (act === 'start_clinical_reasoning') {
      setPatientMenuVisible(false);
      setRightPanel('reasoning');
    } else if (act === 'start_clinical_autonomous') {
      setPatientMenuVisible(false);
      setRightPanel('autonomous');
    } else if (act === 'clinical_reasoning_result') {
      const d = data.data || {};
      setReasoningJob({ status: 'done', data: d });
      setReasoningHistory(prev => [
        ...prev,
        {
          question: userText,
          answer: d.answer || d.clinical_picture || '',
          ts: new Date().toLocaleTimeString(),
          full: d,
        },
      ]);
      setRightPanel('reasoning');
    } else if (act === 'clinical_autonomous_result') {
      const d = data.data || {};
      setAutonomousJob({ status: 'done', data: d });
      const r = d.reasoning || {};
      setAutonomousHistory(prev => [
        ...prev,
        {
          question: userText,
          answer: r.answer || r.clinical_picture || '',
          ts: new Date().toLocaleTimeString(),
          full: d,
        },
      ]);
      setRightPanel('autonomous');
    } else if (act === 'close_clinical_panel') {
      setRightPanel(null);
      setPatientMenuVisible(true);
    } else if (act === 'open_report_upload') {
      setPatientMenuVisible(false);
      setRightPanel('report_upload');
      resetReportFlow();
      setReportStage('choose_timing');
    } else if (act === 'open_history') {
      setPatientMenuVisible(false);
      setRightPanel('history');
      resetHistoryFlow();
      setHistoryStage('choose');
    } else if (act === 'open_admission_form') {
      setPatientMenuVisible(false);
      setRightPanel('admission');
      resetAdmissionFlow();
      setAdmissionStage('dictating');
    }

    setResponse(data.response);
    const newConv = [
      ...conversationRef.current,
      { role: 'user', text: userText, timestamp: new Date().toLocaleTimeString() },
      { role: 'assistant', text: data.response, followUp: data.follow_up, timestamp: new Date().toLocaleTimeString() },
    ];
    setConversation(newConv);
    conversationRef.current = newConv;
    speakText(data.response);
    return true;
  }, [
    speakText, startPatientSummary, startConsultation,
    runConsultationSafeRx, runConsultationGenerateDocs, cancelConsultation,
    resetReportFlow, resetHistoryFlow, resetAdmissionFlow,
  ]);

  /* ============================================================
     Voice/typed command pipeline
     ============================================================ */
  const processVoiceCommand = useCallback(async (text) => {
    if (!text || !text.trim() || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError('');

    const trimmed = text.trim();
    const session = preventiveSessionRef.current;
    const consult = consultationRef.current;

    if (rightPanel === 'reasoning' || rightPanel === 'autonomous') {
      const panel = rightPanel;
      try {
        const res = await postProcess({ text: trimmed, clinicalPanel: panel });
        applyBackendResponse(res, trimmed);
      } catch (err) {
        console.error('Clinical query failed:', err);
        setError('Network error. Please try again.');
      } finally {
        setIsProcessing(false);
        isProcessingRef.current = false;
      }
      return;
    }

    if (rightPanel === 'admission' && admissionStage === 'dictating') {
      const merged = admissionDictation
        ? `${admissionDictation} ${trimmed}`
        : trimmed;

      const parsed = parseAdmissionDictation(merged);
      setAdmissionDictation(merged);
      setAdmissionData((prev) => ({ ...prev, ...parsed }));
      setAdmissionStage('reviewing');

      const newConv = [
        ...conversationRef.current,
        { role: 'user', text: trimmed, timestamp: new Date().toLocaleTimeString() },
        {
          role: 'assistant',
          text: "I've parsed the details. Review the form on the right — edit any field, then confirm to register the patient.",
          timestamp: new Date().toLocaleTimeString(),
        },
      ];
      setConversation(newConv);
      conversationRef.current = newConv;
      setResponse("Review the admission form on the right, edit any field, then confirm.");
      speakText("I've parsed the details. Review the form on the right, then confirm or edit.");

      isProcessingRef.current = false;
      setIsProcessing(false);
      return;
    }

    if (consult && (consult.stage === 'dictating' || consult.stage === 'reviewing')) {
      const updated = consult.dictation ? `${consult.dictation}\n${trimmed}` : trimmed;
      setConsultation(prev => prev ? { ...prev, dictation: updated, stage: 'reviewing' } : prev);

      const newConv = [
        ...conversationRef.current,
        { role: 'user', text: trimmed, timestamp: new Date().toLocaleTimeString() },
      ];
      setConversation(newConv);
      conversationRef.current = newConv;

      isProcessingRef.current = false;
      setIsProcessing(false);
      return;
    }

    try {
      if (session && session.awaitingDictation && session.part) {
        const data = await postPreventiveDictate({
          part: session.part,
          text: trimmed,
          existing: session.draft || {},
        });

        if (data && data.status === 'success') {
          const addedFilled = data.filled_sections || [];
          const allFilled = data.all_filled_sections || [
            ...new Set([...(session.filledSections || []), ...addedFilled]),
          ];
          const allSections = session.part === 'A' ? PART_A_ALL_SECTIONS : PART_C_ALL_SECTIONS;
          const pending = data.pending_sections
            || allSections.filter(s => !allFilled.includes(s));

          setPreventiveSession(prev => ({
            ...prev,
            awaitingDictation: false,
            awaitingNextPart: false,
            draft: { ...(prev.draft || {}), ...data.fields },
            filledSections: allFilled,
            pendingSections: pending,
          }));

          window.dispatchEvent(new CustomEvent('voice:preventive-filled', {
            detail: {
              part: session.part,
              fields: data.fields,
              filledSections: allFilled,
              allFilledSections: allFilled,
              pendingSections: pending,
            },
          }));

          const prettyFilled = allFilled.map(s => s.replace(/_/g, ' ')).join(', ') || 'the sections';
          const msg = pending.length > 0
            ? `I've filled ${allFilled.length} section${allFilled.length === 1 ? '' : 's'}: ${prettyFilled}. ${pending.length} still pending. Save Part ${session.part}, or keep dictating?`
            : `All sections filled! Save Part ${session.part}?`;

          const newConv = [
            ...conversationRef.current,
            { role: 'user', text: trimmed, timestamp: new Date().toLocaleTimeString() },
            { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
          ];
          setConversation(newConv);
          conversationRef.current = newConv;
          setResponse(msg);
          speakText(msg);
        }
        return;
      }

      const data = await postProcess({ text: trimmed });
      applyBackendResponse(data, trimmed);
    } catch (err) {
      console.error('Error:', err);
      setError('Network error. Please try again.');
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    postProcess, postPreventiveDictate, applyBackendResponse, speakText,
    rightPanel, admissionStage, admissionDictation,
  ]);

  /* ============================================================
     Vitals / preventive save handlers
     ============================================================ */
  const handleSaveVitals = useCallback(async () => {
    if (!pendingVitals || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError('');
    try {
      const data = await postProcess({ text: 'save', editedVitals: editableVitals });
      applyBackendResponse(data, 'save');
    } catch (err) {
      console.error('save error:', err);
      setError('Failed to save vitals');
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  }, [pendingVitals, editableVitals, postProcess, applyBackendResponse]);

  const handleEditVitals = useCallback(() => {
    setAwaitingVitalsConfirm(false);
    setRightPanel('vitals');
    processVoiceCommand('edit');
  }, [processVoiceCommand]);

  const handleCancelVitals = useCallback(() => {
    setPendingVitals(null);
    setEditableVitals({});
    setAwaitingVitalsConfirm(false);
    setRightPanel(null);
    setPatientMenuVisible(true);
    processVoiceCommand('cancel');
  }, [processVoiceCommand]);

  const closeVitalsPanel = useCallback(() => {
    setRightPanel(null);
    setPendingVitals(null);
    setEditableVitals({});
    setAwaitingVitalsConfirm(false);
    setPatientMenuVisible(true);
  }, []);

  const handleSavePart = useCallback(async (part) => {
    const session = preventiveSessionRef.current;
    if (!session || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError('');
    try {
      const data = await savePreventivePart({ part, data: session.draft || {} });
      if (data && data.status === 'success') {
        window.dispatchEvent(new CustomEvent('voice:preventive-saved', { detail: { part } }));

        if (part === 'A') {
          const msg = 'Part A saved. Ready for Part C? Tap Yes or No, or just say "Part C".';
          setPreventiveSession(prev => ({
            ...prev,
            part: 'A',
            awaitingDictation: false,
            awaitingNextPart: true,
            draft: {},
          }));

          const newConv = [
            ...conversationRef.current,
            { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
          ];
          setConversation(newConv);
          conversationRef.current = newConv;
          setResponse(msg);
          speakText(msg);
        } else {
          const msg = 'Part C saved. All preventive screening data is complete.';
          setPreventiveSession(prev => ({
            ...prev,
            awaitingDictation: false,
            awaitingNextPart: false,
            draft: {},
          }));

          const newConv = [
            ...conversationRef.current,
            { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
          ];
          setConversation(newConv);
          conversationRef.current = newConv;
          setResponse(msg);
          speakText(msg);

          setTimeout(() => {
            setRightPanel(null);
            setPatientMenuVisible(true);
            setPreventiveSession(null);
          }, 800);
        }
      } else {
        setError('Failed to save part');
      }
    } catch (err) {
      console.error('save part error:', err);
      setError('Failed to save part');
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  }, [savePreventivePart, speakText]);

  const handleEditPart = useCallback(() => {
    setPreventiveSession(prev => ({ ...prev, awaitingDictation: true, awaitingNextPart: false }));
  }, []);

  const handleCancelPart = useCallback(() => {
    setPreventiveSession(null);
    setRightPanel(null);
    setPatientMenuVisible(true);
  }, []);

  const handleProceedToPartC = useCallback(() => {
    setPreventiveSession(prev => ({
      ...(prev || {}),
      part: 'C',
      awaitingDictation: true,
      awaitingNextPart: false,
      draft: {},
      filledSections: [],
      pendingSections: PART_C_ALL_SECTIONS,
    }));
    processVoiceCommand('Part C');
  }, [processVoiceCommand]);

  const handleSkipPartC = useCallback(() => {
    setPreventiveSession(null);
    setRightPanel(null);
    setPatientMenuVisible(true);

    const msg = {
      role: 'assistant',
      text: 'Okay — preventive screening paused. What would you like to do next?',
      timestamp: new Date().toLocaleTimeString(),
    };
    const newConv = [...conversationRef.current, msg];
    setConversation(newConv);
    conversationRef.current = newConv;
    setResponse(msg.text);
    speakText(msg.text);
  }, [speakText]);

  const closeSummaryPanel = useCallback(() => {
    stopSummaryPolling();
    setSummaryJob(null);
    setRightPanel(null);
    setPatientMenuVisible(true);
  }, [stopSummaryPolling]);

  /* ============================================================
     Patient selection
     ============================================================ */
  const selectPatient = useCallback(async (apt) => {
    const patientId = apt.sys_user_id || apt.patient_id || apt.id;
    const apptId = apt.appointment_id || apt.id || appointmentIdFromUrl;
    const patientName = apt.patient_name || 'Patient';
    if (!patientId) return;

    stopSummaryPolling();
    await clearClinicalAgentMemory();

    setCurrentPatientId(patientId);
    setCurrentPatientName(patientName);
    if (apptId) setCurrentAppointmentId(apptId);
    if (onPatientSelect) onPatientSelect(patientId, apptId);

    setPendingVitals(null);
    setEditableVitals({});
    setAwaitingVitalsConfirm(false);
    setVitalsSaved(false);
    setPatientMenuVisible(true);
    setRightPanel(null);
    setWorkflowView('story');
    setPreventiveSession(null);
    setShowFilledOnly(true); // ✅ reset toggle on patient change
    setSummaryJob(null);
    setPretreatmentTrigger(0);
    setLongitudinalTrigger(0);
    setConsultation(null);
    setAgenticMedData(null);
    setIsAgenticMedLoading(false);
    setReasoningJob(null);
    setAutonomousJob(null);
    setReasoningHistory([]);
    setAutonomousHistory([]);
    setClinicalQueryInput('');
    resetReportFlow();
    resetHistoryFlow();
    resetAdmissionFlow();

    const confirmMsg = {
      role: 'assistant',
      text: `Patient ${patientName} selected. What would you like to do — patient story, record vitals, preventive screening, generate patient summary, tumor board, history, report upload, clinical reasoning, or autonomous actions?`,
      timestamp: new Date().toLocaleTimeString(),
    };
    const newConv = [...conversationRef.current, confirmMsg];
    setConversation(newConv);
    conversationRef.current = newConv;
    setResponse(confirmMsg.text);

    if (conversationIdRef.current && doctorId) {
      try {
        await fetch(`${API_BASE_URL}hms/users/ai-legacy/select-patient`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id: doctorId,
            conversation_id: conversationIdRef.current,
            appointment_id: apptId,
            patient_name: patientName,
          }),
        });
      } catch (err) {
        console.error('select-patient error:', err);
      }
    }
  }, [
    doctorId, onPatientSelect, appointmentIdFromUrl, stopSummaryPolling,
    resetReportFlow, resetHistoryFlow, resetAdmissionFlow,
    clearClinicalAgentMemory,
  ]);

  /* ============================================================
     Transcription — push-to-talk
     ============================================================ */
  const transcribeToInput = useCallback(async (blob) => {
    try {
      setIsTranscribing(true);
      const formData = new FormData();
      formData.append('file', blob);
      formData.append('language_code', 'eng');

      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/transcribe`, {
        method: 'POST', body: formData,
      });

      const data = await res.json();
      if (data.text && data.text.trim() && !data.no_speech) {
        setTypedInput(prev => (prev ? `${prev} ${data.text.trim()}` : data.text.trim()));
        setTranscript('');
      }
    } catch (err) {
      console.error('Transcription error:', err);
      setError('Failed to transcribe audio. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  /* ============================================================
     Push-to-talk: startRecording / stopRecording
     ============================================================ */
  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstart = () => {
        isRecordingRef.current = true;
      };
      mediaRecorder.onstop = async () => {
        isRecordingRef.current = false;
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        if (blob.size > 1000) {
          await transcribeToInput(blob);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setIsLive(true);
      setError('');
    } catch (err) {
      console.error('Microphone error:', err);
      setError('Failed to access microphone. Please check permissions.');
      setIsRecording(false);
      isRecordingRef.current = false;
      setIsLive(false);
    }
  }, [transcribeToInput]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    setIsLive(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

  /* ============================================================
    Quick actions / typed input / clear
  ============================================================ */
  const runQuickAction = useCallback((action) => {
    if (isProcessingRef.current) return;

    // ✅ NEW — intercept Patient Story before hitting the backend
    if (action.key === 'story') {
      setPatientMenuVisible(false);
      setWorkflowView('story');
      setRightPanel('workflow');
      const msg = `Opening patient story for ${currentPatientName || 'this patient'}. Use the menu on the left to switch between workflow modules.`;
      const newConv = [
        ...conversationRef.current,
        { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
      ];
      setConversation(newConv);
      conversationRef.current = newConv;
      setResponse(msg);
      speakText(msg);
      return;
    }

    // ✅ NEW — intercept Take Appointment → open the embedded Appointments panel
    if (action.key === 'book') {
      setPatientMenuVisible(false);

      try {
        const url = new URL(window.location.href);
        url.searchParams.set('embed', '1');
        if (currentPatientId) url.searchParams.set('patient_id', currentPatientId);
        window.history.replaceState({}, '', url);
      } catch (err) {
        console.warn('Could not update URL for embedded appointments', err);
      }

      setRightPanel('appointments_page');

      const msg = `Opening appointment scheduling${currentPatientName ? ` with ${currentPatientName} pre-selected` : ''}.`;
      const newConv = [
        ...conversationRef.current,
        { role: 'assistant', text: msg, timestamp: new Date().toLocaleTimeString() },
      ];
      setConversation(newConv);
      conversationRef.current = newConv;
      setResponse(msg);
      speakText(msg);
      return;
    }

    setTranscript(action.text);
    processVoiceCommand(action.text).then(() => setTranscript(''));
  }, [processVoiceCommand, currentPatientName, currentPatientId, speakText]);

  const submitTyped = useCallback(() => {
    const t = typedInput.trim();
    if (!t || isProcessingRef.current) return;
    setTypedInput('');
    processVoiceCommand(t);
  }, [typedInput, processVoiceCommand]);

  const submitClinicalQuery = useCallback(async () => {
    const q = clinicalQueryInput.trim();
    if (!q || isProcessingRef.current) return;
    setClinicalQueryInput('');
    if (rightPanel === 'reasoning') {
      await runClinicalReasoning(q);
    } else if (rightPanel === 'autonomous') {
      await runClinicalAutonomous(q);
    }
  }, [clinicalQueryInput, rightPanel, runClinicalReasoning, runClinicalAutonomous]);

  const clearConversation = useCallback(async () => {
    stopSummaryPolling();
    if (reportPollRef.current) {
      clearInterval(reportPollRef.current);
      reportPollRef.current = null;
    }
    if (conversationId) {
      try {
        await fetch(`${API_BASE_URL}hms/users/ai-legacy/conversation/${conversationId}`, { method: 'DELETE' });
      } catch (err) { console.error('Error clearing conversation:', err); }
    }
    setConversation([]); conversationRef.current = [];
    setResponse(''); setCurrentPatientId(null); setCurrentPatientName(null);
    setAppointments([]); setRightPanel(null);
    setWorkflowView('story');
    setPendingVitals(null); setEditableVitals({}); setAwaitingVitalsConfirm(false);
    setVitalsSaved(false); setPatientMenuVisible(false);
    setPreventiveSession(null);
    setShowFilledOnly(true); // ✅ reset toggle
    setSummaryJob(null);
    setPretreatmentTrigger(0);
    setLongitudinalTrigger(0);
    setConsultation(null);
    setAgenticMedData(null);
    setIsAgenticMedLoading(false);
    setReasoningJob(null);
    setAutonomousJob(null);
    setReasoningHistory([]);
    setAutonomousHistory([]);
    setClinicalQueryInput('');
    resetReportFlow();
    resetHistoryFlow();
    resetAdmissionFlow();
    setPendingInvestigations([]);
    setInvestigationFiles({});
    setInvestigationMessage(null);
    if (synthRef.current) synthRef.current.cancel();
    setIsSpeaking(false); setConversationId(null); setTranscript('');
    setTypedInput('');
  }, [conversationId, stopSummaryPolling, resetReportFlow, resetHistoryFlow, resetAdmissionFlow]);

  useEffect(() => { if (synthRef.current) synthRef.current.getVoices(); }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (synthRef.current) synthRef.current.cancel();
      if (summaryPollRef.current) {
        clearInterval(summaryPollRef.current);
        summaryPollRef.current = null;
      }
      if (reportPollRef.current) {
        clearInterval(reportPollRef.current);
        reportPollRef.current = null;
      }
    };
  }, []);

  const patientSelected = !!currentPatientId;

  const preventiveProgress = useMemo(() => {
    if (!preventiveSession || !preventiveSession.part) return null;
    const all = preventiveSession.part === 'A' ? PART_A_ALL_SECTIONS : PART_C_ALL_SECTIONS;
    const filled = preventiveSession.filledSections || [];
    const pending = preventiveSession.pendingSections || all.filter(s => !filled.includes(s));
    return {
      total: all.length,
      filledCount: filled.length,
      pendingCount: pending.length,
      pct: all.length === 0 ? 100 : Math.round((filled.length / all.length) * 100),
      isComplete: pending.length === 0 && filled.length > 0,
    };
  }, [preventiveSession]);

  const admissionMissingRequired = useMemo(() => {
    return ADMISSION_FIELDS
      .filter((f) => f.required && !String(admissionData[f.key] || '').trim())
      .map((f) => f.label);
  }, [admissionData]);

  /* ============================================================
     Consultation document renderer
     ============================================================ */
  const renderConsultationDocument = useCallback((featureId, data) => {
    if (data == null) return null;

    const onSaveHandler = (payload) => {
      updateConsultationDocument(featureId, payload);
    };

    if (featureId === 'documentation-medication-analysis') {
      return (
        <MedicationPanel
          data={data}
          metadata={{ patient_id: currentPatientId, doctor_id: doctorId }}
          diagnosisText={''}
          onSave={onSaveHandler}
        />
      );
    }

    if (featureId === 'documentation-investigation-notes') {
      return (
        <InvestigationNotes
          data={data}
          doctorId={doctorId}
          patientId={currentPatientId}
          onSave={onSaveHandler}
        />
      );
    }

    if (featureId === 'documentation-clinical-notes') {
      return (
        <ClinicalNotesPanel
          data={data}
          metadata={{ doctor_id: doctorId, patient_id: currentPatientId }}
          onSave={onSaveHandler}
        />
      );
    }

    if (featureId === 'documentation-treatment-plan') {
      return (
        <TreatmentPlan
          ref={treatmentPlanRef}
          doctorId={doctorId}
          patientId={currentPatientId}
          treatmentObjective={''}
          dictationData={data}
          dictationText={consultation?.dictation || ''}
          onTreatmentObjectiveChange={() => {}}
          reloadTrigger={0}
          onDataLoaded={() => {}}
        />
      );
    }

    if (featureId === 'structured-note') {
      return (
        <StructuredNotePanel
          doctorId={doctorId}
          patientId={currentPatientId}
          dictation={consultation?.dictation || ''}
        />
      );
    }

    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return (
      <textarea
        value={text}
        onChange={(e) => updateConsultationDocument(featureId, e.target.value)}
        className="va-textarea mono"
      />
    );
  }, [currentPatientId, doctorId, consultation?.dictation, updateConsultationDocument]);

  /* ============================================================
     LEFT-SIDE suggestions
     ============================================================ */
  const getSuggestionGroups = () => {
    const name = currentPatientName || 'this patient';

    const generalGroup = {
      title: 'General',
      cols: 1,
      items: BASE_QUICK_ACTIONS.map(a => ({
        key: a.key, label: a.label, icon: a.icon, variant: 'ghost',
        onClick: () => runQuickAction(a),
      })),
    };
    const patientGroup = {
      title: `What would you like to do for ${name}?`,
      cols: 2,
      items: PATIENT_QUICK_ACTIONS.map(a => ({
        key: a.key, label: a.label, icon: a.icon, variant: 'ghost',
        onClick: () => runQuickAction(a),
      })),
    };

    // ✅ NEW — Workflow module menu (left side, appears when Patient Story opened)
    if (rightPanel === 'workflow') {
      return [
        {
          title: 'Patient workflow',
          hint: 'Open any module. Switch at any time.',
          cols: 1,
          items: WORKFLOW_MODULES.map(m => ({
            key: `wf-${m.id}`,
            label: m.label,
            icon: <Layers size={15} />,
            variant: workflowView === m.id ? 'dark' : 'ghost',
            onClick: () => setWorkflowView(m.id),
          })),
        },
        {
          title: 'Other actions',
          cols: 1,
          items: [
            {
              key: 'back', label: 'Back to patient actions', icon: <ArrowLeft size={15} />,
              variant: 'ghost',
              onClick: () => { setRightPanel(null); setPatientMenuVisible(true); },
            },
          ],
        },
      ];
    }

    // ✅ NEW — Take Appointment page (embedded)
    if (rightPanel === 'appointments_page') {
      return [
        {
          title: 'Scheduling in progress',
          hint: 'Pick a patient on the right and fill in the form. The panel stays open until you close it.',
          cols: 1,
          items: [
            {
              key: 'close-appt',
              label: 'Back to patient actions',
              icon: <ArrowLeft size={15} />,
              variant: 'ghost',
              onClick: () => { setRightPanel(null); setPatientMenuVisible(true); },
            },
          ],
        },
      ];
    }

    // ── New Admission ──
    if (rightPanel === 'admission') {
      if (admissionStage === 'dictating') {
        return [{
          title: 'New Admission — dictate the patient details',
          hint: 'Example: "Name is Ravi Kumar, DOB 1990-05-15, gender male, phone 9876543210, email ravi@example.com, blood group O+, address 12 MG Road, occupation engineer, income 500000, family history diabetes."',
          cols: 1,
          items: [
            {
              key: 'skip_dictation', label: 'Skip dictation, fill manually', icon: <Edit3 size={15} />,
              variant: 'outline',
              onClick: () => setAdmissionStage('reviewing'),
            },
            {
              key: 'cancel', label: 'Cancel Admission', icon: <X size={15} />,
              variant: 'ghost',
              onClick: () => {
                resetAdmissionFlow();
                setRightPanel(null);
                setPatientMenuVisible(true);
              },
            },
          ],
        }];
      }

      if (admissionStage === 'reviewing') {
        return [{
          title: 'Review Admission Details',
          hint: admissionMissingRequired.length
            ? `Missing required: ${admissionMissingRequired.join(', ')}`
            : 'All required fields filled. Confirm to register.',
          cols: 1,
          items: [
            {
              key: 'submit', label: 'Confirm & Register', icon: <CheckCircle size={15} />,
              variant: 'dark',
              onClick: submitAdmission,
            },
            {
              key: 'restart', label: 'Restart dictation', icon: <RefreshCw size={15} />,
              variant: 'outline',
              onClick: () => {
                setAdmissionDictation('');
                setAdmissionData({ ...EMPTY_ADMISSION });
                setAdmissionStage('dictating');
                setAdmissionMessage(null);
              },
            },
            {
              key: 'cancel', label: 'Cancel Admission', icon: <X size={15} />,
              variant: 'ghost',
              onClick: () => {
                resetAdmissionFlow();
                setRightPanel(null);
                setPatientMenuVisible(true);
              },
            },
          ],
        }];
      }

      if (admissionStage === 'submitting') {
        return [{
          title: 'Registering patient…',
          hint: 'Please wait while we create the patient record.',
          cols: 1,
          items: [],
        }];
      }

      if (admissionStage === 'done') {
        return [{
          title: 'Patient registered',
          cols: 2,
          items: [
            {
              key: 'another', label: 'Register Another', icon: <UserPlus size={15} />,
              variant: 'dark',
              onClick: () => {
                resetAdmissionFlow();
                setAdmissionStage('dictating');
              },
            },
            {
              key: 'close', label: 'Done', icon: <Check size={15} />,
              variant: 'ghost',
              onClick: () => {
                resetAdmissionFlow();
                setRightPanel(null);
                setPatientMenuVisible(true);
              },
            },
          ],
        }];
      }
    }

    // ── History ──
    if (rightPanel === 'history') {
      if (historyStage === 'choose') {
        return [{
          title: 'Patient history — what would you like to view?',
          hint: 'Pick a category to drill down.',
          cols: 1,
          items: [
            {
              key: 'list', label: 'List History', icon: <FileText size={15} />,
              sub: 'Combined document timeline',
              variant: 'dark',
              onClick: () => { setHistoryTab('list'); setHistoryStage('list'); },
            },
            {
              key: 'med', label: 'Medication History', icon: <Pill size={15} />,
              sub: 'Past and current medications',
              variant: 'ghost',
              onClick: () => { setHistoryTab('medication'); setHistoryStage('medication'); },
            },
            {
              key: 'inv', label: 'Investigation History', icon: <FileText size={15} />,
              sub: 'Lab and imaging investigations',
              variant: 'ghost',
              onClick: () => { setHistoryTab('investigation'); setHistoryStage('investigation'); },
            },
            {
              key: 'trt', label: 'Treatment Plan History', icon: <FileText size={15} />,
              sub: 'Prior treatment plans',
              variant: 'ghost',
              onClick: () => { setHistoryTab('treatment'); setHistoryStage('treatment'); },
            },
            {
              key: 'cn', label: 'Clinical Notes History', icon: <FileText size={15} />,
              sub: 'Consultation and progress notes',
              variant: 'ghost',
              onClick: () => { setHistoryTab('clinical_note'); setHistoryStage('clinical_note'); },
            },
            {
              key: 'vit', label: 'Vitals History', icon: <Activity size={15} />,
              sub: 'Real-time and historical vitals',
              variant: 'ghost',
              onClick: () => { setHistoryTab('vitals'); setHistoryStage('vitals'); },
            },
            {
              key: 'dcm', label: 'Imaging (DICOM)', icon: <Layers size={15} />,
              sub: 'MRI, CT, X-ray, PET and more',
              variant: 'ghost',
              onClick: () => { setHistoryTab('dicom'); setHistoryStage('dicom'); },
            },
            {
              key: 'back', label: 'Back', icon: <ArrowLeft size={15} />,
              variant: 'ghost',
              onClick: () => {
                resetHistoryFlow();
                setRightPanel(null);
                setPatientMenuVisible(true);
              },
            },
          ],
        }];
      }

      return [{
        title: 'History',
        hint: 'Switch view or go back.',
        cols: 2,
        items: [
          { key: 'list', label: 'List',       icon: <FileText size={15} />,  variant: historyTab === 'list'          ? 'dark' : 'ghost',
            onClick: () => { setHistoryTab('list'); setHistoryStage('list'); } },
          { key: 'med',  label: 'Medications',icon: <Pill size={15} />,      variant: historyTab === 'medication'    ? 'dark' : 'ghost',
            onClick: () => { setHistoryTab('medication'); setHistoryStage('medication'); } },
          { key: 'inv',  label: 'Investigations', icon: <FileText size={15} />, variant: historyTab === 'investigation' ? 'dark' : 'ghost',
            onClick: () => { setHistoryTab('investigation'); setHistoryStage('investigation'); } },
          { key: 'trt',  label: 'Treatment',  icon: <FileText size={15} />,  variant: historyTab === 'treatment'     ? 'dark' : 'ghost',
            onClick: () => { setHistoryTab('treatment'); setHistoryStage('treatment'); } },
          { key: 'cn',   label: 'Clinical',   icon: <FileText size={15} />,  variant: historyTab === 'clinical_note' ? 'dark' : 'ghost',
            onClick: () => { setHistoryTab('clinical_note'); setHistoryStage('clinical_note'); } },
          { key: 'vit',  label: 'Vitals',     icon: <Activity size={15} />,  variant: historyTab === 'vitals'        ? 'dark' : 'ghost',
            onClick: () => { setHistoryTab('vitals'); setHistoryStage('vitals'); } },
          { key: 'dcm',  label: 'DICOM',      icon: <Layers size={15} />,    variant: historyTab === 'dicom'         ? 'dark' : 'ghost',
            onClick: () => { setHistoryTab('dicom'); setHistoryStage('dicom'); } },
          { key: 'back', label: 'Back to options', icon: <ArrowLeft size={15} />, variant: 'ghost',
            onClick: () => { setHistoryStage('choose'); } },
          { key: 'close', label: 'Close history', icon: <X size={15} />, variant: 'ghost',
            onClick: () => {
              resetHistoryFlow();
              setRightPanel(null);
              setPatientMenuVisible(true);
            } },
        ],
      }];
    }

    // ── Report upload ──
    if (rightPanel === 'report_upload') {
      if (reportStage === 'choose_timing') {
        return [{
          title: 'Is this a current report or a previous report?',
          cols: 2,
          items: [
            {
              key: 'current', label: 'Current Report', icon: <FileText size={15} />,
              variant: 'dark',
              onClick: () => {
                setReportTiming('current');
                setReportStage('current_choice');
              },
            },
            {
              key: 'previous', label: 'Previous Report', icon: <FileText size={15} />,
              variant: 'ghost',
              onClick: () => {
                setReportTiming('previous');
                setReportStage('previous_choice');
              },
            },
            {
              key: 'cancel', label: 'Cancel', icon: <X size={15} />,
              variant: 'ghost',
              onClick: () => {
                resetReportFlow();
                setRightPanel(null);
                setPatientMenuVisible(true);
              },
            },
          ],
        }];
      }

      if (reportStage === 'current_choice') {
        return [{
          title: 'Current report — what would you like to upload?',
          cols: 1,
          items: [
            {
              key: 'pending', label: 'Pending Investigations', icon: <Activity size={15} />,
              sub: 'Attach reports to ordered investigations',
              variant: 'dark',
              onClick: async () => {
                setReportStage('current_pending');
                await fetchPendingInvestigations();
              },
            },
            {
              key: 'normal', label: 'Normal Upload', icon: <FileUp size={15} />,
              sub: 'Upload a new document',
              variant: 'ghost',
              onClick: () => setReportStage('current_normal'),
            },
            {
              key: 'back', label: 'Back', icon: <ArrowLeft size={15} />,
              variant: 'ghost', onClick: () => setReportStage('choose_timing'),
            },
          ],
        }];
      }

      if (reportStage === 'current_normal') {
        return [{
          title: 'Upload with category or without category?',
          cols: 2,
          items: [
            {
              key: 'with', label: 'With Category', icon: <Layers size={15} />,
              variant: 'dark',
              onClick: () => {
                setReportCategoryMode('with');
                setReportStage('upload_zone');
              },
            },
            {
              key: 'without', label: 'Without Category', icon: <FileText size={15} />,
              variant: 'ghost',
              onClick: () => {
                setReportCategoryMode('without');
                setReportStage('upload_zone');
              },
            },
            {
              key: 'back', label: 'Back', icon: <ArrowLeft size={15} />,
              variant: 'ghost', onClick: () => setReportStage('current_choice'),
            },
          ],
        }];
      }

      if (reportStage === 'previous_choice') {
        return [{
          title: 'Previous report — upload with category or without?',
          cols: 2,
          items: [
            {
              key: 'with', label: 'With Category', icon: <Layers size={15} />,
              variant: 'dark',
              onClick: () => {
                setReportCategoryMode('with');
                setReportStage('upload_zone');
              },
            },
            {
              key: 'without', label: 'Without Category', icon: <FileText size={15} />,
              variant: 'ghost',
              onClick: () => {
                setReportCategoryMode('without');
                setReportStage('upload_zone');
              },
            },
            {
              key: 'back', label: 'Back', icon: <ArrowLeft size={15} />,
              variant: 'ghost', onClick: () => setReportStage('choose_timing'),
            },
          ],
        }];
      }

      if (reportStage === 'upload_zone') {
        const items = [];
        if (reportFile) {
          items.push({
            key: 'upload', label: reportUploading ? 'Uploading…' : 'Upload Now',
            icon: <UploadCloud size={15} />, variant: 'dark',
            onClick: handleReportUpload,
          });
          items.push({
            key: 'clear', label: 'Choose Different File', icon: <X size={15} />,
            variant: 'ghost', onClick: () => setReportFile(null),
          });
        }
        if (reportProcessing) {
          items.push({
            key: 'processing', label: 'Processing…', icon: <Loader size={15} />,
            variant: 'ghost', onClick: () => {},
          });
        }
        items.push({
          key: 'back', label: 'Back', icon: <ArrowLeft size={15} />,
          variant: 'ghost',
          onClick: () => {
            if (reportTiming === 'previous') setReportStage('previous_choice');
            else setReportStage('current_normal');
          },
        });
        return [{
          title: reportFile ? `Selected: ${reportFile.name}` : 'Select a file',
          hint: reportFile ? 'Upload, or pick a different file.' : 'Use the file picker on the right.',
          cols: 1,
          items,
        }];
      }

      if (reportStage === 'done') {
        return [{
          title: 'Upload complete',
          cols: 2,
          items: [
            {
              key: 'another', label: 'Upload Another', icon: <FileUp size={15} />,
              variant: 'dark', onClick: resetReportFlow,
            },
            {
              key: 'close', label: 'Done', icon: <Check size={15} />,
              variant: 'ghost',
              onClick: () => {
                resetReportFlow();
                setRightPanel(null);
                setPatientMenuVisible(true);
              },
            },
          ],
        }];
      }

      if (reportStage === 'current_pending') {
        return [{
          title: 'Pending investigations',
          hint: loadingInvestigations ? 'Loading…' : 'Attach a report to any pending investigation on the right.',
          cols: 1,
          items: [
            {
              key: 'back', label: 'Back', icon: <ArrowLeft size={15} />,
              variant: 'ghost', onClick: () => setReportStage('current_choice'),
            },
          ],
        }];
      }
    }

    // ── Consultation ──
    if (rightPanel === 'consultation' && consultation) {
      if (consultation.showSaveConfirm) {
        const n = Object.values(consultation.documents || {}).filter(Boolean).length;
        return [{
          title: 'Save documentation?',
          hint: `This will save ${n} document${n === 1 ? '' : 's'} to the patient record.`,
          cols: 1,
          items: [
            { key: 'yes', label: 'Yes, save all', icon: <CheckCircle size={15} />, variant: 'dark', onClick: runConsultationSaveDocs },
            { key: 'no', label: 'Not yet', icon: <ArrowLeft size={15} />, variant: 'ghost',
              onClick: () => setConsultation(prev => ({ ...prev, showSaveConfirm: false })) },
          ],
        }];
      }
      const items = [];

      items.push({
        key: 'saferx-mode',
        variant: 'ghost',
        icon: <Shield size={15} />,
        label: useAgenticMedication ? 'SafeRx Mode: Agentic' : 'SafeRx Mode: Standard',
        onClick: () => setUseAgenticMedication(v => !v),
      });

      const canRun = consultation.dictation?.trim() && consultation.stage !== 'generating' && consultation.stage !== 'saving';
      if (canRun) {
        items.push({
          key: 'saferx', variant: 'outline', icon: <Shield size={15} />,
          label: consultation.stage === 'safedone' ? 'Re-check SafeRx' : 'Check SafeRx',
          onClick: runConsultationSafeRx,
        });
        items.push({
          key: 'gen', variant: 'dark', icon: <FileText size={15} />,
          label: consultation.stage === 'generated' ? 'Re-generate Documentation' : 'Generate Documentation',
          onClick: runConsultationGenerateDocs,
        });
      }
      if (consultation.stage === 'generated' && consultation.documents) {
        items.push({
          key: 'save', variant: 'dark', icon: <Save size={15} />, label: 'Save All Documentation',
          onClick: () => setConsultation(prev => ({ ...prev, showSaveConfirm: true })),
        });
      }
      if (consultation.stage !== 'saving') {
        items.push({ key: 'cancel', variant: 'ghost', icon: <X size={15} />, label: 'Cancel Consultation', onClick: cancelConsultation });
      }
      return [{
        title: 'Consultation actions',
        hint: !consultation.dictation?.trim() ? 'Dictate or type the notes to unlock SafeRx and documentation.' : undefined,
        cols: 1,
        items,
      }];
    }

    // ── Clinical Reasoning Agent ──
    if (rightPanel === 'reasoning') {
      const items = [
        { key: 'close', label: 'Close', icon: <X size={15} />, variant: 'ghost', onClick: closeReasoningPanel },
      ];
      return [{
        title: 'Clinical Reasoning',
        hint: reasoningHistory.length === 0
          ? 'Ask a question — e.g. "Analyse treatment response of patient" or "Summarise the current clinical picture".'
          : 'Ask a follow-up, or close the panel.',
        cols: 1,
        items,
      }];
    }

    // ── Clinical Autonomous Agent ──
    if (rightPanel === 'autonomous') {
      const items = [
        { key: 'close', label: 'Close', icon: <X size={15} />, variant: 'ghost', onClick: closeAutonomousPanel },
      ];
      const pendingN = autonomousJob?.data?.pending_actions?.length || 0;
      return [{
        title: 'Autonomous Agent',
        hint: autonomousHistory.length === 0
          ? 'Ask a question — low-risk items run automatically, anything that touches the care plan waits for your confirmation.'
          : (pendingN > 0 ? `${pendingN} action${pendingN === 1 ? '' : 's'} waiting on your confirmation below.` : 'Ask a follow-up, or close the panel.'),
        cols: 1,
        items,
      }];
    }

    // ── Vitals ──
    if (rightPanel === 'vitals') {
      if (awaitingVitalsConfirm) {
        return [{
          title: 'Proceed to save these vitals?',
          hint: 'Review or edit the values on the right first.',
          cols: 3,
          items: [
            { key: 'save', label: 'Save', icon: <Save size={15} />, variant: 'dark', onClick: handleSaveVitals },
            { key: 'edit', label: 'Edit', icon: <Edit3 size={15} />, variant: 'outline', onClick: handleEditVitals },
            { key: 'cancel', label: 'Cancel', icon: <Trash2 size={15} />, variant: 'ghost', onClick: handleCancelVitals },
          ],
        }];
      }
      return [{
        title: 'Recording vitals',
        hint: 'Dictate or type the vitals. Example: "BP 120 over 80, heart rate 72".',
        cols: 1,
        items: [{ key: 'close', label: 'Close vitals', icon: <X size={15} />, variant: 'ghost', onClick: closeVitalsPanel }],
      }];
    }

    // ── Preventive screening ──
    if (rightPanel === 'preventive' && preventiveSession) {
      if (!preventiveSession.part) {
        return [{
          title: 'Which part would you like to work on?',
          cols: 1,
          items: [
            { key: 'a', label: 'Part A — Case History', sub: 'Registration, history, family, substance, cancer, menstrual, obstetric', icon: <FileText size={15} />, variant: 'ghost',
              onClick: () => runQuickAction({ text: 'Part A' }) },
            { key: 'c', label: 'Part C — Examination', sub: 'General exam, breast, cervical, prescription, follow-up', icon: <Stethoscope size={15} />, variant: 'ghost',
              onClick: () => runQuickAction({ text: 'Part C' }) },
            { key: 'cancel', label: 'Cancel', icon: <X size={15} />, variant: 'ghost', onClick: handleCancelPart },
          ],
        }];
      }
      if (preventiveSession.awaitingDictation) {
        return [{
          title: `Dictating Part ${preventiveSession.part}`,
          hint: 'Speak or type the details. I will fill the form and mark the sections I populated.',
          cols: 1,
          items: [{ key: 'cancel', label: 'Cancel', icon: <X size={15} />, variant: 'ghost', onClick: handleCancelPart }],
        }];
      }
      if (preventiveSession.awaitingNextPart) {
        return [{
          title: 'Ready for Part C?',
          cols: 2,
          items: [
            { key: 'yes', label: 'Yes, start Part C', icon: <Check size={15} />, variant: 'dark', onClick: handleProceedToPartC },
            { key: 'no', label: 'No, skip', icon: <X size={15} />, variant: 'ghost', onClick: handleSkipPartC },
          ],
        }];
      }
      const pendingN = preventiveSession.pendingSections?.length || 0;
      return [{
        title: pendingN > 0
          ? `Save Part ${preventiveSession.part}? (${pendingN} still pending)`
          : `Save Part ${preventiveSession.part}? (all sections filled)`,
        cols: 1,
        items: [
          { key: 'save', label: 'Save', icon: <Save size={15} />, variant: 'dark', onClick: () => handleSavePart(preventiveSession.part) },
          { key: 'edit', label: 'Keep dictating', icon: <Edit3 size={15} />, variant: 'outline', onClick: handleEditPart },
          { key: 'cancel', label: 'Cancel', icon: <Trash2 size={15} />, variant: 'ghost', onClick: handleCancelPart },
        ],
      }];
    }

    // ── Summary ──
    if (rightPanel === 'summary') {
      const items = [];
      if (summaryJob?.status === 'failed') {
        items.push({ key: 'retry', label: 'Retry summary', icon: <RefreshCw size={15} />, variant: 'dark', onClick: () => startPatientSummary() });
      }
      if (summaryJob?.status === 'completed') {
        items.push(
          { key: 'pre',    label: 'Generate Pre-treatment',    icon: <FileText size={15} />,    variant: 'outline',
            onClick: () => runQuickAction({ text: 'Generate pre-treatment' }) },
          { key: 'tumor',  label: 'Tumor Board',               icon: <Stethoscope size={15} />, variant: 'outline',
            onClick: () => runQuickAction({ text: 'Tumor board' }) },
          { key: 'long',   label: 'Show Longitudinal Summary', icon: <Layers size={15} />,      variant: 'ghost',
            onClick: () => runQuickAction({ text: 'Show longitudinal summary' }) },
          { key: 'consult',label: 'Start Consultation',        icon: <Activity size={15} />,    variant: 'dark',
            onClick: () => runQuickAction({ text: 'Start consultation' }) },
        );
      }
      items.push({ key: 'close', label: 'Close summary', icon: <X size={15} />, variant: 'ghost', onClick: closeSummaryPanel });
      return [{
        title: summaryJob?.status === 'completed' ? 'What would you like to do next?' : 'Patient summary',
        hint: summaryJob?.status === 'processing' ? 'Generating… this usually takes 30–60 seconds.' : undefined,
        cols: 1,
        items,
      }];
    }

    // ── Pre-treatment ──
    if (rightPanel === 'pretreatment') {
      return [{
        title: 'What would you like to do next?',
        cols: 1,
        items: [
          { key: 'tumor',   label: 'Tumor Board',               icon: <Stethoscope size={15} />, variant: 'outline',
            onClick: () => runQuickAction({ text: 'Tumor board' }) },
          { key: 'long',    label: 'Show Longitudinal Summary', icon: <Layers size={15} />,      variant: 'ghost',
            onClick: () => runQuickAction({ text: 'Show longitudinal summary' }) },
          { key: 'consult', label: 'Start Consultation',        icon: <Activity size={15} />,    variant: 'dark',
            onClick: () => runQuickAction({ text: 'Start consultation' }) },
          { key: 'back',    label: 'Back to summary',           icon: <ArrowLeft size={15} />,   variant: 'ghost',
            onClick: () => setRightPanel('summary') },
        ],
      }];
    }

    // ── Longitudinal ──
    if (rightPanel === 'longitudinal') {
      return [{
        title: 'What would you like to do next?',
        cols: 1,
        items: [
          { key: 'pre',     label: 'Generate Pre-treatment', icon: <FileText size={15} />,    variant: 'outline',
            onClick: () => runQuickAction({ text: 'Generate pre-treatment' }) },
          { key: 'tumor',   label: 'Tumor Board',            icon: <Stethoscope size={15} />, variant: 'outline',
            onClick: () => runQuickAction({ text: 'Tumor board' }) },
          { key: 'consult', label: 'Start Consultation',     icon: <Activity size={15} />,    variant: 'dark',
            onClick: () => runQuickAction({ text: 'Start consultation' }) },
          { key: 'back',    label: 'Back to summary',        icon: <ArrowLeft size={15} />,   variant: 'ghost',
            onClick: () => setRightPanel('summary') },
        ],
      }];
    }

    // ── Tumor Board ──
    if (rightPanel === 'tumorboard') {
      return [{
        title: 'What would you like to do next?',
        cols: 1,
        items: [
          { key: 'pre',     label: 'Generate Pre-treatment',    icon: <FileText size={15} />,    variant: 'outline',
            onClick: () => runQuickAction({ text: 'Generate pre-treatment' }) },
          { key: 'long',    label: 'Show Longitudinal Summary', icon: <Layers size={15} />,      variant: 'ghost',
            onClick: () => runQuickAction({ text: 'Show longitudinal summary' }) },
          { key: 'consult', label: 'Start Consultation',        icon: <Activity size={15} />,    variant: 'dark',
            onClick: () => runQuickAction({ text: 'Start consultation' }) },
          { key: 'back',    label: 'Back to summary',           icon: <ArrowLeft size={15} />,   variant: 'ghost',
            onClick: () => setRightPanel('summary') },
        ],
      }];
    }

    // ── Default: appointments / idle ──
    const groups = [];
    if (patientSelected) groups.push(patientGroup);
    groups.push(patientSelected ? generalGroup : { ...generalGroup, title: 'Get started', cols: 1 });
    if (rightPanel === 'appointments') {
      groups[groups.length - 1] = {
        ...groups[groups.length - 1],
        items: [
          ...groups[groups.length - 1].items,
          { key: 'hide', label: 'Hide appointments', icon: <X size={15} />, variant: 'ghost', onClick: () => setRightPanel(null) },
        ],
      };
    }
    return groups;
  };

  const suggestionGroups = getSuggestionGroups();

  // ✅ NEW — resolve the active workflow module component
  const ActiveWorkflowModule = useMemo(() => {
    const found = WORKFLOW_MODULES.find(m => m.id === workflowView);
    return found ? found.Component : PatientStory;
  }, [workflowView]);

  const activeWorkflowLabel = useMemo(() => {
    const found = WORKFLOW_MODULES.find(m => m.id === workflowView);
    return found ? found.label : 'Patient story';
  }, [workflowView]);

  const inputPlaceholder =
    isTranscribing ? "Transcribing…"
    : isRecording ? "Recording… click Stop to insert text"
    : awaitingVitalsConfirm ? "Type 'save', 'edit' or 'cancel'…"
    : rightPanel === 'appointments_page' ? "Pick a patient and schedule their appointment above…"
    : rightPanel === 'workflow' ? "Pick a workflow module from the suggestions…"
    : rightPanel === 'admission' && admissionStage === 'dictating' ? "Dictate the patient details…"
    : rightPanel === 'admission' ? "Edit fields on the right, then confirm…"
    : rightPanel === 'history' ? "Pick a history view from the suggestions…"
    : rightPanel === 'report_upload' && reportStage === 'choose_timing' ? "Choose current or previous…"
    : rightPanel === 'report_upload' && reportStage === 'upload_zone' ? "Pick a file on the right, then upload…"
    : rightPanel === 'report_upload' ? "Choose an option from the suggestions…"
    : rightPanel === 'consultation' && (consultation?.stage === 'dictating' || consultation?.stage === 'reviewing') ? "Dictate consultation notes…"
    : rightPanel === 'consultation' ? "Type a command or pick a suggestion…"
    : rightPanel === 'reasoning' ? "Ask the reasoning agent a question…"
    : rightPanel === 'autonomous' ? "Ask the autonomous agent a question…"
    : rightPanel === 'pretreatment' ? "Ask about pre-treatment, tumor board, or consultation…"
    : rightPanel === 'longitudinal' ? "Ask about pre-treatment, tumor board, or consultation…"
    : rightPanel === 'tumorboard' ? "Ask about pre-treatment, longitudinal summary, or consultation…"
    : rightPanel === 'summary' && summaryJob?.status === 'processing' ? "Summary is being generated…"
    : rightPanel === 'summary' ? "Ask for pre-treatment, tumor board, or consultation…"
    : preventiveSession?.awaitingNextPart ? "Type 'yes' for Part C, or 'no' to skip…"
    : rightPanel === 'vitals' ? "Type vitals (e.g., BP 120/80, HR 72)…"
    : preventiveSession?.awaitingDictation ? `Dictate or type Part ${preventiveSession.part} details…`
    : preventiveSession?.part ? `Ask to save Part ${preventiveSession.part}, or keep dictating…`
    : patientSelected ? "Type vitals or a command…"
    : "Type a command…";

  const showHero =
    !rightPanel ||
    (rightPanel === 'preventive' && !preventiveSession) ||
    (rightPanel === 'consultation' && !consultation);

  const statusText = isRecording
    ? 'Recording… click Stop to insert text'
    : isTranscribing ? 'Transcribing…'
    : isProcessing ? 'Thinking…'
    : isSpeaking ? 'Speaking…'
    : 'Voice Assistant';

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div className="va-root">
      <header className={`va-header ${isRecording ? 'live' : ''}`}>
        <div className="va-brand">
          <div className="va-logo"><Stethoscope size={18} /></div>
          <div>
            <div className="va-title">Doctor Assist</div>
            <div className="va-subtitle">
              <span className={`va-dot ${isRecording ? 'on' : ''}`} />
              {isRecording && <Radio size={12} />}
              {statusText}
              {(isProcessing || isTranscribing) && <Loader size={12} className="va-spin" />}
              {isSpeaking && <Volume2 size={12} />}
            </div>
          </div>
        </div>

        <div className="va-header-right">
          {currentPatientId && (
            <button
              type="button"
              className="va-patient-chip"
              title="Open patient dashboard"
              onClick={() => {
                const url = new URL(window.location.origin + '/dashboard');
                if (doctorId) url.searchParams.set('doctor_id', doctorId);
                url.searchParams.set('patient_id', currentPatientId);
                window.location.href = url.toString();
              }}
              style={{
                cursor: 'pointer',
                border: 'none',
                font: 'inherit',
              }}
            >
              <User size={13} /> {currentPatientName || String(currentPatientId).slice(-6)}
              {currentAppointmentId && <em>Appt {String(currentAppointmentId).slice(-6)}</em>}
            </button>
          )}
          <button type="button" className="va-hbtn" onClick={clearConversation} title="Clear conversation">
            <Trash2 size={15} /> <span>Clear</span>
          </button>
          {onClose && (
            <button type="button" className="va-hbtn icon" onClick={onClose} title="Close">
              <X size={17} />
            </button>
          )}
        </div>
      </header>

      <div className="va-body">
        <aside className="va-left">
          {isRecording && (
            <div className="va-level">
              <div className="va-level-track">
                <div className="va-level-fill" style={{ width: '100%', animation: 'pulse 1.2s ease-in-out infinite' }} />
              </div>
              <div className="va-level-meta">
                <span>● Recording — speak now</span>
                <span>Click Stop when you're done</span>
              </div>
            </div>
          )}

          {isTranscribing && (
            <div className="va-transcript">
              <Loader size={12} className="va-spin" style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Transcribing audio…
            </div>
          )}

          {transcript && <div className="va-transcript">🎤 {transcript}</div>}

          <div className="va-chat">
            {conversation.length === 0 && (
              <div className="va-msg assistant">
                <div className="va-avatar"><Sparkles size={14} /></div>
                <div>
                  <div className="va-bubble">{greeting}</div>
                  <div className="va-hint-line">
                    Click <b>Start</b> to record. Click <b>Stop</b> to transcribe into the input box.
                  </div>
                </div>
              </div>
            )}

            {conversation.map((msg, idx) => (
              <div key={idx} className={`va-msg ${msg.role}`}>
                {msg.role === 'assistant' && <div className="va-avatar"><Sparkles size={14} /></div>}
                <div style={{ maxWidth: '88%' }}>
                  <div className="va-bubble">
                    {msg.text}
                    {msg.followUp && msg.role === 'assistant' && (
                      <div className="va-followup">{msg.followUp}</div>
                    )}
                  </div>
                  {msg.timestamp && <div className="va-time">{msg.timestamp}</div>}
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className="va-msg assistant">
                <div className="va-avatar"><Sparkles size={14} /></div>
                <div className="va-bubble"><span className="typing-indicator">Processing</span></div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="va-sug">
            {suggestionGroups.map((g, gi) => (
              <div key={gi} className="va-sug-group">
                <div className="va-sug-title">{gi === 0 && <Sparkles size={12} />} {g.title}</div>
                {g.hint && <div className="va-sug-hint">{g.hint}</div>}
                <div className="va-sug-grid" style={{ gridTemplateColumns: `repeat(${g.cols || 1}, 1fr)` }}>
                  {g.items.map(it => (
                    <SugBtn
                      key={it.key}
                      icon={it.icon}
                      label={it.label}
                      sub={it.sub}
                      variant={it.variant}
                      disabled={isProcessing}
                      onClick={it.onClick}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="va-input-row">
            <input
              type="text"
              className="va-input"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } }}
              placeholder={inputPlaceholder}
              disabled={isProcessing || isTranscribing}
            />
            <button
              type="button"
              className="va-send"
              onClick={submitTyped}
              disabled={!typedInput.trim() || isProcessing || isTranscribing}
              title="Send"
            >
              <Send size={15} />
            </button>
          </div>

          {conversationId && (
            <div className="va-meta">
              <span>ID {conversationId.slice(-6)}</span>
              {vitalsSaved && <span className="va-meta-strong">✓ Vitals saved</span>}
              {preventiveSession?.part && (
                <span className="va-meta-strong">
                  Part {preventiveSession.part} · {preventiveProgress?.filledCount || 0}/{preventiveProgress?.total || 0}
                </span>
              )}
              {summaryJob?.status === 'processing' && <span>Summary generating…</span>}
              {summaryJob?.status === 'completed' && <span className="va-meta-strong">Summary ready</span>}
              {rightPanel === 'workflow' && (
                <span className="va-meta-strong">Workflow · {activeWorkflowLabel}</span>
              )}
              {rightPanel === 'pretreatment' && <span>Pre-treatment open</span>}
              {rightPanel === 'longitudinal' && <span>Longitudinal open</span>}
              {rightPanel === 'tumorboard' && <span className="va-meta-strong">Tumor board open</span>}
              {rightPanel === 'history' && historyTab && (
                <span className="va-meta-strong">History · {historyTab.replace(/_/g, ' ')}</span>
              )}
              {rightPanel === 'admission' && admissionStage && (
                <span className="va-meta-strong">Admission · {admissionStage}</span>
              )}
              {rightPanel === 'consultation' && consultation && (
                <span>Consultation · {consultation.stage}</span>
              )}
              {rightPanel === 'report_upload' && reportStage && (
                <span>Report · {reportStage.replace(/_/g, ' ')}</span>
              )}
              {rightPanel === 'reasoning' && reasoningJob && (
                <span className="va-meta-strong">Reasoning · {reasoningJob.status}</span>
              )}
              {rightPanel === 'autonomous' && autonomousJob && (
                <span className="va-meta-strong">Autonomous · {autonomousJob.status}</span>
              )}
            </div>
          )}

          <div className="va-controls">
            <button
              type="button"
              className={`va-mic ${isRecording ? 'live' : ''}`}
              onClick={toggleRecording}
              disabled={isTranscribing}
            >
              {isRecording ? <MicOff size={17} /> : <Mic size={17} />}
              {isRecording ? 'Stop' : 'Start'}
            </button>

            {patientSelected && (
              <div className="va-clinical-controls">
                <button
                  type="button"
                  className={`va-clinical-btn ${rightPanel === 'reasoning' ? 'active' : ''}`}
                  onClick={() => {
                    setPatientMenuVisible(false);
                    setRightPanel('reasoning');
                  }}
                  title="Open the read-only Clinical Reasoning agent"
                >
                  <Brain size={14} />
                  <span>Reasoning</span>
                </button>
                <button
                  type="button"
                  className={`va-clinical-btn ${rightPanel === 'autonomous' ? 'active' : ''}`}
                  onClick={() => {
                    setPatientMenuVisible(false);
                    setRightPanel('autonomous');
                  }}
                  title="Open the Autonomous agent"
                >
                  <Zap size={14} />
                  <span>Autonomous</span>
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="va-ctrl"
                onClick={() => { if (response) speakText(response); }}
                disabled={!response || isSpeaking}
                title="Repeat last response"
              >
                {isSpeaking ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              {conversationId && (
                <button
                  type="button"
                  className="va-ctrl"
                  onClick={async () => {
                    try {
                      await fetch(`${API_BASE_URL}hms/users/ai-legacy/refresh/${conversationId}`, { method: 'POST' });
                    } catch (e) { console.error('Refresh error:', e); }
                  }}
                  title="Refresh data"
                >
                  <Clock size={15} />
                </button>
              )}
            </div>
          </div>

          {error && <div className="va-error">Error — {error}</div>}
        </aside>

        <main className="va-right">
          {showHero && (
            <div className="va-hero">
              <div className={`va-hero-orb ${isRecording ? 'live' : ''}`}>
                {isRecording ? <Waves size={36} /> : <Mic size={36} />}
              </div>
              <div className="va-hero-label">Doctor Assist</div>
              <h2>{patientSelected ? currentPatientName || 'Patient selected' : greeting.split('.')[0] + '.'}</h2>
              <p>
                {patientSelected
                  ? 'Choose an action on the left. Vitals, screening, summaries and consultation notes will appear here.'
                  : 'Pick a suggestion on the left or press Start and speak. Appointments, forms and summaries will appear here.'}
              </p>
              {patientSelected && (
                <div className="va-hero-card">
                  <div><span>Patient</span><b>{currentPatientName || '—'}</b></div>
                  <div><span>Patient ID</span><b>{String(currentPatientId).slice(-8)}</b></div>
                  {currentAppointmentId && <div><span>Appointment</span><b>{String(currentAppointmentId).slice(-8)}</b></div>}
                </div>
              )}
            </div>
          )}

          {/* ✅ NEW — Workflow module (Patient Story, Baseline, etc.) */}
          {rightPanel === 'workflow' && (
            <PanelShell
              icon={<Layers size={17} />}
              title={activeWorkflowLabel}
              status={`Workflow · ${WORKFLOW_MODULES.findIndex(m => m.id === workflowView) + 1} of ${WORKFLOW_MODULES.length}`}
            >
              <div className="va-card flush">
                <ActiveWorkflowModule
                  patientId={currentPatientId}
                  doctorId={doctorId}
                  appointmentId={currentAppointmentId}
                  patientName={currentPatientName}
                  specialty={doctorSpeciality}
                  onClose={() => { setRightPanel(null); setPatientMenuVisible(true); }}
                />
              </div>
            </PanelShell>
          )}

          {/* ✅ NEW — Embedded Take Appointment page */}
          {rightPanel === 'appointments_page' && (
            <PanelShell
              icon={<CalendarPlus size={17} />}
              title="Take Appointment"
              status="Scheduling"
            >
              <div
                className="va-card flush"
                style={{ padding: 0, border: "none", background: "transparent" }}
              >
                <Appointments />
              </div>
            </PanelShell>
          )}

          {/* ── New Admission ── */}
          {rightPanel === 'admission' && (
            <PanelShell
              icon={<UserPlus size={17} />}
              title="New Admission"
              status={
                admissionStage === 'dictating' ? 'Dictating'
                : admissionStage === 'reviewing' ? 'Review'
                : admissionStage === 'submitting' ? 'Submitting…'
                : admissionStage === 'done' ? 'Registered'
                : undefined
              }
            >
              {admissionStage === 'dictating' && (
                <>
                  <div className="va-card">
                    <div className="va-card-title">Dictate the patient details</div>
                    <div className="va-card-note">
                      Say or type something like: "Name is Ravi Kumar, DOB 1990-05-15, gender male, phone 9876543210, email ravi@example.com, blood group O+, address 12 MG Road, occupation engineer, income 500000, family history diabetes."
                    </div>
                  </div>

                  {admissionDictation && (
                    <div className="va-card">
                      <div className="va-section-label">Dictation so far</div>
                      <div style={{ fontSize: '0.8rem', color: C.textSecond, lineHeight: 1.6 }}>
                        {admissionDictation}
                      </div>
                    </div>
                  )}

                  <div className="va-empty">
                    <Mic size={28} style={{ opacity: 0.25, marginBottom: 10 }} />
                    <div>Speak or type the details on the left.</div>
                    <div className="va-empty-sub">Or click "Skip dictation" to fill the form manually.</div>
                  </div>
                </>
              )}

              {(admissionStage === 'reviewing' || admissionStage === 'submitting') && (
                <>
                  <div className="va-card">
                    <div className="va-card-title">Review & edit</div>
                    <div className="va-card-note">
                      Parsed from your dictation. Fix anything below, then confirm.
                    </div>
                    <div className="va-vitals-grid" style={{ marginTop: 12 }}>
                      {ADMISSION_FIELDS.map((f) => (
                        <div key={f.key} className="va-field">
                          <label>
                            {f.label}{f.required ? ' *' : ''}
                          </label>
                          <input
                            type={f.type}
                            value={admissionData[f.key] || ''}
                            onChange={(e) => setAdmissionData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            disabled={admissionStage === 'submitting'}
                            placeholder={f.required ? 'required' : ''}
                          />
                        </div>
                      ))}
                    </div>

                    {admissionMessage && (
                      <div style={{
                        marginTop: 12,
                        padding: '0.6rem 0.875rem',
                        border: `1px solid ${admissionMessage.type === 'success' ? '#c8e6c9' : '#ffcdd2'}`,
                        background: admissionMessage.type === 'success' ? '#f1f8e9' : '#fce4ec',
                        fontSize: '0.75rem',
                        color: admissionMessage.type === 'success' ? '#2e7d32' : '#c62828',
                      }}>
                        {admissionMessage.text}
                      </div>
                    )}
                  </div>

                  <div className="va-card">
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: showAdmissionJson ? 10 : 0,
                    }}>
                      <div className="va-section-label" style={{ margin: 0 }}>Payload preview</div>
                      <button
                        type="button"
                        onClick={() => setShowAdmissionJson((v) => !v)}
                        style={{
                          background: 'transparent', border: `1px solid ${C.border}`,
                          padding: '4px 10px', fontSize: '0.68rem', cursor: 'pointer',
                          color: C.textSecond, textTransform: 'uppercase', letterSpacing: '0.06em',
                        }}
                      >
                        {showAdmissionJson ? 'Hide' : 'Show'} JSON
                      </button>
                    </div>

                    {showAdmissionJson && (
                      <pre style={{
                        margin: 0,
                        padding: '0.75rem',
                        background: C.bgTertiary,
                        fontSize: '0.7rem',
                        fontFamily: 'monospace',
                        color: C.textSecond,
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}>
                        {JSON.stringify({
                          ...admissionData,
                          hospital_id: admissionData.hospital_id || '',
                          doctor_id: admissionData.doctor_id || doctorId || '',
                        }, null, 2)}
                      </pre>
                    )}
                  </div>
                </>
              )}

              {admissionStage === 'done' && admissionResult && (
                <div className="va-card">
                  <CheckCircle size={24} style={{ marginBottom: 8 }} />
                  <div className="va-card-title">Patient registered successfully</div>
                  <div className="va-card-note">
                    <div><b>HMS ID:</b> {admissionData.hms_id}</div>
                    <div><b>Patient ID:</b> {admissionResult.patient_id || '—'}</div>
                    <div><b>Sys User ID:</b> {admissionResult.sys_user_id || '—'}</div>
                    <div><b>Hospital ID:</b> {admissionResult.hospital_id || '—'}</div>
                  </div>
                </div>
              )}
            </PanelShell>
          )}

          {rightPanel === 'appointments' && (
            <PanelShell icon={<Calendar size={17} />} title={`Today's Appointments (${appointments.length})`}>
              {appointments.length === 0 ? (
                <div className="va-empty">No appointments today.</div>
              ) : (
                <div className="va-appt-grid">
                  {appointments.map((apt, idx) => {
                    const pid = apt.sys_user_id || apt.patient_id || apt.id;
                    const isSelected = pid && pid === currentPatientId;
                    return (
                      <button
                        type="button"
                        key={pid || idx}
                        onClick={() => selectPatient(apt)}
                        className={`va-appt ${isSelected ? 'sel' : ''}`}
                      >
                        <div className="va-appt-avatar"><User size={18} /></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="va-appt-name">{apt.patient_name || 'Unknown Patient'}</div>
                          <div className="va-appt-time">
                            {apt.appointment_time || apt.time || apt.slot || 'Time not specified'}
                          </div>
                        </div>
                        {isSelected && <Check size={17} style={{ flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </PanelShell>
          )}

          {rightPanel === 'vitals' && (
            <PanelShell
              icon={<Activity size={17} />}
              title={awaitingVitalsConfirm ? 'Review Vitals' : 'Vitals'}
              status={awaitingVitalsConfirm ? 'Awaiting confirmation' : undefined}
            >
              {!awaitingVitalsConfirm && Object.keys(editableVitals).length === 0 && (
                <div className="va-empty">
                  <Mic size={28} style={{ opacity: 0.25, marginBottom: 10 }} />
                  <div>Dictate or type the patient's vitals.</div>
                  <div className="va-empty-sub">Example: "BP 120 over 80, heart rate 72, temperature 98.6"</div>
                </div>
              )}

              {Object.keys(editableVitals).length > 0 && (
                <div className="va-card">
                  <div className="va-card-note">
                    {awaitingVitalsConfirm
                      ? 'Review and edit the values below, then save from the suggestions on the left.'
                      : 'Current vitals:'}
                  </div>
                  <div className="va-vitals-grid">
                    {Object.entries(editableVitals).map(([key, val]) => (
                      <div key={key} className="va-field">
                        <label>{key.replace(/_/g, ' ')}</label>
                        <input
                          value={val}
                          onChange={(e) => setEditableVitals({ ...editableVitals, [key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </PanelShell>
          )}

          {/* ✅ CHANGED — Preventive panel now shows WHAT was filled (per-section values) + a "show filled only" toggle */}
          {rightPanel === 'preventive' && preventiveSession && (
            <PanelShell
              icon={<Shield size={17} />}
              title={`Preventive Screening${preventiveSession.part ? ` — Part ${preventiveSession.part}` : ''}`}
            >
              {!preventiveSession.part && (
                <div className="va-grid-2">
                  <div className="va-card">
                    <div className="va-card-title">Part A — Case History</div>
                    <div className="va-card-note">
                      Registration, symptoms, history, family, substance abuse, previous cancer, menstrual / obstetric / contraceptive / HRT.
                    </div>
                  </div>
                  <div className="va-card">
                    <div className="va-card-title">Part C — Examination</div>
                    <div className="va-card-note">
                      General exam, breast, cervical, prescription, follow-up.
                    </div>
                  </div>
                </div>
              )}

              {preventiveSession.part && preventiveSession.awaitingDictation && (
                <div className="va-empty">
                  <Mic size={28} style={{ opacity: 0.25, marginBottom: 10 }} />
                  <div>Dictate or type the {preventiveSession.part === 'A' ? 'case history' : 'examination'} details.</div>
                  <div className="va-empty-sub">I'll fill the form on the main page and highlight the sections I populated.</div>
                </div>
              )}

              {preventiveSession.part && !preventiveSession.awaitingDictation && preventiveSession.awaitingNextPart && (
                <div className="va-card">
                  <CheckCircle size={24} style={{ marginBottom: 8 }} />
                  <div className="va-card-title">Part A saved</div>
                  <div className="va-card-note">Choose on the left whether to continue with Part C.</div>
                </div>
              )}

              {preventiveSession.part && !preventiveSession.awaitingDictation && !preventiveSession.awaitingNextPart && (
                <>
                  {preventiveProgress && (
                    <div className="va-card">
                      <div className="va-card-title">
                        {preventiveProgress.isComplete
                          ? `All ${preventiveProgress.total} sections filled`
                          : `${preventiveProgress.filledCount} of ${preventiveProgress.total} sections filled`}
                      </div>
                      <div className="va-progress">
                        <div style={{ width: `${preventiveProgress.pct}%` }} />
                      </div>
                    </div>
                  )}

                  {/* ✅ NEW — toggle card to show filled only / all */}
                  <div className="va-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div className="va-card-note" style={{ margin: 0 }}>
                      {showFilledOnly
                        ? 'Showing filled sections only'
                        : 'Showing all sections (filled + pending)'}
                    </div>
                    <button
                      type="button"
                      className="va-hbtn"
                      onClick={() => setShowFilledOnly(v => !v)}
                    >
                      {showFilledOnly ? 'Show all' : 'Show filled only'}
                    </button>
                  </div>

                  <div className="va-grid-2">
                    {/* ✅ CHANGED — Filled sections now render each field/value recursively */}
                    {preventiveSession.filledSections?.length > 0 && (
                      <div>
                        <div className="va-section-label">Filled — with values</div>
                        {preventiveSession.filledSections.map(sec => {
                          const values = getSectionValues(preventiveSession.draft, sec);

                          // Hide entries whose value is entirely empty
                          const visibleValues = values.filter(([_, v]) => {
                            if (v === null || v === undefined || v === '') return false;
                            if (Array.isArray(v)) return v.length > 0;
                            if (typeof v === 'object') {
                              return Object.values(v).some(
                                (x) =>
                                  x !== null &&
                                  x !== undefined &&
                                  x !== '' &&
                                  !(Array.isArray(x) && x.length === 0)
                              );
                            }
                            return true;
                          });

                          return (
                            <div
                              key={`f-${sec}`}
                              className="va-sec-row filled"
                              style={{
                                display: 'block',
                                textTransform: 'none',
                                padding: '10px 12px',
                              }}
                            >
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                marginBottom: visibleValues.length ? 8 : 0,
                              }}>
                                <Check size={13} />
                                <b style={{ textTransform: 'capitalize' }}>
                                  {prettySection(sec)}
                                </b>
                                <span style={{
                                  marginLeft: 'auto',
                                  fontSize: '0.62rem',
                                  color: C.textMuted,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.08em',
                                }}>
                                  {visibleValues.length > 0
                                    ? `${visibleValues.length} field${visibleValues.length === 1 ? '' : 's'}`
                                    : 'marked complete'}
                                </span>
                              </div>

                              {visibleValues.length > 0 ? (
                                <div>
                                  {visibleValues.flatMap(([k, v]) =>
                                    renderValueRows(v, 0, `${sec}-${k}`).map((row, i) => (
                                      <div
                                        key={`${sec}-${k}-${i}`}
                                        style={{
                                          display: 'flex',
                                          gap: 6,
                                          alignItems: 'flex-start',
                                          paddingLeft: 19,
                                        }}
                                      >
                                        <span style={{
                                          color: C.textMuted,
                                          minWidth: 130,
                                          flexShrink: 0,
                                          fontSize: '0.76rem',
                                          lineHeight: 1.7,
                                        }}>
                                          {prettyField(k)}:
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>{row}</div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              ) : (
                                <div style={{
                                  paddingLeft: 19,
                                  fontSize: '0.72rem',
                                  color: C.textMuted,
                                  fontStyle: 'italic',
                                }}>
                                  (section flagged complete — no values captured)
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ✅ CHANGED — Pending hidden when showFilledOnly is on */}
                    {!showFilledOnly && preventiveSession.pendingSections?.length > 0 && (
                      <div>
                        <div className="va-section-label">Still pending</div>
                        {preventiveSession.pendingSections.map(sec => (
                          <div key={`p-${sec}`} className="va-sec-row pending">
                            <AlertCircle size={13} />
                            <span>{prettySection(sec)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {(!preventiveSession.filledSections || preventiveSession.filledSections.length === 0) && (
                    <div className="va-empty">
                      No sections filled yet for Part {preventiveSession.part}. Dictate some details first.
                    </div>
                  )}
                </>
              )}
            </PanelShell>
          )}

          {rightPanel === 'summary' && (
            <PanelShell
              icon={<FileText size={17} />}
              title="Patient Summary"
              status={summaryJob?.status === 'processing' ? 'Generating…' : summaryJob?.status === 'completed' ? 'Ready' : undefined}
            >
              {summaryJob?.status === 'processing' && (
                <div className="va-empty">
                  <Loader size={28} className="va-spin" style={{ marginBottom: 12 }} />
                  <div style={{ fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>Generating patient summary…</div>
                  <div className="va-empty-sub">This usually takes 30–60 seconds. I'll show the summary here as soon as it's ready.</div>
                </div>
              )}

              {summaryJob?.status === 'failed' && (
                <div className="va-card">
                  <div className="va-card-title">{summaryJob.error || 'Could not generate summary'}</div>
                  <div className="va-card-note">Use "Retry summary" on the left to try again.</div>
                </div>
              )}

              {summaryJob?.status === 'completed' && (
                <div className="va-card flush">
                  <PatientSummary patientId={currentPatientId} trigger={summaryJob.trigger} />
                </div>
              )}
            </PanelShell>
          )}

          {rightPanel === 'pretreatment' && (
            <PanelShell icon={<FileText size={17} />} title="Pre-treatment Plan">
              <div className="va-card flush">
                <PreTreatmentAssessmentPanel
                  patientId={currentPatientId}
                  doctorId={doctorId}
                  encounterId={currentAppointmentId}
                />
              </div>
            </PanelShell>
          )}

          {rightPanel === 'longitudinal' && (
            <PanelShell icon={<Layers size={17} />} title="Longitudinal Summary">
              <div className="va-card flush">
                <LongitudinalSummaryTab patientId={currentPatientId} doctorId={doctorId} />
              </div>
            </PanelShell>
          )}

          {rightPanel === 'tumorboard' && (
            <PanelShell icon={<Stethoscope size={17} />} title="Tumor Board">
              <div className="va-card flush">
                <TumorBoard
                  doctorId={doctorId}
                  patientId={currentPatientId}
                  doctorSpeciality={doctorSpeciality}
                  doctorName={doctorName}
                />
              </div>
            </PanelShell>
          )}

          {/* ── Clinical Reasoning ── */}
          {rightPanel === 'reasoning' && (
            <PanelShell
              icon={<Brain size={17} />}
              title="Clinical Reasoning"
              status={
                reasoningJob?.status === 'loading' ? 'Reasoning…'
                : reasoningJob?.clarification ? 'Needs clarification'
                : reasoningJob?.status === 'done' ? 'Read-only'
                : reasoningJob?.status === 'error' ? 'Error'
                : 'Awaiting question'
              }
            >
              {reasoningHistory.length === 0 && reasoningJob?.status !== 'loading' && (
                <div className="va-card">
                  <div className="va-card-title">Ask a question about this patient</div>
                  <div className="va-card-note">
                    This agent reads the patient's record, reconciles conflicts deterministically,
                    and reasons through your question. It never edits the chart.
                    <br /><br />
                    Try: <em>"Analyse treatment response of patient"</em>, <em>"What are the current risk flags?"</em>,
                    <em>"Summarise the current clinical picture"</em>, or <em>"What's unresolved in the data?"</em>
                  </div>
                </div>
              )}

              {reasoningHistory.map((h, i) => {
                const full = h.full || {};
                return (
                  <div key={i} className="va-card">
                    <div className="va-section-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Q · {h.ts}</span>
                      {full.confidence && (
                        <span style={{ color: C.textMuted, fontSize: '0.62rem', letterSpacing: '0.08em' }}>
                          Confidence: {full.confidence}
                        </span>
                      )}
                    </div>
                    <div className="va-card-title">{h.question}</div>

                    {h.clarification ? (
                      <div className="va-card-note" style={{ fontStyle: 'italic' }}>
                        {full.answer || full.clarification?.reason}
                      </div>
                    ) : (
                      <>
                        <ConflictBanner reconciliation={full.reconciliation} />

                        <div className="va-card-note" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>
                          {full.answer}
                        </div>

                        {full.clinical_picture && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Clinical picture</div>
                            <div className="va-card-note">{full.clinical_picture}</div>
                          </div>
                        )}

                        {full.risk_flags?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Risk flags</div>
                            {full.risk_flags.map((f, idx) => {
                              const colors = SEVERITY_COLOR[f.severity] || SEVERITY_COLOR.low;
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    display: 'flex',
                                    gap: 8,
                                    alignItems: 'flex-start',
                                    padding: '8px 10px',
                                    marginBottom: 6,
                                    border: `1px solid ${colors.border}`,
                                    background: colors.bg,
                                    fontSize: '0.76rem',
                                    color: colors.fg,
                                  }}
                                >
                                  <AlertCircle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                                  <span>
                                    <b>{f.flag}</b>
                                    {f.why && <> — {f.why}</>}
                                    {f.severity && (
                                      <span style={{ marginLeft: 6, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8 }}>
                                        ({SEVERITY_LABEL[f.severity] || f.severity})
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {full.recommended_next_steps?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Recommended next steps</div>
                            {full.recommended_next_steps.map((s, idx) => (
                              <div key={idx} className="va-sec-row filled">
                                <Check size={13} />
                                <span>{s}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {full.unresolved_data_issues?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Unresolved data issues</div>
                            {full.unresolved_data_issues.map((s, idx) => (
                              <div key={idx} className="va-sec-row pending" style={{ alignItems: 'flex-start' }}>
                                <AlertCircle size={13} style={{ marginTop: 2 }} />
                                <span>{s}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {full.evidence?.length > 0 && (
                          <details style={{ marginTop: 12 }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: C.textMuted }}>
                              Evidence ({full.evidence.length})
                            </summary>
                            <div style={{ marginTop: 6 }}>
                              {full.evidence.map((e, idx) => (
                                <div key={idx} style={{ fontSize: '0.72rem', padding: '4px 0', borderBottom: `1px solid ${C.border}` }}>
                                  <span>{e.claim}</span>
                                  <span style={{ marginLeft: 6, color: C.textMuted }}>· {e.source}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {full.pipeline && (
                          <details style={{ marginTop: 10 }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: C.textMuted }}>
                              Pipeline audit
                            </summary>
                            <pre style={{
                              marginTop: 6,
                              padding: '0.6rem',
                              background: C.bgTertiary,
                              fontSize: '0.65rem',
                              fontFamily: 'monospace',
                              color: C.textSecond,
                              overflowX: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}>
                              {JSON.stringify(full.pipeline, null, 2)}
                            </pre>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {reasoningJob?.status === 'loading' && (
                <div className="va-empty">
                  <Loader size={24} className="va-spin" style={{ marginBottom: 10 }} />
                  <div>Running the multi-step pipeline…</div>
                  <div className="va-empty-sub">
                    Validating inputs → analysing the question → reconciling the record → reasoning → verifying.
                  </div>
                </div>
              )}

              {reasoningJob?.status === 'error' && (
                <div className="va-card">
                  <div className="va-card-title">{reasoningJob.error || 'Could not complete reasoning'}</div>
                  <div className="va-card-note">Edit the question below and try again.</div>
                </div>
              )}

              <div ref={reasoningEndRef} />

              <div className="va-card" style={{ position: 'sticky', bottom: 0, background: C.white }}>
                <div className="va-section-label">Ask a follow-up</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="va-input"
                    style={{ flex: 1 }}
                    value={clinicalQueryInput}
                    onChange={(e) => setClinicalQueryInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitClinicalQuery(); } }}
                    placeholder="e.g. Analyse treatment response of patient"
                    disabled={isProcessing}
                  />
                  <button
                    type="button"
                    className="va-send"
                    onClick={submitClinicalQuery}
                    disabled={!clinicalQueryInput.trim() || isProcessing}
                    title="Send"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </PanelShell>
          )}

          {/* ── Clinical Autonomous ── */}
          {rightPanel === 'autonomous' && (
            <PanelShell
              icon={<Zap size={17} />}
              title="Autonomous Agent"
              status={
                autonomousJob?.status === 'loading' ? 'Working…'
                : autonomousJob?.clarification ? 'Needs clarification'
                : autonomousJob?.status === 'done' ? 'Ready'
                : autonomousJob?.status === 'error' ? 'Error'
                : 'Awaiting question'
              }
            >
              {autonomousHistory.length === 0 && autonomousJob?.status !== 'loading' && (
                <div className="va-card">
                  <div className="va-card-title">Ask a question — I'll handle routine items automatically</div>
                  <div className="va-card-note">
                    Low-risk items (flags, notifications, internal tasks) run automatically.
                    Anything that touches the care plan waits for your confirmation.
                    <br /><br />
                    Try: <em>"Analyse treatment response of patient"</em>, <em>"Anything I should follow up on?"</em>,
                    or <em>"Schedule the next step and flag any conflicts."</em>
                  </div>
                </div>
              )}

              {autonomousHistory.map((h, i) => {
                const full = h.full || {};
                const reasoning = full.reasoning || {};
                return (
                  <div key={i} className="va-card">
                    <div className="va-section-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Q · {h.ts}</span>
                      {reasoning.confidence && (
                        <span style={{ color: C.textMuted, fontSize: '0.62rem', letterSpacing: '0.08em' }}>
                          Confidence: {reasoning.confidence}
                        </span>
                      )}
                    </div>
                    <div className="va-card-title">{h.question}</div>

                    {h.clarification ? (
                      <div className="va-card-note" style={{ fontStyle: 'italic' }}>
                        {full.answer || full.clarification?.reason}
                      </div>
                    ) : (
                      <>
                        <ConflictBanner reconciliation={full.reconciliation} />

                        <div className="va-card-note" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>
                          {reasoning.answer || reasoning.clinical_picture || full.answer}
                        </div>

                        {reasoning.clinical_picture && reasoning.answer && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Clinical picture</div>
                            <div className="va-card-note">{reasoning.clinical_picture}</div>
                          </div>
                        )}

                        {reasoning.risk_flags?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Risk flags</div>
                            {reasoning.risk_flags.map((f, idx) => {
                              const colors = SEVERITY_COLOR[f.severity] || SEVERITY_COLOR.low;
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    display: 'flex',
                                    gap: 8,
                                    alignItems: 'flex-start',
                                    padding: '8px 10px',
                                    marginBottom: 6,
                                    border: `1px solid ${colors.border}`,
                                    background: colors.bg,
                                    fontSize: '0.76rem',
                                    color: colors.fg,
                                  }}
                                >
                                  <AlertCircle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                                  <span>
                                    <b>{f.flag}</b>
                                    {f.why && <> — {f.why}</>}
                                    {f.severity && (
                                      <span style={{ marginLeft: 6, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8 }}>
                                        ({SEVERITY_LABEL[f.severity] || f.severity})
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {full.executed_actions?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Executed automatically</div>
                            {full.executed_actions.map((a) => (
                              <div key={a.id} className="va-sec-row filled" style={{ alignItems: 'flex-start' }}>
                                <Check size={13} style={{ marginTop: 2 }} />
                                <span>
                                  {a.description}
                                  {a.executed === false && (
                                    <span style={{ marginLeft: 6, color: '#c62828', fontSize: '0.68rem' }}>(failed to log)</span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {full.pending_actions?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="va-section-label">Waiting on your confirmation</div>
                            {full.pending_actions.map((a) => (
                              <div key={a.id} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 12px', marginBottom: 8,
                                border: `1px dashed ${C.border}`, fontSize: '0.78rem',
                              }}>
                                <AlertCircle size={14} style={{ flexShrink: 0, color: C.textMuted }} />
                                <span style={{ flex: 1 }}>{a.description}</span>
                                <button
                                  type="button"
                                  className="va-hbtn"
                                  style={{ padding: '5px 10px' }}
                                  onClick={() => confirmAutonomousAction(a)}
                                  title="Confirm this action"
                                >
                                  <ThumbsUp size={12} /> Confirm
                                </button>
                                <button
                                  type="button"
                                  className="va-hbtn"
                                  style={{ padding: '5px 10px' }}
                                  onClick={() => dismissAutonomousAction(a.id)}
                                  title="Dismiss this action"
                                >
                                  <ThumbsDown size={12} /> Dismiss
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {reasoning.evidence?.length > 0 && (
                          <details style={{ marginTop: 12 }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: C.textMuted }}>
                              Evidence ({reasoning.evidence.length})
                            </summary>
                            <div style={{ marginTop: 6 }}>
                              {reasoning.evidence.map((e, idx) => (
                                <div key={idx} style={{ fontSize: '0.72rem', padding: '4px 0', borderBottom: `1px solid ${C.border}` }}>
                                  <span>{e.claim}</span>
                                  <span style={{ marginLeft: 6, color: C.textMuted }}>· {e.source}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {full.pipeline && (
                          <details style={{ marginTop: 10 }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: C.textMuted }}>
                              Pipeline audit
                            </summary>
                            <pre style={{
                              marginTop: 6,
                              padding: '0.6rem',
                              background: C.bgTertiary,
                              fontSize: '0.65rem',
                              fontFamily: 'monospace',
                              color: C.textSecond,
                              overflowX: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}>
                              {JSON.stringify(full.pipeline, null, 2)}
                            </pre>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {autonomousJob?.status === 'loading' && (
                <div className="va-empty">
                  <Loader size={24} className="va-spin" style={{ marginBottom: 10 }} />
                  <div>Reasoning, then handling routine items…</div>
                  <div className="va-empty-sub">Low-risk items run automatically. Anything touching the care plan waits for your confirmation.</div>
                </div>
              )}

              {autonomousJob?.status === 'error' && (
                <div className="va-card">
                  <div className="va-card-title">{autonomousJob.error || 'Could not complete the autonomous run'}</div>
                  <div className="va-card-note">Edit the question below and try again.</div>
                </div>
              )}

              <div ref={autonomousEndRef} />

              <div className="va-card" style={{ position: 'sticky', bottom: 0, background: C.white }}>
                <div className="va-section-label">Ask a follow-up</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="va-input"
                    style={{ flex: 1 }}
                    value={clinicalQueryInput}
                    onChange={(e) => setClinicalQueryInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitClinicalQuery(); } }}
                    placeholder="e.g. Analyse treatment response of patient"
                    disabled={isProcessing}
                  />
                  <button
                    type="button"
                    className="va-send"
                    onClick={submitClinicalQuery}
                    disabled={!clinicalQueryInput.trim() || isProcessing}
                    title="Send"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </PanelShell>
          )}

          {/* ── History ── */}
          {rightPanel === 'history' && (
            <PanelShell
              icon={<Clock size={17} />}
              title="Patient History"
              status={
                historyTab === 'list' ? 'List'
                : historyTab === 'medication' ? 'Medications'
                : historyTab === 'investigation' ? 'Investigations'
                : historyTab === 'treatment' ? 'Treatment Plan'
                : historyTab === 'clinical_note' ? 'Clinical Notes'
                : historyTab === 'vitals' ? 'Vitals'
                : historyTab === 'dicom' ? 'DICOM Imaging'
                : 'Choose a view'
              }
            >
              {historyStage === 'choose' && (
                <div className="va-empty">
                  <Clock size={28} style={{ opacity: 0.25, marginBottom: 10 }} />
                  <div>Choose what you would like to view on the left.</div>
                  <div className="va-empty-sub">List, Medications, Investigations, Treatment, Clinical Notes, Vitals, or DICOM Imaging.</div>
                </div>
              )}

              {historyStage === 'list' && (
                <div className="va-card flush">
                  <DocumentRetrieval patientId={currentPatientId} doctorId={doctorId} />
                </div>
              )}

              {historyStage === 'medication' && (
                <div className="va-card flush">
                  <MedicationListPanel patientId={currentPatientId} doctorId={doctorId} />
                </div>
              )}

              {historyStage === 'investigation' && (
                <div className="va-card flush">
                  <InvestigationListPanel patientId={currentPatientId} doctorId={doctorId} />
                </div>
              )}

              {historyStage === 'treatment' && (
                <div className="va-card flush">
                  <TreatmentPlanPanel patientId={currentPatientId} doctorId={doctorId} />
                </div>
              )}

              {historyStage === 'clinical_note' && (
                <div className="va-card flush">
                  <ClinicalNotePanel patientId={currentPatientId} doctorId={doctorId} />
                </div>
              )}

              {historyStage === 'vitals' && (
                <div className="va-card flush">
                  <VitalsPanel patientId={currentPatientId} doctorId={doctorId} />
                </div>
              )}

              {historyStage === 'dicom' && (
                <div className="va-card flush">
                  <DICOMViewer patientId={currentPatientId} />
                </div>
              )}
            </PanelShell>
          )}

          {rightPanel === 'report_upload' && (
            <PanelShell
              icon={<FileUp size={17} />}
              title="Report Upload"
              status={
                reportStage === 'current_pending'
                  ? (loadingInvestigations ? 'Loading…' : `${pendingInvestigations.length} pending`)
                  : reportUploading ? 'Uploading…'
                  : reportProcessing ? 'Processing…'
                  : undefined
              }
            >
              {reportStage === 'choose_timing' && (
                <div className="va-empty">
                  <FileUp size={28} style={{ opacity: 0.25, marginBottom: 10 }} />
                  <div>Choose <b>Current Report</b> or <b>Previous Report</b> from the left.</div>
                </div>
              )}

              {reportStage === 'current_choice' && (
                <div className="va-empty">
                  <div>Pick <b>Pending Investigations</b> or <b>Normal Upload</b> on the left.</div>
                </div>
              )}

              {(reportStage === 'previous_choice' || reportStage === 'current_normal') && (
                <div className="va-empty">
                  <div>Choose <b>With Category</b> or <b>Without Category</b> on the left.</div>
                </div>
              )}

              {reportStage === 'current_pending' && (
                <>
                  {loadingInvestigations ? (
                    <div className="va-empty">
                      <Loader size={22} className="va-spin" style={{ marginBottom: 8 }} />
                      <div>Loading pending investigations…</div>
                    </div>
                  ) : pendingInvestigations.length === 0 ? (
                    <div className="va-empty">
                      <FileText size={26} style={{ opacity: 0.25, marginBottom: 8 }} />
                      <div>No pending investigations.</div>
                    </div>
                  ) : (
                    pendingInvestigations.map(inv => (
                      <div key={inv.id} className="va-card">
                        <div className="va-card-title">{inv.investigation_name}</div>
                        <div className="va-card-note">
                          Ordered: {inv.date_of_order ? new Date(inv.date_of_order).toLocaleDateString() : '—'}
                          {inv.clinical_indication ? ` · ${inv.clinical_indication}` : ''}
                        </div>
                        {inv.parameters?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {inv.parameters.map((p, i) => (
                              <span key={i} style={{
                                border: `1px solid ${C.border}`, padding: '2px 6px',
                                fontSize: '0.62rem', color: C.textMuted,
                              }}>{p}</span>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                          <label style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '6px 12px', border: `1px solid ${C.border}`,
                            background: C.white, cursor: 'pointer', fontSize: '0.72rem',
                          }}>
                            <UploadCloud size={13} />
                            {investigationFiles[inv.id] ? investigationFiles[inv.id].name.slice(0, 20) : 'Choose File'}
                            <input
                              type="file"
                              style={{ display: 'none' }}
                              onChange={(e) => handlePendingInvestigationFileChange(inv.id, e)}
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            />
                          </label>
                          <button
                            type="button"
                            className="va-hbtn"
                            disabled={uploadingInvestigationId === inv.id}
                            onClick={() => handlePendingInvestigationUpload(inv.id)}
                          >
                            {uploadingInvestigationId === inv.id
                              ? <><Loader size={13} className="va-spin" /> Uploading…</>
                              : <><UploadCloud size={13} /> Upload</>}
                          </button>
                        </div>

                        {investigationMessage?.id === inv.id && (
                          <div style={{
                            marginTop: 8, fontSize: '0.72rem',
                            color: investigationMessage.type === 'success' ? '#2e7d32' : '#c62828',
                          }}>
                            {investigationMessage.text}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}

              {reportStage === 'upload_zone' && (
                <>
                  <div className="va-card">
                    <div className="va-card-title">
                      {reportTiming === 'previous' ? 'Previous report' : 'Current report'}
                      {' · '}
                      {reportCategoryMode === 'with' ? 'With category' : 'Without category'}
                    </div>

                    {!reportFile ? (
                      <label style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        padding: '2.5rem 1.25rem', border: `1.5px dashed ${C.border}`,
                        background: C.bgSecondary, cursor: 'pointer', marginTop: 10,
                      }}>
                        <UploadCloud size={28} style={{ color: C.textMuted, marginBottom: 8 }} />
                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Click to browse or drop a file</span>
                        <span style={{ fontSize: '0.68rem', color: C.textMuted, marginTop: 4 }}>
                          PDF, DOC, JPG, PNG — max 10MB
                        </span>
                        <input
                          type="file"
                          style={{ display: 'none' }}
                          onChange={handleReportFileChange}
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                        />
                      </label>
                    ) : (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
                        padding: '0.75rem 1rem', border: `1px solid ${C.border}`, background: C.bgSecondary,
                      }}>
                        <FileText size={15} style={{ color: C.textMuted }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.8rem', wordBreak: 'break-word' }}>{reportFile.name}</div>
                          <div style={{ fontSize: '0.66rem', color: C.textMuted }}>Ready to upload</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReportFile(null)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {reportMessage && (
                    <div className="va-card">
                      <div className="va-card-note">{reportMessage.text}</div>
                    </div>
                  )}

                  {reportProcessing && (
                    <div className="va-card">
                      <div className="va-card-title">Processing…</div>
                      <div className="va-card-note">
                        {reportProcessStatus?.processed_documents || 0} of{' '}
                        {reportProcessStatus?.total_documents || 0} documents processed.
                      </div>
                    </div>
                  )}
                </>
              )}

              {reportStage === 'done' && (
                <div className="va-card">
                  <CheckCircle size={24} style={{ marginBottom: 8 }} />
                  <div className="va-card-title">Upload complete</div>
                  <div className="va-card-note">You can upload another, or close this panel.</div>
                </div>
              )}
            </PanelShell>
          )}

          {rightPanel === 'consultation' && consultation && (
            <PanelShell
              icon={<Stethoscope size={17} />}
              title="Consultation"
              status={
                consultation.stage === 'generating' ? 'Generating…'
                : consultation.stage === 'saving' ? 'Saving…'
                : consultation.stage === 'generated' ? 'Ready'
                : consultation.stage === 'safedone' ? 'SafeRx done'
                : undefined
              }
            >
              {consultation.showSaveConfirm && (
                <div className="va-card">
                  <div className="va-card-title">Waiting for confirmation</div>
                  <div className="va-card-note">Confirm or cancel saving on the left.</div>
                </div>
              )}

              <div className="va-card">
                <div className="va-section-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Consultation notes (editable)</span>
                  <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
                    {consultation.dictation.length} chars
                  </span>
                </div>
                <textarea
                  className="va-textarea"
                  style={{ minHeight: 170 }}
                  value={consultation.dictation}
                  onChange={(e) => updateConsultationDictation(e.target.value)}
                  placeholder="Dictate or type the consultation notes here (symptoms, investigations, medications…). You can edit at any time."
                  disabled={consultation.stage === 'generating' || consultation.stage === 'saving'}
                />
              </div>

              {(consultation.agenticMedicationData || consultation.medicationData) && (
                <div className="va-card">
                  <div className="va-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Pill size={15} />
                    {consultation.agenticMedicationData ? 'SafeRx Analysis (Agentic)' : 'SafeRx Analysis'}
                  </div>

                  {consultation.agenticMedicationData ? (
                    isAgenticMedLoading ? (
                      <div className="va-empty">
                        <Loader size={22} className="va-spin" style={{ marginBottom: 8 }} />
                        <div>Running agentic medication analysis…</div>
                      </div>
                    ) : (
                      <div className="va-inset">
                        <AgenticMedicationPanel
                          data={agenticMedData || consultation.agenticMedicationData}
                          patientId={currentPatientId}
                          doctorId={doctorId}
                          diagnosisText={''}
                          onSave={(updatedData) => {
                            setAgenticMedData(updatedData);
                            setConsultation(prev => prev ? {
                              ...prev,
                              agenticMedicationData: updatedData,
                            } : prev);
                          }}
                        />
                      </div>
                    )
                  ) : Array.isArray(consultation.medicationData?.prescriptions) ? (
                    <div className="va-inset">
                      <MedicationPanel
                        data={consultation.medicationData}
                        metadata={{ patient_id: currentPatientId, doctor_id: doctorId }}
                        diagnosisText={''}
                        onSave={(p) => {
                          setConsultation(prev => prev ? {
                            ...prev,
                            medicationData: { ...prev.medicationData, prescriptions: p.prescriptions },
                          } : prev);
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      {(consultation.medicationData?.prescriptions || []).map((p, i) => (
                        <div key={i} className="va-rx">
                          <div style={{ fontWeight: 600 }}>{p.medication_name || p.name || `Prescription ${i + 1}`}</div>
                          {p.dosage && <div>Dosage: {p.dosage}</div>}
                          {p.frequency && <div>Frequency: {p.frequency}</div>}
                          {p.duration && <div>Duration: {p.duration}</div>}
                          {Array.isArray(p.safety_alerts) && p.safety_alerts.length > 0 && (
                            <div style={{ fontWeight: 700, marginTop: 4 }}>
                              ⚠ {p.safety_alerts.length} safety alert{p.safety_alerts.length === 1 ? '' : 's'}
                            </div>
                          )}
                        </div>
                      ))}
                      {!consultation.medicationData?.prescriptions?.length && (
                        <div className="va-card-note">No prescriptions detected in the dictation.</div>
                      )}
                    </>
                  )}
                </div>
              )}

              {consultation.documents && (
                <>
                  <div className="va-section-label" style={{ marginTop: 6 }}>Generated documentation (editable)</div>
                  {CONSULTATION_DOC_FEATURES.map(({ id, label }) => {
                    const val = consultation.documents[id];
                    if (val == null) return null;
                    return (
                      <div key={id} className="va-card">
                        <div className="va-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <FileText size={14} /> {label}
                          <span style={{ marginLeft: 'auto', fontSize: '0.66rem', color: C.textMuted, fontWeight: 400, textTransform: 'none' }}>editable</span>
                        </div>
                        {renderConsultationDocument(id, val)}
                      </div>
                    );
                  })}
                </>
              )}

              {(consultation.stage === 'generating' || consultation.stage === 'saving') && (
                <div className="va-empty">
                  <Loader size={22} className="va-spin" style={{ marginBottom: 8 }} />
                  <div>{consultation.stage === 'generating' ? 'Generating documentation…' : 'Saving documentation…'}</div>
                </div>
              )}

              {consultation.error && (
                <div className="va-card">
                  <div className="va-card-note" style={{ fontWeight: 700 }}>Error — {consultation.error}</div>
                </div>
              )}
            </PanelShell>
          )}
        </main>
      </div>

      <style>{`
        .va-root {
          position: fixed; inset: 0; z-index: 1000;
          display: flex; flex-direction: column;
          background: ${C.bgSecondary}; color: ${C.textPrimary};
          font-family: 'Open Sans', sans-serif;
        }
        .va-root *, .va-root *::before, .va-root *::after { box-sizing: border-box; }
        .va-root button { font-family: inherit; }
        .va-root button:focus-visible, .va-root input:focus-visible, .va-root textarea:focus-visible {
          outline: 1px solid ${C.black}; outline-offset: 2px;
        }

        .va-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 24px; background: ${C.bgPrimary}; border-bottom: 1px solid ${C.borderStrong};
          flex-shrink: 0;
        }
        .va-brand { display: flex; align-items: center; gap: 12px; }
        .va-logo {
          width: 36px; height: 36px; background: ${C.black}; color: ${C.white};
          display: flex; align-items: center; justify-content: center;
        }
        .va-title {
          font-size: 0.62rem; font-weight: 400; color: ${C.textMuted};
          text-transform: uppercase; letter-spacing: 0.2em; line-height: 1.2;
        }
        .va-subtitle {
          font-size: 0.86rem; color: ${C.textPrimary}; font-weight: 400;
          display: flex; align-items: center; gap: 6px; margin-top: 4px; letter-spacing: -0.01em;
        }
        .va-dot { width: 7px; height: 7px; border-radius: 50%; background: ${C.border}; border: 1px solid ${C.textMuted}; }
        .va-dot.on { background: ${C.black}; border-color: ${C.black}; box-shadow: 0 0 0 3px rgba(0,0,0,0.08); animation: pulse 1.2s ease-in-out infinite; }
        .va-header-right { display: flex; align-items: center; gap: 10px; }
        .va-patient-chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px;
          background: ${C.black}; color: ${C.white}; font-size: 0.72rem; font-weight: 600;
        }
        .va-patient-chip em { font-style: normal; font-weight: 400; color: #bbbbbb; margin-left: 4px; }
        .va-hbtn {
          display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px;
          border: 1px solid ${C.border}; background: ${C.white}; color: ${C.textSecond};
          font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
          cursor: pointer; transition: background 0.15s, border-color 0.15s;
        }
        .va-hbtn:hover { background: ${C.black}; color: ${C.white}; border-color: ${C.black}; }
        .va-hbtn.icon { padding: 7px 9px; }

        .va-body { flex: 1; display: flex; min-height: 0; }
        .va-left {
          width: 440px; min-width: 380px; flex-shrink: 0; display: flex; flex-direction: column;
          background: ${C.bgPrimary}; border-right: 1px solid ${C.borderStrong}; min-height: 0;
        }
        .va-right { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: ${C.bgSecondary}; }

        .va-level { padding: 10px 18px; background: ${C.bgSecondary}; border-bottom: 1px solid ${C.border}; flex-shrink: 0; }
        .va-level-track { height: 4px; background: ${C.bgTertiary}; overflow: hidden; }
        .va-level-fill { height: 100%; background: ${C.black}; transition: width 0.05s ease; }
        .va-level-meta { display: flex; justify-content: space-between; font-size: 0.64rem; color: ${C.textMuted}; margin-top: 5px; letter-spacing: 0.02em; }
        .va-transcript {
          padding: 9px 18px; background: ${C.bgSecondary}; border-bottom: 1px solid ${C.border};
          font-size: 0.8rem; color: ${C.textPrimary}; font-style: italic; flex-shrink: 0;
        }

        .va-chat { flex: 1; min-height: 120px; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
        .va-msg { display: flex; gap: 8px; align-items: flex-start; }
        .va-msg.user { justify-content: flex-end; text-align: right; }
        .va-avatar {
          width: 24px; height: 24px; background: ${C.black}; color: ${C.white};
          display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;
        }
        .va-bubble {
          display: inline-block; padding: 9px 14px; font-size: 0.83rem;
          line-height: 1.5; word-wrap: break-word; text-align: left;
          background: ${C.bgTertiary}; color: ${C.textPrimary}; border: 1px solid ${C.border};
        }
        .va-msg.user .va-bubble { background: ${C.black}; color: ${C.white}; border-color: ${C.black}; }
        .va-followup { margin-top: 6px; font-size: 0.72rem; color: ${C.textMuted}; font-style: italic; }
        .va-time { font-size: 0.6rem; color: ${C.textMuted}; margin-top: 3px; }
        .va-hint-line { font-size: 0.7rem; color: ${C.textMuted}; margin-top: 6px; }

        .va-sug {
          flex-shrink: 0; max-height: 46%; overflow-y: auto; padding: 12px 16px;
          background: ${C.bgSecondary}; border-top: 1px solid ${C.borderStrong};
        }
        .va-sug-group + .va-sug-group { margin-top: 14px; }
        .va-sug-title {
          font-size: 0.65rem; font-weight: 700; color: ${C.textPrimary}; margin-bottom: 8px;
          display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.15em;
        }
        .va-sug-title svg { color: ${C.textPrimary}; }
        .va-sug-hint { font-size: 0.7rem; color: ${C.textMuted}; margin: -3px 0 8px; line-height: 1.5; }
        .va-sug-grid { display: grid; gap: 8px; }

        .va-sbtn {
          display: flex; align-items: center; gap: 10px; padding: 10px 12px; width: 100%;
          border: 1px solid ${C.border}; background: ${C.white}; color: ${C.textPrimary};
          font-size: 0.78rem; font-weight: 600; text-align: left; cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .va-sbtn:hover:not(:disabled) { border-color: ${C.black}; background: ${C.bgTertiary}; }
        .va-sbtn:disabled { opacity: 0.5; cursor: not-allowed; }
        .va-sbtn-icon { display: flex; flex-shrink: 0; color: ${C.textPrimary}; }
        .va-sbtn-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .va-sbtn-text small { font-size: 0.66rem; font-weight: 400; color: ${C.textMuted}; line-height: 1.35; }
        .va-sbtn.outline { border: 1.5px solid ${C.black}; }
        .va-sbtn.dark { background: ${C.black}; border-color: ${C.black}; color: ${C.white}; }
        .va-sbtn.dark .va-sbtn-icon, .va-sbtn.dark small { color: ${C.white}; }
        .va-sbtn.dark:hover:not(:disabled) { background: #1a1a1a; border-color: #1a1a1a; }

        .va-input-row { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-top: 1px solid ${C.borderStrong}; background: ${C.white}; flex-shrink: 0; }
        .va-input {
          flex: 1; border: 1px solid ${C.border}; padding: 9px 16px;
          font-size: 0.8rem; font-family: inherit; background: ${C.bgSecondary}; color: ${C.textPrimary}; outline: none;
        }
        .va-input:focus { border-color: ${C.black}; background: ${C.white}; }
        .va-send {
          width: 36px; height: 36px; border: none; background: ${C.black}; color: ${C.white};
          display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
        }
        .va-send:disabled { background: ${C.border}; color: ${C.textMuted}; cursor: not-allowed; }

        .va-meta {
          padding: 6px 18px; border-top: 1px solid ${C.border}; display: flex; gap: 14px; flex-wrap: wrap;
          font-size: 0.62rem; color: ${C.textMuted}; background: ${C.bgSecondary}; flex-shrink: 0;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .va-meta-strong { color: ${C.textPrimary}; font-weight: 700; }
        .va-controls {
          padding: 12px 18px; border-top: 1px solid ${C.borderStrong}; display: flex;
          justify-content: space-between; align-items: center; background: ${C.bgSecondary}; flex-shrink: 0;
          gap: 10px;
        }
        .va-mic {
          display: flex; align-items: center; gap: 8px; padding: 9px 26px; border: 1px solid ${C.black};
          background: ${C.black}; color: ${C.white}; font-size: 0.78rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer;
        }
        .va-mic:disabled { opacity: 0.5; cursor: not-allowed; }
        .va-mic.live { background: ${C.white}; color: ${C.black}; }
        .va-clinical-controls { display: flex; gap: 6px; align-items: center; }
        .va-clinical-btn {
          display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
          border: 1px solid ${C.border}; background: ${C.white}; color: ${C.textPrimary};
          font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
          cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .va-clinical-btn:hover { border-color: ${C.black}; }
        .va-clinical-btn.active { background: ${C.black}; color: ${C.white}; border-color: ${C.black}; }
        .va-ctrl {
          padding: 8px 12px; border: 1px solid ${C.border}; background: ${C.white};
          color: ${C.textPrimary}; cursor: pointer; display: flex; align-items: center;
        }
        .va-ctrl:hover:not(:disabled) { border-color: ${C.black}; }
        .va-ctrl:disabled { color: ${C.textMuted}; cursor: not-allowed; }
        .va-error {
          padding: 9px 18px; background: ${C.white}; color: ${C.textPrimary}; font-size: 0.74rem;
          font-weight: 700; border-top: 2px solid ${C.black}; flex-shrink: 0;
        }

        .va-hero {
          flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
          text-align: center; padding: 40px; gap: 6px;
        }
        .va-hero-orb {
          width: 92px; height: 92px; border-radius: 50%; background: ${C.white}; color: ${C.textMuted};
          display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
          border: 1px solid ${C.border};
          transition: transform 0.08s ease, background 0.3s, color 0.3s, border-color 0.3s;
        }
        .va-hero-orb.live { background: ${C.black}; color: ${C.white}; border-color: ${C.black}; }
        .va-hero-label {
          font-size: 0.65rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.25em; margin-bottom: 6px;
        }
        .va-hero h2 { margin: 0; font-size: 1.3rem; font-weight: 400; color: ${C.textPrimary}; letter-spacing: -0.01em; }
        .va-hero p { margin: 8px 0 0; max-width: 460px; font-size: 0.85rem; color: ${C.textMuted}; line-height: 1.6; font-weight: 300; }
        .va-hero-card {
          margin-top: 20px; display: flex; gap: 0; background: ${C.white};
          border: 1px solid ${C.border}; text-align: left;
        }
        .va-hero-card > div { padding: 14px 22px; border-right: 1px solid ${C.border}; }
        .va-hero-card > div:last-child { border-right: none; }
        .va-hero-card span { display: block; font-size: 0.62rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 4px; }
        .va-hero-card b { font-size: 0.85rem; font-weight: 600; color: ${C.textPrimary}; }

        .va-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        .va-panel-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          padding: 16px 28px; background: ${C.bgSecondary}; border-bottom: 1px solid ${C.borderStrong}; flex-shrink: 0;
        }
        .va-panel-label {
          font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.2em; color: ${C.textMuted}; margin-bottom: 2px;
        }
        .va-panel-title { font-size: 1rem; font-weight: 400; color: ${C.textPrimary}; display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
        .va-panel-title svg { color: ${C.textPrimary}; }
        .va-panel-status { font-size: 0.72rem; font-weight: 700; color: ${C.textPrimary}; text-transform: uppercase; letter-spacing: 0.08em; }
        .va-panel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 28px; }
        .va-panel-inner { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }

        .va-card {
          background: ${C.white}; border: 1px solid ${C.border}; padding: 16px 18px;
        }
        .va-card.flush { padding: 14px; }
        .va-card-title { font-size: 0.86rem; font-weight: 600; color: ${C.textPrimary}; margin-bottom: 6px; }
        .va-card-note { font-size: 0.78rem; color: ${C.textSecond}; line-height: 1.6; font-weight: 300; }
        .va-inset { background: ${C.white}; padding: 4px; margin-top: 8px; }
        .va-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
        .va-section-label {
          font-size: 0.68rem; font-weight: 700; color: ${C.textMuted}; margin-bottom: 8px;
          text-transform: uppercase; letter-spacing: 0.15em;
        }
        .va-empty { text-align: center; color: ${C.textMuted}; font-size: 0.82rem; padding: 48px 20px; line-height: 1.7; font-weight: 300; }
        .va-empty-sub { font-size: 0.72rem; margin-top: 6px; }

        .va-appt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 1px; background: ${C.border}; border: 1px solid ${C.border}; }
        .va-appt {
          display: flex; align-items: center; gap: 12px; padding: 14px 16px;
          border: none; background: ${C.white}; cursor: pointer; text-align: left;
          transition: background 0.15s, color 0.15s;
        }
        .va-appt:hover { background: ${C.bgTertiary}; }
        .va-appt.sel { background: ${C.black}; color: ${C.white}; }
        .va-appt-avatar {
          width: 38px; height: 38px; border-radius: 50%; background: ${C.bgTertiary}; color: ${C.textPrimary};
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .va-appt.sel .va-appt-avatar { background: ${C.white}; color: ${C.black}; }
        .va-appt-name { font-size: 0.86rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .va-appt-time { font-size: 0.72rem; color: ${C.textMuted}; margin-top: 2px; }
        .va-appt.sel .va-appt-time { color: #cccccc; }

        .va-vitals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; margin-top: 12px; }
        .va-field { display: flex; flex-direction: column; }
        .va-field label {
          font-size: 0.62rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.1em;
          margin-bottom: 4px; font-weight: 700;
        }
        .va-field input {
          border: 1px solid ${C.border}; padding: 9px 11px; font-size: 0.86rem;
          font-family: inherit; background: ${C.white}; color: ${C.textPrimary}; outline: none;
        }
        .va-field input:focus { border-color: ${C.black}; }

        .va-progress { height: 4px; background: ${C.bgTertiary}; overflow: hidden; margin-top: 8px; }
        .va-progress > div { height: 100%; background: ${C.black}; transition: width 0.25s ease; }
        .va-sec-row {
          display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 6px;
          border: 1px solid ${C.border}; font-size: 0.78rem; text-transform: capitalize; color: ${C.textPrimary};
        }
        .va-sec-row.filled { border-color: ${C.black}; }
        .va-sec-row.pending { border-style: dashed; color: ${C.textMuted}; }

        .va-textarea {
          width: 100%; padding: 12px 14px; border: 1px solid ${C.border};
          font-size: 0.85rem; font-family: inherit; line-height: 1.6; background: ${C.white}; color: ${C.textPrimary};
          resize: vertical; outline: none; min-height: 100px;
        }
        .va-textarea:focus { border-color: ${C.black}; }
        .va-textarea.mono { font-family: monospace; font-size: 0.74rem; background: ${C.bgSecondary}; }
        .va-rx {
          padding: 10px 12px; margin-top: 8px; background: ${C.white}; border: 1px solid ${C.border};
          font-size: 0.78rem; color: ${C.textPrimary}; line-height: 1.5;
        }

        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .va-spin { animation: spin 1s linear infinite; }
        .typing-indicator::after { content: '...'; animation: dots 1.5s steps(4, end) infinite; }
        @keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

        .va-root ::-webkit-scrollbar { width: 6px; height: 6px; }
        .va-root ::-webkit-scrollbar-track { background: transparent; }
        .va-root ::-webkit-scrollbar-thumb { background: ${C.border}; }

        @media (prefers-reduced-motion: reduce) {
          .va-dot.on, .va-spin, .typing-indicator::after { animation: none; }
        }

        @media (max-width: 900px) {
          .va-body { flex-direction: column; }
          .va-left { width: 100%; min-width: 0; height: 60%; border-right: none; border-bottom: 1px solid ${C.borderStrong}; }
          .va-right { height: 40%; }
          .va-header { padding: 10px 14px; }
          .va-hbtn span { display: none; }
          .va-panel-body { padding: 16px; }
          .va-clinical-btn span { display: none; }
        }
      `}</style>
    </div>
  );
};

export default VoiceAssistant;