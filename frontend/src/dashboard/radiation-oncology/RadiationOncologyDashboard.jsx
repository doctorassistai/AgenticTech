import React, { useState, useEffect } from "react";

/* ============================================================================
 * Radiation Oncology Dashboard
 * Ported from Radiation_Oncology_Dashboard.html. The Overview KPIs/charts and
 * the Quality & Safety indicators are fetched live from the backend
 * (aggregated across the doctor's RT patients); CONFIG below supplies the
 * static report catalogue (Clinical/Research/Admin/Library) plus fallback
 * defaults used while loading or if the fetch fails.
 * ==========================================================================*/

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const CONFIG = {
  deptName: "Radiation Oncology",
  pageTitle: "Radiation Oncology Dashboard",
  deptSub:
    "LINAC utilization, fractionation tracking, treatment safety and radiation protection analytics",
  overview: {
    title: "Executive Overview",
    desc: "Real-time snapshot of the Radiation Oncology service across machine utilization, fractionation delivery, toxicity and safety compliance.",
    kpis: [
      { label: "Patients on Active RT", value: "412", unit: "", note: "up 2.1% vs last month", dir: "up" },
      { label: "New RT Starts (MTD)", value: "58", unit: "", note: "", dir: "" },
      { label: "Average LINAC Utilization", value: "87", unit: "%", note: "across all units", dir: "" },
      { label: "Fractions Delivered (MTD)", value: "3,180", unit: "", note: "", dir: "" },
      { label: "Fraction Completion Rate", value: "96.2", unit: "", note: "%", dir: "" },
      { label: "Simulation to First Fraction", value: "6.8", unit: "", note: "days, avg", dir: "" },
      { label: "Machine Downtime (This Month)", value: "14", unit: "", note: "hours", dir: "down" },
      { label: "Re-treatment / Replan Rate", value: "3.4", unit: "", note: "%", dir: "" },
      { label: "Grade ≥2 Acute Skin Toxicity", value: "11", unit: "", note: "%", dir: "" },
      { label: "Brachytherapy Sessions (MTD)", value: "96", unit: "", note: "", dir: "" },
    ],
    chart1: {
      title: "Machine Utilization by Unit",
      note: "Treatment hours used as a share of available treatment hours.",
      type: "bar",
      labels: ["LINAC 1", "LINAC 2", "Brachytherapy", "Cyberknife", "CT-Simulator"],
      datasets: [{ label: "Utilization %", data: [91, 86, 78, 82, 74] }],
    },
    chart2: {
      title: "Fractions Delivered — 6 Month Trend",
      note: "Monthly fraction throughput across all modalities.",
      type: "line",
      labels: ["Feb", "Mar", "Apr", "May", "Jun", "Jul"],
      datasets: [{ label: "Fractions", data: [2820, 2910, 3040, 3095, 3140, 3180] }],
    },
    mini: [
      {
        title: "Fractionation Schedule Mix",
        note: "Share of active plans by regimen type.",
        type: "doughnut",
        labels: ["Conventional", "Hypofractionated", "SBRT / SRS", "Palliative"],
        datasets: [{ data: [38, 29, 17, 16] }],
      },
      {
        title: "Acute Toxicity Grade",
        note: "RTOG/CTCAE grading, current on-treatment review.",
        type: "bar",
        labels: ["Grade 0", "Grade 1", "Grade 2", "Grade 3"],
        datasets: [{ data: [22, 45, 26, 7] }],
      },
      {
        title: "Treatment Site Distribution",
        note: "Active plans by anatomical site.",
        type: "bar",
        labels: ["Breast", "Head & Neck", "Prostate", "GI", "CNS", "Gynae", "Palliative"],
        datasets: [{ data: [112, 86, 64, 58, 41, 33, 18] }],
      },
    ],
  },
  clinicalDesc:
    "Reports supporting daily treatment scheduling, dose delivery accuracy, toxicity surveillance and on-treatment review for radiotherapy patients.",
  researchDesc:
    "Reports supporting radiotherapy clinical trials, dosimetric research, outcome registries and academic output.",
  adminDesc:
    "Reports supporting machine capacity planning, radiation safety compliance, staffing and cost management.",
  qualityDesc:
    "Indicators tracked against AERB radiation-safety requirements and institutional treatment-quality benchmarks.",
  quality: [
    { name: "Machine QA Pass Rate", desc: "Daily/monthly quality assurance checks passed on first attempt", value: 99.1, target: 100, max: 100, status: "On Track", unit: "%" },
    { name: "Time to First Fraction — Urgent/Palliative", desc: "Emergent and palliative cases started within target window", value: 1.6, target: 2, max: 10, status: "On Track", unit: " d" },
    { name: "Plan / Chart Peer-Review Completion", desc: "Independent peer review completed before first fraction", value: 92, target: 100, max: 100, status: "Watch", unit: "%" },
    { name: "Treatment Interruption Rate", desc: "Courses with an unplanned gap exceeding 2 days", value: 4.3, target: 5, max: 20, status: "On Track", unit: "%" },
    { name: "Radiation Safety Incident/Near-Miss Reporting", desc: "Major dosimetric incidents reported this quarter", value: 0, target: 0, max: 5, status: "On Track", unit: "" },
    { name: "Re-simulation Rate", desc: "Repeat CT-simulation due to anatomical change or setup error", value: 2.6, target: 3, max: 10, status: "On Track", unit: "%" },
  ],
  reports: [
    { name: "Daily RT Treatment Schedule & Machine Allocation", cat: "clinical", desc: "Per-machine treatment slot list with patient, site, fraction number and special setup requirements.", freq: "Daily", audience: "RTTs · Radiation Oncologists", format: "Dashboard" },
    { name: "Fractionation & Dose Delivery Tracker", cat: "clinical", desc: "Per-patient record of prescribed vs delivered dose and fraction count against the treatment plan.", freq: "Real-time", audience: "Radiation Oncologists · Physics", format: "System / PDF" },
    { name: "Simulation-to-First-Fraction Turnaround Log", cat: "clinical", desc: "Time elapsed from CT-simulation through contouring, planning and QA to first treatment.", freq: "Daily", audience: "Physics · RTTs", format: "Report" },
    { name: "Acute & Late Toxicity Grading Register", cat: "clinical", desc: "RTOG/CTCAE graded skin, mucosal and organ-specific toxicity captured at weekly on-treatment review.", freq: "Weekly", audience: "Radiation Oncologists", format: "System / Excel" },
    { name: "Treatment Interruption & Gap Analysis", cat: "clinical", desc: "Causes and duration of unplanned treatment breaks and their impact on biologically effective dose.", freq: "Weekly", audience: "Radiation Oncologists", format: "Report" },
    { name: "On-Treatment Review (Weekly OPD) Summary", cat: "clinical", desc: "Consolidated weekly clinical review findings, dose modifications and supportive care actions.", freq: "Weekly", audience: "Radiation Oncologists", format: "Report" },
    { name: "Brachytherapy Case & Applicator Log", cat: "clinical", desc: "Applicator insertion details, source loading, dwell times and post-procedure imaging verification.", freq: "Per procedure", audience: "Brachytherapy Team", format: "Report" },
    { name: "Contouring & Plan Peer-Review Log", cat: "clinical", desc: "Peer-review sign-off status for target volumes and organ-at-risk contours prior to treatment.", freq: "Per plan", audience: "Radiation Oncologists · Physics", format: "System Log" },
    { name: "Re-treatment / Replanning Case Register", cat: "clinical", desc: "Cases requiring adaptive replanning due to anatomical change, toxicity or recurrence.", freq: "Weekly", audience: "Radiation Oncologists", format: "Register" },
    { name: "Post-RT Follow-up & Local Control Tracker", cat: "clinical", desc: "Surveillance imaging schedule adherence and local control status post-treatment completion.", freq: "Monthly", audience: "Radiation Oncologists · Follow-up Clinic", format: "Report" },
    { name: "Radiotherapy Clinical Trial Protocol Compliance Log", cat: "research", desc: "Dose constraints, contouring and QA compliance for patients enrolled on RT-specific trials.", freq: "Weekly", audience: "PI · Research Coordinator", format: "CTMS Export" },
    { name: "Dose-Volume Histogram Outcome Correlation Study Data", cat: "research", desc: "DVH parameters linked to toxicity and control outcomes for retrospective/prospective analysis.", freq: "Monthly", audience: "Physics · Research Team", format: "Data Export" },
    { name: "SBRT / SRS Outcome Registry", cat: "research", desc: "Local control, toxicity and survival data for stereotactic radiotherapy and radiosurgery cases.", freq: "Quarterly", audience: "Radiation Oncologists", format: "Registry Export" },
    { name: "Publication & Conference Abstract Tracker", cat: "research", desc: "Manuscripts and abstracts in progress across the radiation oncology and physics teams.", freq: "Quarterly", audience: "Academic Committee", format: "Register" },
    { name: "Radiobiology / Dose-Response Research Data Log", cat: "research", desc: "Institutional data supporting dose-response and fractionation research questions.", freq: "Quarterly", audience: "Research Team", format: "Data Export" },
    { name: "Inter-Institutional Contouring Consensus Study Data", cat: "research", desc: "Contour comparison data contributed to multi-centre consensus and benchmarking studies.", freq: "As per study", audience: "Radiation Oncologists", format: "Data Export" },
    { name: "Investigator-Initiated Study Progress Report", cat: "research", desc: "Milestone tracking for locally sponsored radiotherapy research studies.", freq: "Monthly", audience: "PI · Institutional Review Board", format: "Report" },
    { name: "Trial Recruitment vs Target Accrual (Radiation Arm)", cat: "research", desc: "Enrollment progress for radiotherapy-containing arms of open interventional trials.", freq: "Monthly", audience: "PI · Sponsor", format: "Dashboard" },
    { name: "LINAC / Brachytherapy Machine Utilization Report", cat: "admin", desc: "Treatment-hours utilization, idle time and capacity headroom by machine.", freq: "Weekly", audience: "Administration · Physics", format: "Report" },
    { name: "Machine Downtime & Preventive Maintenance Log", cat: "admin", desc: "Scheduled and unscheduled downtime, root cause and vendor service turnaround.", freq: "Weekly", audience: "Biomedical Engineering", format: "Log" },
    { name: "AERB Radiation Safety Compliance Register", cat: "admin", desc: "Regulatory compliance checklist including source inventory, shielding surveys and license renewals.", freq: "Quarterly", audience: "Radiation Safety Officer", format: "Regulatory Report" },
    { name: "Dosimetrist / RTT / Physicist Staffing Roster", cat: "admin", desc: "Duty roster and coverage adequacy across physics and therapy technologist teams.", freq: "Weekly", audience: "HR · Chief Physicist", format: "Roster" },
    { name: "Cost per Fraction Analysis", cat: "admin", desc: "Machine time, consumable and overhead cost per delivered fraction, by modality.", freq: "Monthly", audience: "Finance", format: "Report" },
    { name: "RT Waitlist & Backlog Report", cat: "admin", desc: "Patients awaiting simulation or treatment start against machine capacity.", freq: "Weekly", audience: "Administration", format: "Dashboard" },
    { name: "Consumables Inventory (Applicators, Immobilization Devices)", cat: "admin", desc: "Stock levels of masks, moulds, applicators and positioning devices.", freq: "Weekly", audience: "Stores · Physics", format: "Report" },
    { name: "Radiation Source Inventory & Decay Log", cat: "admin", desc: "Brachytherapy source activity, decay correction and replacement scheduling.", freq: "Monthly", audience: "Radiation Safety Officer", format: "Log" },
    { name: "Revenue & Billing Summary", cat: "admin", desc: "Departmental revenue and package utilization for radiation oncology services.", freq: "Monthly", audience: "Finance", format: "Report" },
    { name: "Personnel Radiation Dosimetry (TLD Badge) Monitoring", cat: "admin", desc: "Staff occupational radiation exposure readings against permissible limits.", freq: "Monthly", audience: "Radiation Safety Officer", format: "Regulatory Report" },
  ],
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "clinical", label: "Daily Active Patient" },
  { id: "research", label: "Research & Academic" },
  { id: "admin", label: "Administrative & Operations" },
  { id: "quality", label: "Quality & Safety" },
  { id: "library", label: "Reports Library" },
];

