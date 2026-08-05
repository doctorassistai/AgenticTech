import React, { useState, useEffect, useRef } from 'react';

// --- GLOBAL STYLES ---
const S = {
  sectionHead: { marginBottom: '32px', borderLeft: '4px solid #111', paddingLeft: '24px' },
  h2: { fontSize: '34px', fontWeight: '300', margin: 0, color: '#111' },
  desc: { fontSize: '16px', color: '#5a5a5a', marginTop: '10px', maxWidth: '820px', lineHeight: '1.6' },
  
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', background: '#dcdcdc', border: '1px solid #dcdcdc', marginBottom: '40px' },
  kpi: { background: '#fff', padding: '32px 24px' },
  kl: { fontSize: '14px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#8f8f8f', fontWeight: '600' },
  kv: { fontSize: '52px', fontWeight: '300', marginTop: '16px', color: '#111' },
  kd: { fontSize: '14px', color: '#5a5a5a', marginTop: '12px' },
  
  grid2: { display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1px', background: '#dcdcdc', border: '1px solid #dcdcdc', marginBottom: '32px' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: '#dcdcdc', border: '1px solid #dcdcdc', marginBottom: '32px' },
  panel: { background: '#fff', padding: '22px 24px' },
  panelH3: { fontSize: '13px', fontWeight: '600', letterSpacing: '.3px', margin: 0, color: '#111' },
  panelNote: { fontSize: '10.5px', color: '#8f8f8f', marginTop: '3px', marginBottom: '14px', lineHeight: '1.6' },
  chartBox: { height: '260px', position: 'relative' },
  chartBoxShort: { height: '190px', position: 'relative' },
  
  cardList: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: '#dcdcdc', border: '1px solid #dcdcdc', marginBottom: '32px' },
  rcard: { background: '#fff', padding: '30px 26px' },
  rcTop: { display: 'flex', justifyContent: 'space-between', gap: '10px' },
  rcH4: { fontSize: '18px', fontWeight: '600', margin: 0, color: '#111' },
  rcDesc: { fontSize: '15px', color: '#5a5a5a', lineHeight: '1.6', marginTop: '10px' },
  rcMeta: { display: 'flex', gap: '16px', marginTop: '18px', fontSize: '13px', color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '.5px' },
  
  qlist: { border: '1px solid #dcdcdc', background: '#fff' },
  qrow: { display: 'flex', alignItems: 'center', gap: '20px', padding: '24px 28px', borderBottom: '1px solid #f0f0f0' },
  qname: { flex: 1.4 },
  qt: { fontSize: '18px', fontWeight: '600', color: '#111' },
  qs: { fontSize: '15px', color: '#8f8f8f', marginTop: '6px' },
  qbarWrap: { flex: 2 },
  qbarTrack: { height: '5px', background: '#d8d8d8', position: 'relative' },
  qbarFill: { height: '100%', background: '#111' },
  qbarTarget: { position: 'absolute', top: '-3px', width: '1px', height: '11px', background: '#5a5a5a' },
  qvals: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#8f8f8f', marginTop: '5px' },
  qstatus: { width: '110px', textAlign: 'right', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '600' },
  
  filterRow: { display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center' },
  filterBtn: { border: '1px solid #dcdcdc', padding: '7px 16px', fontSize: '11px', letterSpacing: '.6px', textTransform: 'uppercase', color: '#5a5a5a', background: 'transparent', cursor: 'pointer' },
  filterBtnActive: { borderColor: '#111', color: '#111', fontWeight: '600' },
  
  reportTable: { border: '1px solid #dcdcdc', fontSize: '12px', width: '100%', borderCollapse: 'collapse', background: '#fff' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: '9.5px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#8f8f8f', borderBottom: '1px solid #111', fontWeight: '600', background: '#fff' },
  td: { padding: '13px 16px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top', color: '#5a5a5a' },
  rn: { color: '#111', fontWeight: '600' },
  rdesc: { fontSize: '11.5px', lineHeight: '1.55', maxWidth: '400px' },
  viewBtn: { padding: '4px 12px', border: '1px solid #dcdcdc', background: '#fff', fontSize: '11px', cursor: 'pointer', borderRadius: '2px' }
};

// --- DATA CONFIGURATION ---
const CONFIG = {"deptName": "Medical Oncology", "pageTitle": "Medical Oncology Dashboard", "deptSub": "Systemic therapy planning, treatment monitoring, drug utilization and patient safety analytics", "overview": {"title": "Executive Overview", "desc": "Real-time snapshot of the Medical Oncology service line across active caseload, systemic therapy delivery, drug safety and tumor board throughput.", "kpis": [{"label": "Active Patients on Treatment", "value": "1,842", "unit": "", "note": "up 3.2% vs last month", "dir": "up"}, {"label": "New Registrations (MTD)", "value": "96", "unit": "", "note": "up 5 vs prior month", "dir": "up"}, {"label": "Chemotherapy Cycles (MTD)", "value": "1,340", "unit": "", "note": "on pace with plan", "dir": ""}, {"label": "Infusion Chair Occupancy", "value": "84", "unit": "%", "note": "peak 11:00\u201314:00", "dir": ""}, {"label": "Grade 3\u20134 Toxicity Rate", "value": "6.1", "unit": "%", "note": "within institutional threshold", "dir": ""}, {"label": "ECOG 0\u20131 at Registration", "value": "71", "unit": "", "note": "%", "dir": ""}, {"label": "Protocol Adherence", "value": "93.4", "unit": "", "note": "%", "dir": ""}, {"label": "Diagnosis to Cycle 1", "value": "9.4", "unit": "", "note": "days, avg", "dir": ""}, {"label": "Tumor Board Referral Rate", "value": "41", "unit": "", "note": "%", "dir": ""}, {"label": "30-Day Mortality (on treatment)", "value": "1.8", "unit": "", "note": "%", "dir": "down"}], "chart1": {"title": "Active Caseload by Cancer Type", "note": "Current active patients under systemic therapy, grouped by primary site.", "type": "bar", "labels": ["Breast", "Lung", "Head & Neck", "Gastrointestinal", "Gynaecological", "Hematologic", "Others"], "datasets": [{"label": "Active Patients", "data": [486, 312, 268, 354, 201, 142, 79]}]}, "chart2": {"title": "Chemotherapy Cycles Delivered \u2014 6 Month Trend", "note": "Monthly cycle volume across all regimens.", "type": "line", "labels": ["Feb", "Mar", "Apr", "May", "Jun", "Jul"], "datasets": [{"label": "Cycles", "data": [1120, 1185, 1240, 1268, 1301, 1340]}]}, "mini": [{"title": "Drug Utilization \u2014 Top Regimens", "note": "Share of cycles by regimen, current month.", "type": "doughnut", "labels": ["AC-T", "FOLFOX/FOLFIRI", "Carbo-Paclitaxel", "R-CHOP", "Immunotherapy", "Other"], "datasets": [{"data": [22, 19, 17, 12, 14, 16]}]}, {"title": "ECOG Performance Status", "note": "Distribution at last assessment.", "type": "bar", "labels": ["ECOG 0", "ECOG 1", "ECOG 2", "ECOG 3", "ECOG 4"], "datasets": [{"data": [38, 33, 18, 8, 3]}]}, {"title": "CTCAE Toxicity Grade", "note": "All active patients, worst grade this cycle.", "type": "bar", "labels": ["Grade 1", "Grade 2", "Grade 3", "Grade 4"], "datasets": [{"data": [41, 29, 22, 8]}]}]}, "clinicalDesc": "Reports supporting day-to-day systemic therapy planning, treatment monitoring, toxicity surveillance and care coordination for patients under medical oncology.", "researchDesc": "Reports supporting clinical trial conduct, translational research, biobanking and academic output for the medical oncology service.", "adminDesc": "Reports supporting capacity planning, drug economics, staffing, billing and accreditation for the medical oncology service.", "qualityDesc": "Indicators tracked against internal and NABH/accreditation benchmarks for safety and treatment quality in medical oncology.", "quality": [{"name": "Chemotherapy Order Verification Compliance", "desc": "Independent pharmacist verification prior to dispensing", "value": 98.6, "target": 100, "max": 100, "status": "On Track", "unit": "%"}, {"name": "Extravasation Incidents", "desc": "Per 1,000 vesicant infusions", "value": 0.4, "target": 1, "max": 5, "status": "On Track", "unit": ""}, {"name": "Time to Treatment Initiation", "desc": "Diagnosis confirmation to Cycle 1, days", "value": 12.8, "target": 14, "max": 30, "status": "On Track", "unit": " d"}, {"name": "Protocol Deviation Rate", "desc": "Dose/schedule deviations from planned regimen", "value": 4.1, "target": 5, "max": 20, "status": "On Track", "unit": "%"}, {"name": "Febrile Neutropenia Admission Rate", "desc": "Unplanned admissions for FN post-chemotherapy", "value": 8.7, "target": 10, "max": 25, "status": "Watch", "unit": "%"}, {"name": "Unplanned 30-Day Readmission", "desc": "All-cause readmission after systemic therapy", "value": 13.4, "target": 12, "max": 30, "status": "Watch", "unit": "%"}, {"name": "Patient-Reported Outcome Completion", "desc": "PRO-CTCAE forms completed per visit", "value": 74, "target": 80, "max": 100, "status": "Watch", "unit": "%"}], "reports": [{"name": "Daily Active Patient Census by Cancer Type & Stage", "cat": "clinical", "desc": "Live roll-up of all patients currently on systemic therapy, segmented by primary site, stage and treatment line.", "freq": "Daily", "audience": "Treating Oncologists \u00b7 Nursing", "format": "Dashboard"}, {"name": "Chemotherapy Cycle & Regimen Tracker", "cat": "clinical", "desc": "Cycle number, day, dose calculation, dose modifications and delays for every patient on an active protocol.", "freq": "Real-time", "audience": "Oncologists \u00b7 Pharmacy", "format": "System / PDF"}, {"name": "Treatment Response Summary (RECIST 1.1)", "cat": "clinical", "desc": "Structured comparison of target and non-target lesions across restaging imaging to classify response category.", "freq": "Per restaging scan", "audience": "Oncologists \u00b7 Tumor Board", "format": "Structured Report"}, {"name": "CTCAE Toxicity & Adverse Event Log", "cat": "clinical", "desc": "Graded adverse events captured at each visit, mapped to CTCAE v5.0 terminology for trend and causality review.", "freq": "Per visit", "audience": "Oncologists \u00b7 Nursing \u00b7 Pharmacovigilance", "format": "System / Excel"}, {"name": "ECOG / Karnofsky Performance Status Trend", "cat": "clinical", "desc": "Longitudinal functional status tracking used for treatment eligibility and dose-intensity decisions.", "freq": "Per visit", "audience": "Oncologists", "format": "Dashboard"}, {"name": "Pre-Cycle Laboratory Trend (CBC, LFT, RFT)", "cat": "clinical", "desc": "Haematology and biochemistry trend required to clear each cycle, flagged against regimen-specific thresholds.", "freq": "Per cycle", "audience": "Oncologists \u00b7 Pharmacy", "format": "Lab System Export"}, {"name": "Infusion Chair Scheduling & Occupancy", "cat": "clinical", "desc": "Live day-care chair allocation, wait times and same-day capacity across the infusion suite.", "freq": "Real-time / Daily", "audience": "Day Care Nursing", "format": "Dashboard"}, {"name": "Febrile Neutropenia & Admission Log", "cat": "clinical", "desc": "Case-wise record of neutropenic fever admissions, causative regimen and growth-factor prophylaxis status.", "freq": "Weekly", "audience": "Oncologists \u00b7 Infection Control", "format": "Report"}, {"name": "Tumor Board (MDT) Referral & Outcome Log", "cat": "clinical", "desc": "Cases referred for multidisciplinary discussion, consensus decision and time-to-decision.", "freq": "Weekly", "audience": "MDT Coordinator", "format": "Report"}, {"name": "Survivorship & Follow-up Compliance Register", "cat": "clinical", "desc": "Post-treatment surveillance schedule adherence and late-effect screening for completed patients.", "freq": "Monthly", "audience": "Oncologists \u00b7 Follow-up Clinic", "format": "Report"}, {"name": "Clinical Trial Screening & Enrollment Log", "cat": "research", "desc": "Screen-failure reasons, eligibility checklist status and enrollment funnel for all open interventional studies.", "freq": "Weekly", "audience": "Principal Investigator \u00b7 Research Coordinator", "format": "CTMS Export"}, {"name": "Protocol Deviation & SAE Reporting Register", "cat": "research", "desc": "Serious adverse events and protocol deviations logged for expedited and periodic regulatory reporting.", "freq": "As occurring / Monthly summary", "audience": "PI \u00b7 Ethics Committee", "format": "Regulatory Report"}, {"name": "Biobank Sample Collection & Inventory", "cat": "research", "desc": "Tumor, blood and plasma sample accession, storage location and consent linkage for the research biobank.", "freq": "Weekly", "audience": "Research Lab \u00b7 Biobank Custodian", "format": "LIMS Export"}, {"name": "Molecular & Genomic Testing Turnaround Tracker", "cat": "research", "desc": "Time from sample dispatch to actionable NGS/IHC/molecular result for treatment-relevant biomarkers.", "freq": "Weekly", "audience": "Oncologists \u00b7 Molecular Lab", "format": "Dashboard"}, {"name": "Investigator-Initiated Study Progress Report", "cat": "research", "desc": "Milestone tracking for locally sponsored studies including recruitment, data lock and interim analysis status.", "freq": "Monthly", "audience": "PI \u00b7 Institutional Review Board", "format": "Report"}, {"name": "Publication & Conference Abstract Tracker", "cat": "research", "desc": "Manuscripts, abstracts and posters in preparation, submission or acceptance across the department.", "freq": "Quarterly", "audience": "Academic Committee", "format": "Register"}, {"name": "Trial Recruitment vs Target Accrual", "cat": "research", "desc": "Cumulative enrollment against protocol-specified accrual targets and timelines, by study.", "freq": "Monthly", "audience": "PI \u00b7 Sponsor", "format": "Dashboard"}, {"name": "Long-Term Survival & Outcomes Registry", "cat": "research", "desc": "Institutional cancer registry linkage providing overall and progression-free survival by cohort.", "freq": "Annual", "audience": "Tumor Registry \u00b7 Oncologists", "format": "Registry Export"}, {"name": "Research Grant & Funding Utilization Report", "cat": "research", "desc": "Budget utilization against sanctioned research grants and sponsor-funded trial milestones.", "freq": "Quarterly", "audience": "PI \u00b7 Finance", "format": "Report"}, {"name": "Day-Care & Bed Occupancy Report", "cat": "admin", "desc": "Occupancy and turnover across day-care chairs and inpatient oncology beds.", "freq": "Daily", "audience": "Nursing Superintendent \u00b7 Administration", "format": "Dashboard"}, {"name": "Cost per Chemotherapy Cycle Analysis", "cat": "admin", "desc": "Drug, consumable and overhead cost breakdown per cycle, benchmarked by regimen.", "freq": "Monthly", "audience": "Finance \u00b7 Administration", "format": "Report"}, {"name": "Chemotherapy Drug Inventory & Expiry Alert", "cat": "admin", "desc": "Stock levels, reorder points and expiry alerts for cytotoxic and targeted agents.", "freq": "Daily", "audience": "Pharmacy", "format": "System Alert"}, {"name": "Insurance / TPA Claim Status Tracker", "cat": "admin", "desc": "Pre-authorization, submission and settlement status of insurance and scheme-based claims.", "freq": "Daily", "audience": "Billing \u00b7 Insurance Desk", "format": "Dashboard"}, {"name": "Oncologist & Nursing Staffing Roster", "cat": "admin", "desc": "Duty roster, leave planning and coverage adequacy across consultants and infusion nursing staff.", "freq": "Weekly", "audience": "HR \u00b7 Nursing Superintendent", "format": "Roster"}, {"name": "Patient Satisfaction & Experience Survey", "cat": "admin", "desc": "Structured feedback on wait times, communication and infusion suite experience.", "freq": "Monthly", "audience": "Quality Cell", "format": "Survey Report"}, {"name": "Revenue & Billing Summary", "cat": "admin", "desc": "Departmental revenue, package utilization and outstanding dues for medical oncology services.", "freq": "Monthly", "audience": "Finance", "format": "Report"}, {"name": "NABH / Accreditation Compliance Checklist", "cat": "admin", "desc": "Standards checklist covering medication safety, documentation and infection control for accreditation surveys.", "freq": "Quarterly", "audience": "Quality Cell", "format": "Checklist"}, {"name": "Consumables & Supportive Care Drug Utilization", "cat": "admin", "desc": "Antiemetics, growth factors and supportive medication consumption trend.", "freq": "Weekly", "audience": "Pharmacy \u00b7 Stores", "format": "Report"}]};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'clinical', label: 'Clinical & Patient Care' },
  { id: 'research', label: 'Research & Academic' },
  { id: 'admin', label: 'Administrative & Operations' },
  { id: 'quality', label: 'Quality & Safety' },
  { id: 'library', label: 'Reports Library' }
];

// --- CHART COMPONENT ---
const GREYS = ['#111111','#4a4a4a','#767676','#9c9c9c','#bdbdbd','#d8d8d8','#e8e8e8'];

function ChartCanvas({ type, labels, datasets, opts }) {
  const canvasRef = useRef(null);
  const chartInstance = useRef(null);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    const checkChart = setInterval(() => {
      if (window.Chart) {
        setChartReady(true);
        clearInterval(checkChart);
      }
    }, 100);
    return () => clearInterval(checkChart);
  }, []);

  useEffect(() => {
    if (!chartReady || !canvasRef.current) return;
    
    // Destroy existing chart if React re-renders
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ds = datasets.map((d, i) => ({
      label: d.label, 
      data: d.data,
      backgroundColor: type === 'line' ? 'rgba(0,0,0,0.04)' : GREYS[i % GREYS.length],
      borderColor: type === 'line' ? (GREYS[i % GREYS.length]) : '#ffffff',
      borderWidth: type === 'line' ? 2 : 1,
      fill: type === 'line' ? (i === 0) : false,
      tension: 0.35, 
      pointRadius: type === 'line' ? 2 : 0,
      cutout: type === 'doughnut' ? '68%' : undefined
    }));

    try {
      chartInstance.current = new window.Chart(canvasRef.current, {
        type, 
        data: { labels, datasets: ds },
        options: Object.assign({
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: datasets.length > 1 || type === 'doughnut', position: 'bottom', labels: { boxWidth: 10, font: { family: 'Open Sans', weight: 300, size: 10.5 }, color: '#5a5a5a' } },
            tooltip: { backgroundColor: '#111', titleFont: { family: 'Open Sans' }, bodyFont: { family: 'Open Sans' } }
          },
          scales: type === 'doughnut' ? {} : {
            x: { grid: { color: '#f0f0f0' }, ticks: { font: { family: 'Open Sans', size: 10.5 }, color: '#8f8f8f' } },
            y: { grid: { color: '#f0f0f0' }, ticks: { font: { family: 'Open Sans', size: 10.5 }, color: '#8f8f8f' }, beginAtZero: true }
          }
        }, opts || {})
      });
    } catch (e) {
      console.error("Chart.js failed to initialize:", e);
    }
  }, [labels, datasets, type, opts, chartReady]);

  useEffect(() => {
    return () => {
      if (chartInstance.current) chartInstance.current.destroy();
    };
  }, []);

  if (!chartReady) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8f8f8f', fontSize: '12px', background: '#f9f9f9' }}>Loading chart engine...</div>;
  }

  if (!datasets || datasets.length === 0 || !datasets[0].data || datasets[0].data.length === 0) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8f8f8f', fontSize: '12px', background: '#f9f9f9' }}>No data to display</div>;
  }

  return <canvas ref={canvasRef}></canvas>;
}