/* ---- Scoped styles (prefixed with .rad-onc-dash so nothing leaks to host) ---- */
const STYLES = `
.rad-onc-dash{
  --bg:#ffffff; --panel:#ffffff; --line:#dcdcdc; --line-soft:#eeeeee;
  --ink:#111111; --ink-mid:#5a5a5a; --ink-light:#8f8f8f;
  --grey:#f4f4f4; --grey-mid:#e2e2e2; --grey-dark:#c9c9c9; --black:#000000;
  font-family:'Open Sans', sans-serif; font-weight:300; color:var(--ink);
  letter-spacing:.1px; -webkit-font-smoothing:antialiased;
}
.rad-onc-dash *{box-sizing:border-box;}
.rad-onc-dash h2,.rad-onc-dash h3,.rad-onc-dash h4{font-weight:300; letter-spacing:.3px; margin:0;}
.rad-onc-dash table{border-collapse:collapse; width:100%;}

.rad-onc-dash .tabbar{display:flex; gap:0; border-bottom:1px solid var(--line); overflow-x:auto; background:#fff;}
.rad-onc-dash .tab{padding:14px 18px; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--ink-light); font-weight:400; white-space:nowrap; border-bottom:2px solid transparent; background:none; border-left:none; border-right:none; border-top:none; cursor:pointer; font-family:inherit; transition:color .15s, border-color .15s;}
.rad-onc-dash .tab:hover{color:var(--ink);}
.rad-onc-dash .tab.active{color:var(--ink); border-bottom-color:var(--ink); font-weight:600;}

.rad-onc-dash .dash-banner{font-size:11px; letter-spacing:.5px; color:var(--ink-mid); padding:8px 14px; background:#f6f6f6; border-bottom:1px solid var(--line);}
.rad-onc-dash .dash-banner.err{color:#7a2b2b; background:#faf3f3;}
.rad-onc-dash .content{padding:28px 4px 20px;}
.rad-onc-dash .section-head{margin-bottom:18px; border-left:2px solid var(--ink); padding-left:14px;}
.rad-onc-dash .section-head h2{font-size:20px; font-weight:300;}
.rad-onc-dash .section-head p{font-size:12px; color:var(--ink-mid); margin-top:4px; max-width:820px; line-height:1.6;}

.rad-onc-dash .kpi-grid{display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:32px;}
.rad-onc-dash .kpi{background:#fff; padding:20px 18px;}
.rad-onc-dash .kpi .kl{font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:var(--ink-light); font-weight:400;}
.rad-onc-dash .kpi .kv{font-size:28px; font-weight:200; margin-top:10px;}
.rad-onc-dash .kpi .kv sup{font-size:13px; font-weight:400; margin-left:2px;}
.rad-onc-dash .kpi .kd{font-size:10.5px; color:var(--ink-mid); margin-top:6px;}
.rad-onc-dash .kpi .kd.up::before{content:'\\25B2 '; font-size:9px;}
.rad-onc-dash .kpi .kd.down::before{content:'\\25BC '; font-size:9px;}

.rad-onc-dash .grid-2{display:grid; grid-template-columns:1.4fr 1fr; gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:32px;}
.rad-onc-dash .grid-3{display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:32px;}
.rad-onc-dash .panel{background:#fff; padding:22px 24px;}
.rad-onc-dash .panel h3{font-size:13px; font-weight:600; letter-spacing:.3px;}
.rad-onc-dash .panel .panel-note{font-size:10.5px; color:var(--ink-light); margin-top:3px; margin-bottom:14px; line-height:1.6;}
.rad-onc-dash .chart-box{height:260px; position:relative;}
.rad-onc-dash .chart-box.short{height:190px;}

.rad-onc-dash .filter-row{display:flex; gap:10px; margin-bottom:18px; flex-wrap:wrap; align-items:center;}
.rad-onc-dash .filter-btn{border:1px solid var(--line); padding:7px 16px; font-size:11px; letter-spacing:.6px; text-transform:uppercase; color:var(--ink-mid); background:#fff; cursor:pointer; font-family:inherit;}
.rad-onc-dash .filter-btn.active{border-color:var(--ink); color:var(--ink); font-weight:600;}
.rad-onc-dash .filter-count{font-size:11px; color:var(--ink-light); margin-left:auto;}
.rad-onc-dash .search-box{border:1px solid var(--line); padding:7px 14px; font-size:12px; width:240px; color:var(--ink); font-family:inherit; font-weight:300;}

.rad-onc-dash .report-table{border:1px solid var(--line); font-size:12px;}
.rad-onc-dash .report-table thead th{text-align:left; padding:12px 16px; font-size:9.5px; letter-spacing:1.2px; text-transform:uppercase; color:var(--ink-light); border-bottom:1px solid var(--ink); font-weight:600; background:#fff;}
.rad-onc-dash .report-table tbody td{padding:13px 16px; border-bottom:1px solid var(--line-soft); vertical-align:top; color:var(--ink-mid);}
.rad-onc-dash .report-table tbody tr:last-child td{border-bottom:none;}
.rad-onc-dash .report-table tbody tr:hover{background:var(--grey);}
.rad-onc-dash .report-table .rn{color:var(--ink); font-weight:600;}
.rad-onc-dash .report-table .rdesc{font-size:11.5px; line-height:1.55; max-width:400px;}
.rad-onc-dash .cat-tag{display:inline-block; border:1px solid var(--grey-dark); padding:2px 9px; font-size:9.5px; letter-spacing:.8px; text-transform:uppercase; color:var(--ink-mid);}
.rad-onc-dash .cat-tag.clinical{border-color:var(--ink);}
.rad-onc-dash .freq{font-size:11px; white-space:nowrap;}

.rad-onc-dash .qlist{border:1px solid var(--line);}
.rad-onc-dash .qrow{display:flex; align-items:center; gap:18px; padding:16px 20px; border-bottom:1px solid var(--line-soft);}
.rad-onc-dash .qrow:last-child{border-bottom:none;}
.rad-onc-dash .qname{flex:1.4;}
.rad-onc-dash .qname .qt{font-size:13px; font-weight:600;}
.rad-onc-dash .qname .qs{font-size:10.5px; color:var(--ink-light); margin-top:2px;}
.rad-onc-dash .qbar-wrap{flex:2;}
.rad-onc-dash .qbar-track{height:5px; background:var(--grey); position:relative;}
.rad-onc-dash .qbar-fill{height:100%; background:var(--ink);}
.rad-onc-dash .qbar-target{position:absolute; top:-3px; width:1px; height:11px; background:var(--ink-mid);}
.rad-onc-dash .qvals{display:flex; justify-content:space-between; font-size:10px; color:var(--ink-light); margin-top:5px;}
.rad-onc-dash .qstatus{width:110px; text-align:right; font-size:10px; letter-spacing:1px; text-transform:uppercase; font-weight:600;}

.rad-onc-dash .card-list{display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--line); border:1px solid var(--line);}
.rad-onc-dash .rcard{background:#fff; padding:18px 20px;}
.rad-onc-dash .rcard .rc-top{display:flex; justify-content:space-between; gap:10px;}
.rad-onc-dash .rcard h4{font-size:12.5px; font-weight:600;}
.rad-onc-dash .rcard .rc-desc{font-size:11.5px; color:var(--ink-mid); line-height:1.6; margin-top:6px;}
.rad-onc-dash .rcard .rc-meta{display:flex; gap:16px; margin-top:12px; font-size:10px; color:var(--ink-light); text-transform:uppercase; letter-spacing:.5px;}

@media (max-width:1180px){
  .rad-onc-dash .kpi-grid{grid-template-columns:repeat(3,1fr);}
  .rad-onc-dash .grid-2,.rad-onc-dash .grid-3{grid-template-columns:1fr;}
  .rad-onc-dash .card-list{grid-template-columns:1fr;}
}
@media (max-width:640px){
  .rad-onc-dash .kpi-grid{grid-template-columns:repeat(2,1fr);}
}
`;