// --- TAB COMPONENTS ---
function OverviewTab({ data, error }) {
  if (error) {
    return (
      <div style={{ padding: '40px', background: '#ffebee', color: '#c62828', borderRadius: '4px', border: '1px solid #ef9a9a' }}>
        <h3 style={{ marginTop: 0 }}>Backend API Connection Failed</h3>
        <p><strong>Error:</strong> {error}</p>
        <p>It looks like the new endpoint (<code>/get-medical-oncology-dashboard</code>) is returning a 404 Not Found error.</p>
        <p><strong>Please ensure you have RESTARTED your Python FastAPI backend server</strong> so that it loads the latest changes we made to <code>patientcontext.py</code>.</p>
      </div>
    );
  }
  
  if (!data) return <div style={{ padding: '40px' }}>Loading overview data... (Waiting for Backend)</div>;
  
  return (
    <div>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>{data.title}</h2>
        <p style={S.desc}>{data.desc}</p>
      </div>

      {/* KPI Grid */}
      <div style={S.kpiGrid}>
        {data.kpis.map((k, idx) => (
          <div key={idx} style={S.kpi}>
            <div style={S.kl}>{k.label}</div>
            <div style={S.kv}>
              {k.value}
              {k.unit && <sup style={{ fontSize: '13px', fontWeight: '400', marginLeft: '2px' }}>{k.unit}</sup>}
            </div>
            <div style={S.kd}>
              {k.dir === 'up' ? '▲ ' : k.dir === 'down' ? '▼ ' : ''}
              {k.note}
            </div>
          </div>
        ))}
      </div>

      {/* Main Charts */}
      <div style={S.grid2}>
        <div style={S.panel}>
          <h3 style={S.panelH3}>{data.chart1.title}</h3>
          <div style={S.panelNote}>{data.chart1.note}</div>
          <div style={S.chartBox}>
            <ChartCanvas type={data.chart1.type} labels={data.chart1.labels} datasets={data.chart1.datasets} />
          </div>
        </div>
        <div style={S.panel}>
          <h3 style={S.panelH3}>{data.chart2.title}</h3>
          <div style={S.panelNote}>{data.chart2.note}</div>
          <div style={S.chartBox}>
            <ChartCanvas type={data.chart2.type} labels={data.chart2.labels} datasets={data.chart2.datasets} />
          </div>
        </div>
      </div>

      {/* Mini Charts */}
      <div style={S.grid3}>
        {data.mini.map((m, idx) => (
          <div key={idx} style={S.panel}>
            <h3 style={S.panelH3}>{m.title}</h3>
            <div style={S.panelNote}>{m.note}</div>
            <div style={S.chartBoxShort}>
              <ChartCanvas type={m.type} labels={m.labels} datasets={m.datasets} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// --- DAILY ACTIVE PATIENTS TAB ---
function PatientTableRow({ p, doctorId }) {
  const [appointmentDate, setAppointmentDate] = useState(p.latestAppointment);

  useEffect(() => {
    if (!p.patientId || !doctorId) return;
    
    // Fetch real latest appointment from backend
    fetch(`${API_BASE_URL}hms/users/data/context/get-patient-last-appointment?patient_id=${p.patientId}&doctor_id=${doctorId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.last_appointment && data.last_appointment.updated_at) {
          const dateStr = data.last_appointment.updated_at.substring(0, 10);
          console.log(`Successfully fetched latest appointment for ${p.name} from /get-patient-last-appointment:`, dateStr);
          setAppointmentDate(dateStr);
        } else {
          console.log(`No new appointment found for ${p.name}, falling back to chemo record date.`);
        }
      })
      .catch(err => console.error("Error fetching appointment for", p.patientId, err));
  }, [p.patientId, doctorId]);

  return (
    <tr style={{ backgroundColor: '#fff' }}>
      <td style={S.td}><strong>{p.name}</strong><br/><span style={{ fontSize: '10px', color: '#8f8f8f' }}>{p.patientId}</span></td>
      <td style={S.td}>{p.age}</td>
      <td style={S.td}>{p.gender}</td>
      <td style={S.td}>{appointmentDate}</td>
      <td style={S.td}>
        {p.treatmentStatus}
      </td>
      <td style={S.td}>{p.cyclesCompleted}</td>
    </tr>
  );
}

function DailyActivePatientsTab({ patients, doctorId }) {
  if (!patients) return <div style={{ padding: '40px' }}>Loading patient data... (Waiting for Backend)</div>;

  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  let totalCycles = 0;

  patients.forEach(p => {
    const status = (p.treatmentStatus || '').toLowerCase();
    if (status === 'pending') pending++;
    else if (status.includes('completed')) completed++;
    else inProgress++;

    totalCycles += parseInt(p.cyclesCompleted) || 0;
  });

  const kpiCellStyle = { padding: '24px 20px', borderRight: '1px solid #dcdcdc' };
  const kpiTitleStyle = { fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: '#8f8f8f', fontWeight: '600', marginBottom: '16px' };
  const kpiValStyle = { fontSize: '32px', fontWeight: '300', color: '#111', marginBottom: '16px' };
  const kpiSubStyle = { fontSize: '11px', color: '#8f8f8f' };

  return (
    <div>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>Daily Active Patients</h2>
        <p style={S.desc}>Live roll-up of all patients currently on systemic therapy.</p>
      </div>

      {/* SUMMARY KPIS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', border: '1px solid #dcdcdc', background: '#fff', marginBottom: '32px' }}>
        <div style={kpiCellStyle}>
          <div style={kpiTitleStyle}>Total Patients</div>
          <div style={kpiValStyle}>{patients.length}</div>
          <div style={kpiSubStyle}>All active profiles</div>
        </div>
        <div style={kpiCellStyle}>
          <div style={kpiTitleStyle}>Pending Treatment</div>
          <div style={kpiValStyle}>{pending}</div>
          <div style={kpiSubStyle}>Awaiting next steps</div>
        </div>
        <div style={kpiCellStyle}>
          <div style={kpiTitleStyle}>In Progress</div>
          <div style={kpiValStyle}>{inProgress}</div>
          <div style={kpiSubStyle}>Currently undergoing treatment</div>
        </div>
        <div style={kpiCellStyle}>
          <div style={kpiTitleStyle}>Treatment Completed</div>
          <div style={kpiValStyle}>{completed}</div>
          <div style={kpiSubStyle}>Finished protocols</div>
        </div>
        <div style={{ ...kpiCellStyle, borderRight: 'none' }}>
          <div style={kpiTitleStyle}>Total Cycles</div>
          <div style={kpiValStyle}>{totalCycles}</div>
          <div style={kpiSubStyle}>Across all patients</div>
        </div>
      </div>

      <div style={{ border: '1px solid #dcdcdc', background: '#fff' }}>
        <div style={{ overflowY: 'auto', maxHeight: '500px' }}>
          <table style={{ ...S.reportTable, border: 'none' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', boxShadow: '0 1px 0 #dcdcdc' }}>
              <tr>
                <th style={S.th}>Patient Name</th>
                <th style={S.th}>Age</th>
                <th style={S.th}>Gender</th>
                <th style={S.th}>Latest Appointment</th>
                <th style={S.th}>Treatment</th>
                <th style={S.th}>Cycles Completed</th>
              </tr>
            </thead>
            <tbody>
              {patients.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ ...S.td, textAlign: 'center', padding: '40px' }}>No active patients found.</td>
                </tr>
              ) : (
                patients.map((p, idx) => (
                  <PatientTableRow key={idx} p={p} doctorId={doctorId} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// --- CARD LIST COMPONENT ---
function CardList({ tabId }) {
  const reports = CONFIG.reports.filter(r => r.cat === tabId);
  const descKey = tabId + 'Desc';
  const desc = CONFIG[descKey] || '';
  const title = TABS.find(t => t.id === tabId)?.label || '';

  return (
    <div>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>{title}</h2>
        <p style={S.desc}>{desc}</p>
      </div>
      <div style={S.cardList}>
        {reports.map((r, idx) => (
          <div key={idx} style={S.rcard}>
            <div style={S.rcTop}>
              <h4 style={S.rcH4}>{r.name}</h4>
            </div>
            <div style={S.rcDesc}>{r.desc}</div>
            <div style={S.rcMeta}>
              <span>{r.freq}</span>
              <span>{r.audience}</span>
              <span>{r.format}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- QUALITY LIST COMPONENT ---
function QualityList() {
  const items = CONFIG.quality || [];
  const title = TABS.find(t => t.id === 'quality')?.label || '';
  const desc = CONFIG.qualityDesc || '';

  return (
    <div>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>{title}</h2>
        <p style={S.desc}>{desc}</p>
      </div>
      <div style={S.qlist}>
        {items.map((q, idx) => {
          const pct = Math.min(100, Math.round((q.value / q.max) * 100));
          const tpct = Math.min(100, Math.round((q.target / q.max) * 100));
          return (
            <div key={idx} style={{ ...S.qrow, borderBottom: idx === items.length - 1 ? 'none' : S.qrow.borderBottom }}>
              <div style={S.qname}>
                <div style={S.qt}>{q.name}</div>
                <div style={S.qs}>{q.desc}</div>
              </div>
              <div style={S.qbarWrap}>
                <div style={S.qbarTrack}>
                  <div style={{ ...S.qbarFill, width: `${pct}%` }}></div>
                  <div style={{ ...S.qbarTarget, left: `${tpct}%` }}></div>
                </div>
                <div style={S.qvals}>
                  <span>{q.value}{q.unit || ''}</span>
                  <span>Target {q.target}{q.unit || ''}</span>
                </div>
              </div>
              <div style={{ ...S.qstatus, color: q.status === 'Watch' ? '#c44545' : '#111' }}>
                {q.status}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- REPORTS LIBRARY COMPONENT ---
function ReportsLibrary() {
  const [filter, setFilter] = useState('all');
  const allReports = CONFIG.reports || [];
  
  const counts = { all: allReports.length, clinical: 0, research: 0, admin: 0 };
  allReports.forEach(r => counts[r.cat]++);

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'clinical', label: 'Clinical' },
    { id: 'research', label: 'Research' },
    { id: 'admin', label: 'Admin' }
  ];

  const visibleReports = filter === 'all' ? allReports : allReports.filter(r => r.cat === filter);
  const title = TABS.find(t => t.id === 'library')?.label || '';
  const desc = "Comprehensive directory of all system-generated and ad-hoc reports available to the Medical Oncology department.";

  return (
    <div>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>{title}</h2>
        <p style={S.desc}>{desc}</p>
      </div>
      
      <div style={S.filterRow}>
        {filters.map(f => (
          <button 
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{ ...S.filterBtn, ...(filter === f.id ? S.filterBtnActive : {}) }}
          >
            {f.label} ({counts[f.id]})
          </button>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={S.reportTable}>
          <thead>
            <tr>
              <th style={S.th}>Report Name / Description</th>
              <th style={{ ...S.th, width: '120px' }}>Frequency</th>
              <th style={{ ...S.th, width: '150px' }}>Primary Audience</th>
              <th style={{ ...S.th, width: '120px' }}>Format</th>
              <th style={{ ...S.th, width: '60px' }}></th>
            </tr>
          </thead>
          <tbody>
            {visibleReports.map((r, idx) => (
              <tr key={idx} style={{ backgroundColor: '#fff' }}>
                <td style={{ ...S.td, borderBottom: idx === visibleReports.length - 1 ? 'none' : S.td.borderBottom }}>
                  <div style={S.rn}>{r.name}</div>
                  <div style={S.rdesc}>{r.desc}</div>
                </td>
                <td style={{ ...S.td, borderBottom: idx === visibleReports.length - 1 ? 'none' : S.td.borderBottom }}>{r.freq}</td>
                <td style={{ ...S.td, borderBottom: idx === visibleReports.length - 1 ? 'none' : S.td.borderBottom }}>{r.audience}</td>
                <td style={{ ...S.td, borderBottom: idx === visibleReports.length - 1 ? 'none' : S.td.borderBottom }}>{r.format}</td>
                <td style={{ ...S.td, textAlign: 'right', borderBottom: idx === visibleReports.length - 1 ? 'none' : S.td.borderBottom }}>
                  <button style={S.viewBtn}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// --- MAIN DASHBOARD COMPONENT ---
export default function MedicalOncologyDashboard({ doctorId }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [overviewData, setOverviewData] = useState(null); // Show loading state initially, not mock data
  const [clinicalPatients, setClinicalPatients] = useState(null); // Patient list from backend
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState(null);

  // Fetch live dashboard data
  useEffect(() => {
    if (!doctorId) {
      console.warn("MedicalOncologyDashboard: No doctorId provided. Ensure it is passed as a prop from doctordashboard.jsx");
      return;
    }
    
    setIsLoading(true);
    const endpoint = `${API_BASE_URL}hms/users/data/context/get-medical-oncology-dashboard?doctorId=${doctorId}`;
    console.log("Fetching live dashboard data from:", endpoint);

    fetch(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Server returned ${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        console.log("Dashboard API Response:", data);
        if (data.status === 'success' && data.overview) {
          setOverviewData(data.overview);
          if (data.patients) {
            setClinicalPatients(data.patients);
          }
          setApiError(null);
        } else {
          setApiError("API responded, but did not return 'success' status.");
          console.error("Dashboard API returned unsuccessful status:", data);
        }
      })
      .catch(err => {
        console.error("Error fetching medical oncology dashboard data:", err);
        setApiError(err.message);
      })
      .finally(() => setIsLoading(false));
  }, [doctorId]);

  // Load Chart.js script dynamically if it doesn't exist
  useEffect(() => {
    if (!window.Chart) {
      const script = document.createElement('script');
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div style={{ marginTop: '2rem', borderTop: '2px solid #eee', paddingTop: '1rem', fontFamily: "'Open Sans', sans-serif" }}>
      
      {/* --- Tab Navigation Bar --- */}
      <div style={{ padding: '24px 0 0' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', color: '#111', margin: '0 0 32px 0' }}>
          {CONFIG.pageTitle}
        </h1>
        <div style={{
          display: 'flex', gap: 0, borderBottom: '1px solid #dcdcdc',
          overflowX: 'auto', background: '#fff', position: 'sticky', top: 0, zIndex: 40
        }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '16px 24px',
                  fontSize: '15px',
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: `3px solid ${isActive ? '#111' : 'transparent'}`,
                  color: isActive ? '#111' : '#8f8f8f',
                  fontWeight: isActive ? '600' : '400',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'color 0.15s, border-color 0.15s'
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      
      {/* TAB CONTENT AREA */}
      <div style={{ padding: '40px 0 80px', position: 'relative' }}>
        {isLoading && (
          <div style={{ position: 'absolute', top: '20px', right: '20px', background: '#333', color: '#fff', padding: '8px 16px', fontSize: '12px', borderRadius: '4px' }}>
            Fetching Live Dashboard Data...
          </div>
        )}
        
        {activeTab === 'overview' && <OverviewTab data={overviewData} error={apiError} />}
        
        {activeTab === 'clinical' && <DailyActivePatientsTab patients={clinicalPatients} doctorId={doctorId} />}
        
        {['research', 'admin'].includes(activeTab) && (
          <CardList tabId={activeTab} />
        )}
        
        {activeTab === 'quality' && <QualityList />}
        
        {activeTab === 'library' && <ReportsLibrary />}
      </div>
      
    </div>
  );
}