/* ---- Chart helpers (greyscale palette ported from the HTML) ---- */
const GREYS = ["#111111", "#4a4a4a", "#767676", "#9c9c9c", "#bdbdbd", "#d8d8d8", "#e8e8e8"];
const AXIS = "#8f8f8f";
const GRID = "#f0f0f0";

/* Vertical bar chart — one dataset, greyscale bars, value labels + baseline grid. */
const BarChart = ({ labels, data }) => {
  const W = 480;
  const H = 260;
  const padL = 34;
  const padR = 12;
  const padT = 16;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...data, 1);
  const step = plotW / labels.length;
  const barW = Math.min(46, step * 0.6);
  const ticks = 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fontFamily="Open Sans">
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const y = padT + (plotH / ticks) * i;
        const val = Math.round((max / ticks) * (ticks - i));
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth="1" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill={AXIS}>
              {val}
            </text>
          </g>
        );
      })}
      {data.map((v, i) => {
        const h = (v / max) * plotH;
        const x = padL + step * i + (step - barW) / 2;
        const y = padT + plotH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} fill={GREYS[0]} />
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="9.5" fill={AXIS}>
              {v}
            </text>
            <text x={padL + step * i + step / 2} y={H - padB + 16} textAnchor="middle" fontSize="9.5" fill={AXIS}>
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/* Line chart — single series, light fill under the line, dot markers. */
const LineChart = ({ labels, data }) => {
  const W = 480;
  const H = 260;
  const padL = 44;
  const padR = 14;
  const padT = 16;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const pts = data.map((v, i) => ({
    x: padL + step * i,
    y: padT + plotH - ((v - min) / span) * plotH,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${padT + plotH} L${pts[0].x},${padT + plotH} Z`;
  const ticks = 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fontFamily="Open Sans">
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const y = padT + (plotH / ticks) * i;
        const val = Math.round(max - (span / ticks) * i);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth="1" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill={AXIS}>
              {val}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill="rgba(0,0,0,0.04)" />
      <path d={linePath} fill="none" stroke={GREYS[0]} strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="2.5" fill={GREYS[0]} />
          <text x={p.x} y={H - padB + 16} textAnchor="middle" fontSize="9.5" fill={AXIS}>
            {labels[i]}
          </text>
        </g>
      ))}
    </svg>
  );
};

/* Doughnut chart — greyscale segments + legend below (matches Chart.js layout). */
const DoughnutChart = ({ labels, data }) => {
  const size = 150;
  const cx = size / 2;
  const cy = size / 2;
  const r = 62;
  const inner = r * 0.68;
  const total = data.reduce((a, b) => a + b, 0) || 1;
  let angle = -Math.PI / 2;
  const arc = (value) => {
    const a0 = angle;
    const a1 = angle + (value / total) * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const xi1 = cx + inner * Math.cos(a1);
    const yi1 = cy + inner * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a0);
    const yi0 = cy + inner * Math.sin(a0);
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${inner},${inner} 0 ${large} 0 ${xi0},${yi0} Z`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "center", gap: 10 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} fontFamily="Open Sans">
        {data.map((v, i) => (
          <path key={i} d={arc(v)} fill={GREYS[i % GREYS.length]} stroke="#fff" strokeWidth="1" />
        ))}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 12px" }}>
        {labels.map((l, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "#5a5a5a" }}>
            <span style={{ width: 10, height: 10, background: GREYS[i % GREYS.length], display: "inline-block" }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
};

const DashChart = ({ type, labels, datasets }) => {
  const data = datasets[0]?.data || [];
  if (type === "line") return <LineChart labels={labels} data={data} />;
  if (type === "doughnut") return <DoughnutChart labels={labels} data={data} />;
  return <BarChart labels={labels} data={data} />;
};

const ChartPanel = ({ title, note, chart, short }) => (
  <div className="panel">
    <h3>{title}</h3>
    {note && <div className="panel-note">{note}</div>}
    <div className={"chart-box" + (short ? " short" : "")}>
      {chart.noData ? (
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9c9c9c",
            fontSize: 11,
            letterSpacing: ".5px",
            textTransform: "uppercase",
          }}
        >
          No data source
        </div>
      ) : (
        <DashChart type={chart.type} labels={chart.labels} datasets={chart.datasets} />
      )}
    </div>
  </div>
);

const SectionHead = ({ title, desc }) => (
  <div className="section-head">
    <h2>{title}</h2>
    {desc && <p>{desc}</p>}
  </div>
);

/* ---- Views ---- */
const OverviewView = ({ overview }) => {
  const o = overview;
  return (
    <div className="view">
      <SectionHead title={o.title} desc={o.desc} />
      <div className="kpi-grid">
        {o.kpis.map((k, i) => (
          <div className="kpi" key={i}>
            <div className="kl">{k.label}</div>
            <div className="kv">
              {k.value}
              {k.unit ? <sup>{k.unit}</sup> : null}
            </div>
            <div className={"kd" + (k.dir === "up" ? " up" : k.dir === "down" ? " down" : "")}>
              {k.noData ? "no data source" : k.note || ""}
            </div>
          </div>
        ))}
      </div>
      <div className="grid-2">
        <ChartPanel title={o.chart1.title} note={o.chart1.note} chart={o.chart1} />
        <ChartPanel title={o.chart2.title} note={o.chart2.note} chart={o.chart2} />
      </div>
      <div className="grid-3">
        {o.mini.map((m, i) => (
          <ChartPanel key={i} title={m.title} note={m.note} chart={m} short />
        ))}
      </div>
    </div>
  );
};

const DailyActivePatientView = ({ patients }) => {
  const totalPatients = patients ? patients.length : 0;
  const pending = patients ? patients.filter(p => p.treatmentStatus?.toLowerCase() === 'pending').length : 0;
  const inProgress = patients ? patients.filter(p => p.treatmentStatus?.toLowerCase() === 'active').length : 0;
  const completed = patients ? patients.filter(p => p.treatmentStatus?.toLowerCase() === 'completed').length : 0;
  const totalSessions = patients ? patients.reduce((sum, p) => sum + (Number(p.fractionsCompleted) || 0), 0) : 0;

  const activePatients = patients ? patients.filter(p => p.treatmentStatus?.toLowerCase() === 'active') : [];

  return (
    <div className="view">
      <SectionHead title="Daily Active Patient" desc="List of patients currently on active radiation therapy treatment." />
      
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kl">TOTAL PATIENTS</div>
          <div className="kv">{totalPatients}</div>
          <div className="kd">All profiles</div>
        </div>
        <div className="kpi">
          <div className="kl">PENDING TREATMENT</div>
          <div className="kv">{pending}</div>
          <div className="kd">Awaiting next steps</div>
        </div>
        <div className="kpi">
          <div className="kl">IN PROGRESS</div>
          <div className="kv">{inProgress}</div>
          <div className="kd">Currently undergoing treatment</div>
        </div>
        <div className="kpi">
          <div className="kl">TREATMENT COMPLETED</div>
          <div className="kv">{completed}</div>
          <div className="kd">Finished protocols</div>
        </div>
        <div className="kpi">
          <div className="kl">TOTAL SESSIONS</div>
          <div className="kv">{totalSessions}</div>
          <div className="kd">Fractions delivered</div>
        </div>
      </div>

      {(!activePatients || activePatients.length === 0) ? (
        <div style={{ padding: "20px 4px", fontSize: 13, color: "var(--ink-mid)" }}>No active patients found.</div>
      ) : (
        <table className="report-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Patient Name</th>
              <th style={{ width: 60 }}>Age</th>
              <th style={{ width: 80 }}>Gender</th>
              <th style={{ width: 140 }}>Latest Appt</th>
              <th style={{ width: 130 }}>Treatment Type</th>
              <th style={{ width: 140 }}>Fractions Completed</th>
            </tr>
          </thead>
          <tbody>
            {activePatients.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="rn">{p.patientName}</td>
                <td>{p.age}</td>
                <td>{p.gender}</td>
                <td>{p.latestAppointment}</td>
                <td>{p.treatmentType}</td>
                <td>{p.fractionsCompleted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const CardListView = ({ title, desc, cat }) => (
  <div className="view">
    <SectionHead title={title} desc={desc} />
    <div className="card-list">
      {CONFIG.reports
        .filter((r) => r.cat === cat)
        .map((r, i) => (
          <div className="rcard" key={i}>
            <div className="rc-top">
              <h4>{r.name}</h4>
            </div>
            <div className="rc-desc">{r.desc}</div>
            <div className="rc-meta">
              <span>{r.freq}</span>
              <span>{r.audience}</span>
              <span>{r.format}</span>
            </div>
          </div>
        ))}
    </div>
  </div>
);

const QualityView = ({ quality }) => (
  <div className="view">
    <SectionHead title="Quality & Safety Indicators" desc={CONFIG.qualityDesc} />
    <div className="qlist">
      {quality.map((q, i) => {
        const numeric = typeof q.value === "number" && !q.noData;
        const pct = numeric ? Math.min(100, Math.round((q.value / q.max) * 100)) : 0;
        const tpct = Math.min(100, Math.round((q.target / q.max) * 100));
        return (
          <div className="qrow" key={i}>
            <div className="qname">
              <div className="qt">{q.name}</div>
              <div className="qs">{q.desc}</div>
            </div>
            <div className="qbar-wrap">
              <div className="qbar-track">
                <div className="qbar-fill" style={{ width: pct + "%" }} />
                <div className="qbar-target" style={{ left: tpct + "%" }} />
              </div>
              <div className="qvals">
                <span>
                  {q.value}
                  {q.noData ? "" : q.unit || ""}
                </span>
                <span>
                  Target {q.target}
                  {q.unit || ""}
                </span>
              </div>
            </div>
            <div className="qstatus">{q.status}</div>
          </div>
        );
      })}
    </div>
  </div>
);

const LibraryView = () => {
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const all = CONFIG.reports;
  const counts = { all: all.length, clinical: 0, research: 0, admin: 0 };
  all.forEach((r) => {
    counts[r.cat]++;
  });
  const cats = [
    ["all", "All Reports"],
    ["clinical", "Clinical"],
    ["research", "Research"],
    ["admin", "Administrative"],
  ];
  const q = query.trim().toLowerCase();
  const filtered = all.filter((r) => {
    if (cat !== "all" && r.cat !== cat) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q))) return false;
    return true;
  });

  return (
    <div className="view">
      <SectionHead
        title="Reports Library"
        desc={`Complete catalogue of clinical, research and administrative reports maintained for ${CONFIG.deptName}. Filter by category or search by keyword.`}
      />
      <div className="filter-row">
        {cats.map(([key, label]) => (
          <button
            key={key}
            className={"filter-btn" + (cat === key ? " active" : "")}
            onClick={() => setCat(key)}
          >
            {label} ({counts[key] !== undefined ? counts[key] : 0})
          </button>
        ))}
        <input
          className="search-box"
          type="text"
          placeholder="Search reports..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="filter-count">
          {filtered.length} of {all.length} reports
        </span>
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th style={{ width: 26 }}>#</th>
            <th>Report Name</th>
            <th style={{ width: 110 }}>Category</th>
            <th>Description</th>
            <th style={{ width: 130 }}>Frequency</th>
            <th style={{ width: 160 }}>Primary Audience</th>
            <th style={{ width: 90 }}>Format</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="rn">{r.name}</td>
              <td>
                <span className={"cat-tag" + (r.cat === "clinical" ? " clinical" : "")}>{r.cat}</span>
              </td>
              <td className="rdesc">{r.desc}</td>
              <td className="freq">{r.freq}</td>
              <td>{r.audience}</td>
              <td>{r.format}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Merge a backend chart object over a CONFIG chart default, preferring the
// backend's live data while keeping the CONFIG title/note when the backend
// omits them.
const mergeChart = (base, live) => {
  if (!live) return base;
  return {
    ...base,
    ...live,
    title: live.title || base.title,
    note: live.note || base.note,
  };
};

// The HTML defines the full set of KPI boxes; the backend only fills a subset
// of them and its labels differ slightly. Map each HTML box to its backend
// label so live values overlay onto the full box set. HTML boxes with no
// backend source stay as "—" (noData); backend boxes with no HTML counterpart
// are ignored (we never add a box that isn't in the HTML).
const KPI_ALIASES = {
  "Patients on Active RT": "Patients on Active RT",
  "New RT Starts (MTD)": "New RT Starts (MTD)",
  "Average LINAC Utilization": "LINAC Utilization",
  "Fractions Delivered (MTD)": "Fractions Delivered (MTD)",
  "Fraction Completion Rate": "Fraction Completion Rate",
  "Simulation to First Fraction": "Avg Sim → First Fraction",
  "Machine Downtime (This Month)": "Machine Downtime (MTD)",
  "Brachytherapy Sessions (MTD)": "Brachytherapy Sessions (MTD)",
  // "Re-treatment / Replan Rate" and "Grade ≥2 Acute Skin Toxicity" have no
  // backend source → they render as "—".
};

const mergeKpis = (configKpis, backendKpis) => {
  if (!Array.isArray(backendKpis) || !backendKpis.length) return configKpis;
  const byLabel = {};
  backendKpis.forEach((k) => {
    byLabel[k.label] = k;
  });
  return configKpis.map((base) => {
    const live = byLabel[KPI_ALIASES[base.label]];
    if (!live || live.noData) {
      return { ...base, value: "—", note: "", dir: "", noData: true };
    }
    return {
      ...base,
      value: live.value,
      unit: live.unit !== undefined ? live.unit : base.unit,
      note: "",
      dir: "",
      noData: false,
    };
  });
};

const mergeQuality = (configQuality, backendQuality) => {
  if (!Array.isArray(backendQuality) || !backendQuality.length) return configQuality;
  const byName = {};
  backendQuality.forEach((q) => {
    byName[q.name] = q;
  });
  return configQuality.map((base) => {
    const live = byName[base.name];
    if (!live) {
      return { ...base, value: "—", status: "No Data", noData: true };
    }
    return {
      ...base,
      value: live.value,
      target: live.target,
      max: live.max,
      unit: live.unit,
      status: live.status,
      noData: !!live.noData,
    };
  });
};

const RadiationOncologyDashboard = ({ doctorId }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [overview, setOverview] = useState(CONFIG.overview);
  const [quality, setQuality] = useState(CONFIG.quality);
  const [dailyPatients, setDailyPatients] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    if (!doctorId) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      setStatus("loading");
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/data/context/radiation-oncology-dashboard/${doctorId}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const d = json?.data || {};
        const c = d.charts || {};

        setOverview({
          ...CONFIG.overview,
          kpis: mergeKpis(CONFIG.overview.kpis, d.kpis),
          chart1: mergeChart(CONFIG.overview.chart1, c.chart1),
          chart2: mergeChart(CONFIG.overview.chart2, c.chart2),
          mini: [
            mergeChart(CONFIG.overview.mini[0], c.miniFractionation),
            mergeChart(CONFIG.overview.mini[1], c.miniToxicity),
            mergeChart(CONFIG.overview.mini[2], c.miniSite),
          ],
        });
        setQuality(mergeQuality(CONFIG.quality, d.quality));
        setDailyPatients(d.dailyPatients || []);
        setStatus("ready");
      } catch (err) {
        if (cancelled || err.name === "AbortError") return;
        // Keep CONFIG defaults on the screen so the dashboard still renders.
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [doctorId]);

  return (
    <div className="rad-onc-dash">
      <style>{STYLES}</style>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={"tab" + (activeTab === t.id ? " active" : "")}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {status === "loading" && <div className="dash-banner">Loading live radiation-oncology data…</div>}
      {status === "error" && (
        <div className="dash-banner err">Could not load live data — showing reference figures.</div>
      )}
      <div className="content">
        {activeTab === "overview" && <OverviewView overview={overview} />}
        {activeTab === "clinical" && (
          <DailyActivePatientView patients={dailyPatients} />
        )}
        {activeTab === "research" && (
          <CardListView title="Research & Academic Reports" desc={CONFIG.researchDesc} cat="research" />
        )}
        {activeTab === "admin" && (
          <CardListView title="Administrative & Operational Reports" desc={CONFIG.adminDesc} cat="admin" />
        )}
        {activeTab === "quality" && <QualityView quality={quality} />}
        {activeTab === "library" && <LibraryView />}
      </div>
    </div>
  );
};

export default RadiationOncologyDashboard;
