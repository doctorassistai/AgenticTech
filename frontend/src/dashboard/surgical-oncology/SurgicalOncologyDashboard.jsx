import React, { useEffect, useState, useRef, useMemo } from "react";
import { getBookings, getPatientLastAppointment } from "../../components/surgical-oncology/shared/api";
import { buildDashboardData } from "./surgicalDashboardData";

/* ============================================================
   Surgical Oncology Dashboard
   - Overview KPIs / charts / Quality panels are computed from REAL
     bookings (api.getBookings → buildDashboardData).
   - The Reports Library catalogue (clinical/research/admin cards) is
     descriptive metadata, kept static intentionally — see
     dashboard/DASHBOARD_PENDING.md for what is not yet data-backed.
   ============================================================ */

/* ─── STATIC catalogue + copy (not metric data) ─── */
const CONFIG = {
  deptName: "Surgical Oncology",
  pageTitle: "Surgical Oncology Dashboard",
  deptSub:
    "Operating theatre scheduling, surgical outcomes, margin status and perioperative safety analytics",
  overview: {
    title: "Executive Overview",
    desc: "Real-time snapshot of surgical oncology throughput, outcomes and operating theatre efficiency.",
  },
  clinicalDesc:
    "Reports supporting operative planning, intra-operative decision making, post-operative recovery and surgical safety.",
  researchDesc:
    "Reports supporting surgical trials, outcomes research, specimen repositories and academic output.",
  adminDesc:
    "Reports supporting theatre utilization, instrument logistics, staffing and cost management.",
  qualityDesc:
    "Indicators tracked against institutional surgical-safety and accreditation benchmarks.",
  reports: [
    { name: "Daily OT Schedule & Case List", cat: "clinical", desc: "Theatre-wise list of scheduled cases, procedure, surgeon and anticipated duration.", freq: "Daily", audience: "OT Coordinator · Surgeons", format: "Dashboard" },
    { name: "Surgical Outcome & Complication Register (Clavien-Dindo)", cat: "clinical", desc: "Graded post-operative complications tracked against the Clavien-Dindo classification.", freq: "Weekly", audience: "Surgical Oncologists", format: "System / Excel" },
    { name: "Margin Status (R0/R1/R2) Report", cat: "clinical", desc: "Resection margin outcome correlated with procedure type and adjuvant therapy planning.", freq: "Per case", audience: "Surgical Oncologists · Pathology", format: "Structured Report" },
    { name: "Post-operative Length of Stay Tracker", cat: "clinical", desc: "Actual vs expected length of stay by procedure category, with delay reasons.", freq: "Daily", audience: "Nursing · Administration", format: "Dashboard" },
    { name: "Frozen Section & Intra-operative Consultation Log", cat: "clinical", desc: "Intra-operative frozen section requests, turnaround time and concordance with final report.", freq: "Per case", audience: "Surgeons · Pathology", format: "Log" },
    { name: "Blood & Blood Product Utilization (Intra-op)", cat: "clinical", desc: "Units cross-matched, transfused and wastage by procedure.", freq: "Weekly", audience: "Surgeons · Blood Bank", format: "Report" },
    { name: "ICU/HDU Post-operative Admission Log", cat: "clinical", desc: "Planned and unplanned critical-care admissions following surgery, with indication.", freq: "Daily", audience: "Surgeons · Intensivists", format: "Log" },
    { name: "Reconstructive / Oncoplastic Case Tracker", cat: "clinical", desc: "Flap, graft and reconstructive procedure details and outcomes.", freq: "Weekly", audience: "Surgical Oncologists", format: "Report" },
    { name: "Surgical Site Infection Surveillance Report", cat: "clinical", desc: "SSI rate by procedure category and wound class, per infection-control surveillance protocol.", freq: "Monthly", audience: "Infection Control · Surgeons", format: "Report" },
    { name: "Discharge Summary & Adjuvant Therapy Handover Log", cat: "clinical", desc: "Structured handover of post-operative course and staging to medical/radiation oncology.", freq: "Per discharge", audience: "Surgeons · Oncology Team", format: "Document" },
    { name: "Surgical Trial Enrollment & Follow-up Log", cat: "research", desc: "Screening, consent and follow-up status for patients enrolled in surgical intervention studies.", freq: "Weekly", audience: "PI · Research Coordinator", format: "CTMS Export" },
    { name: "Survival & Recurrence Audit (Surgical Cohort)", cat: "research", desc: "Disease-free and overall survival audit for operated cohorts, by stage and procedure.", freq: "Annual", audience: "Tumor Registry · Surgeons", format: "Registry Export" },
    { name: "Case-based Publication & Case Series Tracker", cat: "research", desc: "Surgical case series and technique papers in preparation or submission.", freq: "Quarterly", audience: "Academic Committee", format: "Register" },
    { name: "Surgical Technique Outcome Comparison Study Data", cat: "research", desc: "Comparative outcome data across open, laparoscopic and robotic-assisted approaches.", freq: "Quarterly", audience: "Research Team", format: "Data Export" },
    { name: "Sentinel Lymph Node Biopsy Concordance Study", cat: "research", desc: "Concordance between sentinel node status and completion axillary/nodal dissection findings.", freq: "Quarterly", audience: "Surgeons · Pathology", format: "Data Export" },
    { name: "Minimally Invasive vs Open Surgery Outcome Registry", cat: "research", desc: "Comparative morbidity, recovery and oncologic outcome registry across approaches.", freq: "Quarterly", audience: "Research Team", format: "Registry Export" },
    { name: "Investigator-Initiated Surgical Study Progress Report", cat: "research", desc: "Milestone tracking for locally sponsored surgical research studies.", freq: "Monthly", audience: "PI · Institutional Review Board", format: "Report" },
    { name: "Tissue / Specimen Research Repository Log", cat: "research", desc: "Surgical specimen accession into the research tissue repository with consent linkage.", freq: "Weekly", audience: "Research Lab · Biobank Custodian", format: "LIMS Export" },
    { name: "OT Utilization & Turnover Time Report", cat: "admin", desc: "Theatre occupancy, case-to-case turnover and idle-time analysis.", freq: "Weekly", audience: "OT Manager · Administration", format: "Report" },
    { name: "Surgical Instrument & Sterilization (CSSD) Tracking", cat: "admin", desc: "Instrument set turnaround, sterilization cycle compliance and tray availability.", freq: "Daily", audience: "CSSD · OT Nursing", format: "System Log" },
    { name: "Surgeon / Anesthetist / OT Nurse Staffing Roster", cat: "admin", desc: "Duty roster and coverage adequacy across the surgical team.", freq: "Weekly", audience: "HR · OT Manager", format: "Roster" },
    { name: "Cost per Surgical Package Analysis", cat: "admin", desc: "Package cost breakdown by procedure, including implants and consumables.", freq: "Monthly", audience: "Finance", format: "Report" },
    { name: "Implant & High-Value Consumable Inventory", cat: "admin", desc: "Stock and traceability of implants, staplers and high-value disposables.", freq: "Weekly", audience: "Stores · OT Manager", format: "Report" },
    { name: "Case Cancellation & Reason Analysis", cat: "admin", desc: "Cancelled/postponed case audit with root-cause categorization.", freq: "Weekly", audience: "OT Manager", format: "Report" },
    { name: "OT Equipment Maintenance & Downtime Log", cat: "admin", desc: "Laparoscopy towers, energy devices and table maintenance and downtime record.", freq: "Weekly", audience: "Biomedical Engineering", format: "Log" },
    { name: "Revenue & Billing Summary", cat: "admin", desc: "Departmental revenue and package utilization for surgical oncology services.", freq: "Monthly", audience: "Finance", format: "Report" },
    { name: "Surgical Waitlist & Backlog Report", cat: "admin", desc: "Patients awaiting surgery against theatre capacity, prioritized by clinical urgency.", freq: "Weekly", audience: "Administration", format: "Dashboard" },
    { name: "Infection Control & CSSD Compliance Audit", cat: "admin", desc: "Periodic audit of sterile processing and theatre infection-control practices.", freq: "Quarterly", audience: "Infection Control Committee", format: "Audit Report" },
  ],
};

/* ─── Tabs ─── */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "clinical", label: "Clinical & Patient Care" },
  { id: "research", label: "Research & Academic" },
  { id: "admin", label: "Administrative & Operations" },
  { id: "quality", label: "Quality & Safety" },
  { id: "library", label: "Reports Library" },
];

const GREYS = ["#111111", "#4a4a4a", "#767676", "#9c9c9c", "#bdbdbd", "#d8d8d8", "#e8e8e8"];

/* ─── Native SVG Chart Components ─── */
const SVGBarChart = ({ labels, datasets, short }) => {
  const [hover, setHover] = useState(null);
  const data = datasets[0].data;
  const maxVal = Math.max(...data, 1);
  const padding = { top: 60, right: 20, bottom: 45, left: 60 };
  const w = 1000;
  const h = short ? 600 : 400; // Adjust aspect ratio for 'short' viewports
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;
  const barW = (plotW / Math.max(data.length, 1)) * 0.6;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
        const y = padding.top + plotH * tick;
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={w - padding.right} y2={y} stroke="#f0f0f0" />
            <text x={padding.left - 12} y={padding.top + plotH * (1 - tick) + 7} fill="#8f8f8f" fontSize="20" textAnchor="end">{Math.round(maxVal * tick)}</text>
          </g>
        );
      })}
      {data.map((val, i) => {
        const barH = (val / maxVal) * plotH;
        const x = padding.left + (i + 0.5) * (plotW / data.length) - barW / 2;
        const y = padding.top + plotH - barH;
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={barH} fill={hover?.i === i ? "#000" : GREYS[0]}
              onMouseEnter={() => setHover({ i, x: x + barW / 2, y, val, label: labels[i] })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer", transition: "fill 0.2s" }}
            />
            <text x={x + barW / 2} y={h - 15} fill="#8f8f8f" fontSize="22" textAnchor="middle">{labels[i]}</text>
          </g>
        );
      })}
      {hover && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={hover.x - 110} y={hover.y - 45} width="220" height="38" fill="#111" rx="6" />
          <text x={hover.x} y={hover.y - 19} fill="#fff" fontSize="22" textAnchor="middle">
            {hover.label}: {hover.val}
          </text>
        </g>
      )}
    </svg>
  );
};

const SVGLineChart = ({ labels, datasets, short }) => {
  const [hover, setHover] = useState(null);
  const data = datasets[0].data;
  const maxVal = Math.max(...data, 1);
  const padding = { top: 60, right: 30, bottom: 45, left: 60 };
  const w = 1000;
  const h = short ? 600 : 400;
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const getX = (i) => padding.left + i * (plotW / Math.max(1, data.length - 1));
  const getY = (val) => padding.top + plotH - (val / maxVal) * plotH;

  const points = data.map((val, i) => `${getX(i)},${getY(val)}`).join(" ");
  const fillPoints = `${padding.left},${padding.top + plotH} ${points} ${padding.left + plotW},${padding.top + plotH}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
        const y = padding.top + plotH * tick;
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={w - padding.right} y2={y} stroke="#f0f0f0" />
            <text x={padding.left - 12} y={padding.top + plotH * (1 - tick) + 7} fill="#8f8f8f" fontSize="20" textAnchor="end">{Math.round(maxVal * tick)}</text>
          </g>
        );
      })}
      {labels.map((lbl, i) => (
        <text key={i} x={getX(i)} y={h - 15} fill="#8f8f8f" fontSize="22" textAnchor="middle">{lbl}</text>
      ))}
      <polygon points={fillPoints} fill="rgba(0,0,0,0.04)" />
      <polyline points={points} fill="none" stroke={GREYS[0]} strokeWidth="3" strokeLinejoin="round" />
      {data.map((val, i) => (
        <circle
          key={i} cx={getX(i)} cy={getY(val)} r={hover?.i === i ? "10" : "6"} fill={GREYS[0]} stroke="#fff" strokeWidth="2"
          onMouseEnter={() => setHover({ i, x: getX(i), y: getY(val), val, label: labels[i] })}
          onMouseLeave={() => setHover(null)}
          style={{ cursor: "pointer", transition: "r 0.2s" }}
        />
      ))}
      {hover && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={hover.x - 110} y={hover.y - 50} width="220" height="38" fill="#111" rx="6" />
          <text x={hover.x} y={hover.y - 24} fill="#fff" fontSize="22" textAnchor="middle">
            {hover.label}: {hover.val}
          </text>
        </g>
      )}
    </svg>
  );
};

const SVGDoughnutChart = ({ labels, datasets }) => {
  const [hover, setHover] = useState(null);
  const data = datasets[0].data;
  const total = data.reduce((sum, val) => sum + val, 0);
  const w = 500;
  const h = 500;
  const cx = w / 2;
  const cy = h / 2 - 30;
  const r = 150;
  const strokeW = 65;

  let currentAngle = -Math.PI / 2;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", display: "block" }}>
      {total === 0 ? (
        <text x={cx} y={cy} textAnchor="middle" fill="#8f8f8f" fontSize="24">No Data</text>
      ) : (
        data.map((val, i) => {
          if (val === 0) return null;
          const sliceAngle = (val / total) * 2 * Math.PI;
          if (sliceAngle > 1.999 * Math.PI) {
            return (
              <circle
                key={i} cx={cx} cy={cy} r={r} fill="none" stroke={hover?.i === i ? "#000" : GREYS[i % GREYS.length]} strokeWidth={hover?.i === i ? strokeW + 8 : strokeW}
                onMouseEnter={() => setHover({ i, x: cx, y: cy - r, val, label: labels[i] })}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer", transition: "all 0.2s" }}
              />
            );
          }
          const startAngle = currentAngle;
          const endAngle = currentAngle + sliceAngle;
          currentAngle = endAngle;

          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const largeArc = sliceAngle > Math.PI ? 1 : 0;
          const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;

          const midAngle = startAngle + sliceAngle / 2;
          const tooltipX = cx + (r) * Math.cos(midAngle);
          const tooltipY = cy + (r) * Math.sin(midAngle);

          return (
            <path
              key={i} d={d} fill="none" stroke={hover?.i === i ? "#000" : GREYS[i % GREYS.length]} strokeWidth={hover?.i === i ? strokeW + 8 : strokeW}
              onMouseEnter={() => setHover({ i, x: tooltipX, y: tooltipY, val, label: labels[i] })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer", transition: "all 0.2s" }}
            />
          );
        })
      )}
      <g transform={`translate(0, ${h - 30})`}>
        {labels.map((lbl, i) => {
          const itemW = w / labels.length;
          return (
            <g key={i}>
              <rect x={i * itemW + 10} y={0} width={18} height={18} fill={GREYS[i % GREYS.length]} />
              <text x={i * itemW + 36} y={15} fill="#5a5a5a" fontSize="18">{lbl}</text>
            </g>
          );
        })}
      </g>
      {hover && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={hover.x - 110} y={hover.y - 20} width="220" height="38" fill="#111" rx="6" />
          <text x={hover.x} y={hover.y + 6} fill="#fff" fontSize="22" textAnchor="middle">
            {hover.label}: {hover.val}
          </text>
        </g>
      )}
    </svg>
  );
};

const NativeChart = ({ type, labels, datasets, short }) => {
  if (!datasets || !datasets.length) return null;
  if (type === "bar") return <SVGBarChart labels={labels} datasets={datasets} short={short} />;
  if (type === "line") return <SVGLineChart labels={labels} datasets={datasets} short={short} />;
  if (type === "doughnut") return <SVGDoughnutChart labels={labels} datasets={datasets} short={short} />;
  return null;
};

/* ─── Sub-builders ─── */
function KPIGrid({ items }) {
  return (
    <div className="so-kpi-grid">
      {items.map((k, i) => {
        const dirCls = k.dir === "up" ? "up" : k.dir === "down" ? "down" : "";
        return (
          <div className="so-kpi" key={i}>
            <div className="so-kl">
              {k.label}
            </div>
            <div className="so-kv">
              {k.value == null ? "None" : k.value}
              {k.value != null && k.unit ? <sup>{k.unit}</sup> : null}
            </div>
            <div className={`so-kd ${dirCls}`}>{k.note || ""}</div>
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, note, chart, short, children }) {
  return (
    <div className="so-panel">
      <h3>{title}</h3>
      {note ? <div className="so-panel-note">{note}</div> : null}
      {chart ? (
        <div className={`so-chart-box${short ? " short" : ""}`}>
          <NativeChart type={chart.type} labels={chart.labels} datasets={chart.datasets} short={short} />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function CardList({ reports }) {
  return (
    <div className="so-card-list">
      {reports.map((r, i) => (
        <div className="so-rcard" key={i}>
          <div className="so-rc-top">
            <h4>{r.name}</h4>
          </div>
          <div className="so-rc-desc">{r.desc}</div>
          <div className="so-rc-meta">
            <span>{r.freq}</span>
            <span>{r.audience}</span>
            <span>{r.format}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyActivePatientsTable({ bookings, doctorId }) {
  const [patientAppointments, setPatientAppointments] = useState({});

  useEffect(() => {
    if (!bookings || bookings.length === 0 || !doctorId) return;

    const uniquePatientIds = [...new Set(bookings.map(b => b.patient_id).filter(Boolean))];

    uniquePatientIds.forEach(patientId => {
      getPatientLastAppointment(patientId, doctorId)
        .then(res => {
          if (res && res.last_appointment) {
            setPatientAppointments(prev => ({
              ...prev,
              [patientId]: res.last_appointment
            }));
          }
        })
        .catch(err => {
          console.error("Error fetching last appointment for", patientId, err);
        });
    });
  }, [bookings, doctorId]);

  const patientsMap = new Map();
  (bookings || []).forEach(bk => {
    const pid = bk.patient_id;
    if (!pid) return;
    if (!patientsMap.has(pid)) {
      patientsMap.set(pid, {
        patient_id: pid,
        name: bk.patientName || "Unknown",
        ageSex: bk.ageSex || "",
        bookings: []
      });
    }
    patientsMap.get(pid).bookings.push(bk);
  });

  const patients = Array.from(patientsMap.values()).map(p => {
    p.bookings.sort((a, b) => {
      const d1 = new Date(a.date || 0);
      const d2 = new Date(b.date || 0);
      return d2 - d1;
    });
    const latest = p.bookings[0];
    const surgeriesCompleted = p.bookings.filter(b => b.status === "Completed" || b.surgery_finished).length;

    let age = "";
    let gender = "";
    if (p.ageSex) {
      const asParts = p.ageSex.split("/");
      if (asParts.length === 2) {
        age = asParts[0].trim();
        gender = asParts[1].trim();
      } else {
        age = p.ageSex;
      }
    }

    let latestDate = "N/A";
    const apt = patientAppointments[p.patient_id];
    if (apt) {
      const d = new Date(apt.appointment_date || apt.updated_at || apt.date);
      if (!isNaN(d.getTime())) {
        latestDate = d.toLocaleDateString();
      }
    } else if (latest && latest.date) {
      const d = new Date(latest.date);
      if (!isNaN(d.getTime())) {
        latestDate = d.toLocaleDateString();
      } else {
        latestDate = latest.date;
      }
    }

    return {
      patient_id: p.patient_id,
      name: p.name,
      age: age,
      gender: gender,
      latestAppointment: latestDate,
      treatmentStatus: latest?.status || "Pending",
      surgeriesCompleted
    };
  });

  const totalPatients = patients.length;
  const pending = patients.filter(p => p.treatmentStatus === "Pending").length;
  const inProgress = patients.filter(p => p.treatmentStatus === "In Progress").length;
  const completed = patients.filter(p => p.treatmentStatus === "Completed").length;
  const totalSurgeries = patients.reduce((acc, p) => acc + p.surgeriesCompleted, 0);

  const kpis = [
    { label: "Total Patients", value: totalPatients, note: "All active profiles" },
    { label: "Pending Treatment", value: pending, note: "Awaiting next steps" },
    { label: "In Progress", value: inProgress, note: "Currently undergoing treatment" },
    { label: "Treatment Completed", value: completed, note: "Finished protocols" },
    { label: "Total Surgeries", value: totalSurgeries, note: "Across all patients" }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <KPIGrid items={kpis} />
      <div style={{ maxHeight: "400px", overflowY: "auto", border: "1px solid var(--line)", background: "#fff" }}>
        <table className="so-report-table" style={{ border: "none" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#fff" }}>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Patient Name</th>
              <th style={{ width: 80 }}>Age</th>
              <th style={{ width: 100 }}>Gender</th>
              <th style={{ width: 180 }}>Latest Appointment</th>
              <th style={{ width: 180 }}>Treatment Status</th>
              <th style={{ width: 160, textAlign: "center" }}>Surgeries Completed</th>
            </tr>
          </thead>
          <tbody>
            {patients.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: "center", padding: "20px" }}>No active patients found.</td></tr>
            ) : (
              patients.map((p, i) => (
                <tr key={p.patient_id}>
                  <td>{i + 1}</td>
                  <td className="so-rn">{p.name}</td>
                  <td>{p.age}</td>
                  <td>{p.gender}</td>
                  <td>{p.latestAppointment}</td>
                  <td>{p.treatmentStatus}</td>
                  <td style={{ textAlign: "center" }}>{p.surgeriesCompleted}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QualityList({ items }) {
  return (
    <div className="so-qlist">
      {items.map((q, i) => {
        const hasValue = q.value != null;
        const pct = hasValue ? Math.min(100, Math.round((q.value / q.max) * 100)) : 0;
        const tpct = Math.min(100, Math.round((q.target / q.max) * 100));
        return (
          <div className="so-qrow" key={i}>
            <div className="so-qname">
              <div className="so-qt">
                {q.name}
              </div>
              <div className="so-qs">{q.desc}</div>
            </div>
            <div className="so-qbar-wrap">
              <div className="so-qbar-track">
                <div className="so-qbar-fill" style={{ width: `${pct}%` }} />
                <div className="so-qbar-target" style={{ left: `${tpct}%` }} />
              </div>
              <div className="so-qvals">
                <span>{hasValue ? `${q.value}${q.unit || ""}` : "None"}</span>
                <span>Target {q.target}{q.unit || ""}</span>
              </div>
            </div>
            <div className="so-qstatus">{q.status}</div>
          </div>
        );
      })}
    </div>
  );
}

function ReportLibrary({ allReports }) {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");

  const counts = { all: allReports.length, clinical: 0, research: 0, admin: 0 };
  allReports.forEach((r) => { counts[r.cat]++; });

  const cats = [
    ["all", "All Reports"],
    ["clinical", "Clinical"],
    ["research", "Research"],
    ["admin", "Administrative"],
  ];

  const query = q.trim().toLowerCase();
  const filtered = allReports.filter((r) => {
    if (cat !== "all" && r.cat !== cat) return false;
    if (query && !(r.name.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query))) return false;
    return true;
  });

  return (
    <div>
      <div className="so-filter-row">
        {cats.map(([key, label]) => (
          <button
            key={key}
            className={`so-filter-btn${cat === key ? " active" : ""}`}
            onClick={() => setCat(key)}
          >
            {label} ({counts[key] !== undefined ? counts[key] : 0})
          </button>
        ))}
        <input
          className="so-search-box"
          placeholder="Search reports..."
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="so-filter-count">
          {filtered.length} of {allReports.length} reports
        </span>
      </div>

      <table className="so-report-table">
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
              <td className="so-rn">{r.name}</td>
              <td>
                <span className={`so-cat-tag ${r.cat === "clinical" ? "clinical" : ""}`}>{r.cat}</span>
              </td>
              <td className="so-rdesc">{r.desc}</td>
              <td className="so-freq">{r.freq}</td>
              <td>{r.audience}</td>
              <td>{r.format}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main component ─── */
export default function SurgicalOncologyDashboard({ doctorId }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [bookings, setBookings] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch bookings for this doctor once.
  useEffect(() => {
    let cancelled = false;
    if (!doctorId) {
      setLoading(false);
      setError("No doctor selected.");
      return;
    }
    setLoading(true);
    setError(null);
    getBookings(doctorId)
      .then((res) => {
        if (cancelled) return;
        setBookings(Array.isArray(res?.bookings) ? res.bookings : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[SurgicalOncologyDashboard] getBookings error:", err);
        setError("Unable to load surgical data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doctorId]);

  // Compute the CONFIG-shaped dashboard object from real bookings.
  const data = useMemo(
    () => (bookings ? buildDashboardData(bookings) : null),
    [bookings]
  );

  const isActive = (id) => (activeTab === id ? " active" : "");

  return (
    <div className="so-dash">
      <style>{`
        .so-dash{ --bg:#ffffff; --panel:#ffffff; --line:#dcdcdc; --line-soft:#eeeeee; --ink:#111111; --ink-mid:#5a5a5a; --ink-light:#8f8f8f; --grey:#f4f4f4; --grey-mid:#e2e2e2; --grey-dark:#c9c9c9; --black:#000000;
          font-family:'Open Sans', sans-serif; font-weight:300; background:var(--bg); color:var(--ink); -webkit-font-smoothing:antialiased; letter-spacing:.1px; }
        .so-dash *{ box-sizing:border-box; }
        .so-dash h1,.so-dash h2,.so-dash h3,.so-dash h4{ font-weight:300; letter-spacing:.3px; margin:0; }
        .so-dash button{ font-family:inherit; cursor:pointer; border:none; background:none; font-weight:300; }
        .so-dash table{ border-collapse:collapse; width:100%; }
        .so-dash input,.so-dash select{ font-family:inherit; font-weight:300; }

        /* Tabs */
        .so-tabbar{ display:flex; gap:0; border-bottom:1px solid var(--line); overflow-x:auto; background:#fff; }
        .so-tab{ padding:16px 20px; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--ink-light); font-weight:400; white-space:nowrap; border-bottom:2px solid transparent; transition:color .15s, border-color .15s; }
        .so-tab:hover{ color:var(--ink); }
        .so-tab.active{ color:var(--ink); border-bottom-color:var(--ink); font-weight:600; }

        /* Content */
        .so-content{ padding:34px 4px 20px; }
        .so-view{ display:none; }
        .so-view.active{ display:block; }
        .so-section-head{ margin-bottom:18px; border-left:2px solid var(--ink); padding-left:14px; }
        .so-section-head h2{ font-size:20px; font-weight:300; }
        .so-section-head p{ font-size:12px; color:var(--ink-mid); margin-top:4px; max-width:820px; line-height:1.6; }

        /* Loading / empty states */
        .so-loading,.so-empty{ padding:40px 20px; text-align:center; font-size:13px; color:var(--ink-light); border:1px solid var(--line); background:#fff; }

        /* KPI grid */
        .so-kpi-grid{ display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:32px; }
        .so-kpi{ background:#fff; padding:20px 18px; }
        .so-kl{ font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:var(--ink-light); font-weight:400; }
        .so-kv{ font-size:28px; font-weight:200; margin-top:10px; }
        .so-kv sup{ font-size:13px; font-weight:400; margin-left:2px; }
        .so-kd{ font-size:10.5px; color:var(--ink-mid); margin-top:6px; }
        .so-kd.up::before{ content:'▲ '; font-size:9px; }
        .so-kd.down::before{ content:'▼ '; font-size:9px; }

        /* Panels / charts */
        .so-grid-2{ display:grid; grid-template-columns:1.4fr 1fr; gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:32px; }
        .so-grid-3{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:32px; }
        .so-panel{ background:#fff; padding:22px 24px; }
        .so-panel h3{ font-size:13px; font-weight:600; letter-spacing:.3px; }
        .so-panel-note{ font-size:10.5px; color:var(--ink-light); margin-top:3px; margin-bottom:14px; line-height:1.6; }
        .so-chart-box{ height:260px; position:relative; }
        .so-chart-box.short{ height:190px; }

        /* Report library */
        .so-filter-row{ display:flex; gap:10px; margin-bottom:18px; flex-wrap:wrap; align-items:center; }
        .so-filter-btn{ border:1px solid var(--line); padding:7px 16px; font-size:11px; letter-spacing:.6px; text-transform:uppercase; color:var(--ink-mid); }
        .so-filter-btn.active{ border-color:var(--ink); color:var(--ink); font-weight:600; }
        .so-filter-count{ font-size:11px; color:var(--ink-light); margin-left:auto; }
        .so-search-box{ border:1px solid var(--line); padding:7px 14px; font-size:12px; width:240px; color:var(--ink); }
        .so-report-table{ border:1px solid var(--line); font-size:12px; }
        .so-report-table thead th{ text-align:left; padding:12px 16px; font-size:9.5px; letter-spacing:1.2px; text-transform:uppercase; color:var(--ink-light); border-bottom:1px solid var(--ink); font-weight:600; background:#fff; }
        .so-report-table tbody td{ padding:13px 16px; border-bottom:1px solid var(--line-soft); vertical-align:top; color:var(--ink-mid); }
        .so-report-table tbody tr:last-child td{ border-bottom:none; }
        .so-report-table tbody tr:hover{ background:var(--grey); }
        .so-rn{ color:var(--ink); font-weight:600; }
        .so-rdesc{ font-size:11.5px; line-height:1.55; max-width:400px; }
        .so-cat-tag{ display:inline-block; border:1px solid var(--grey-dark); padding:2px 9px; font-size:9.5px; letter-spacing:.8px; text-transform:uppercase; color:var(--ink-mid); }
        .so-cat-tag.clinical{ border-color:var(--ink); }
        .so-freq{ font-size:11px; white-space:nowrap; }

        /* Quality list */
        .so-qlist{ border:1px solid var(--line); }
        .so-qrow{ display:flex; align-items:center; gap:18px; padding:16px 20px; border-bottom:1px solid var(--line-soft); }
        .so-qrow:last-child{ border-bottom:none; }
        .so-qname{ flex:1.4; }
        .so-qt{ font-size:13px; font-weight:600; }
        .so-qs{ font-size:10.5px; color:var(--ink-light); margin-top:2px; }
        .so-qbar-wrap{ flex:2; }
        .so-qbar-track{ height:5px; background:var(--grey); position:relative; }
        .so-qbar-fill{ height:100%; background:var(--ink); }
        .so-qbar-target{ position:absolute; top:-3px; width:1px; height:11px; background:var(--ink-mid); }
        .so-qvals{ display:flex; justify-content:space-between; font-size:10px; color:var(--ink-light); margin-top:5px; }
        .so-qstatus{ width:110px; text-align:right; font-size:10px; letter-spacing:1px; text-transform:uppercase; font-weight:600; }

        /* Report cards */
        .so-card-list{ display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--line); border:1px solid var(--line); }
        .so-rcard{ background:#fff; padding:18px 20px; }
        .so-rc-top{ display:flex; justify-content:space-between; gap:10px; }
        .so-rcard h4{ font-size:12.5px; font-weight:600; }
        .so-rc-desc{ font-size:11.5px; color:var(--ink-mid); line-height:1.6; margin-top:6px; }
        .so-rc-meta{ display:flex; gap:16px; margin-top:12px; font-size:10px; color:var(--ink-light); text-transform:uppercase; letter-spacing:.5px; }

        @media (max-width:1180px){
          .so-kpi-grid{ grid-template-columns:repeat(3,1fr); }
          .so-grid-2,.so-grid-3{ grid-template-columns:1fr; }
          .so-card-list{ grid-template-columns:1fr; }
        }
        @media (max-width:640px){
          .so-kpi-grid{ grid-template-columns:repeat(2,1fr); }
        }
      `}</style>

      <nav className="so-tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`so-tab${isActive(t.id)}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="so-content">
        {/* Overview */}
        <section className={`so-view${isActive("overview")}`}>
          <div className="so-section-head">
            <h2>{CONFIG.overview.title}</h2>
            <p>{CONFIG.overview.desc}</p>
          </div>

          {loading && <div className="so-loading">Loading surgical data…</div>}
          {!loading && error && <div className="so-empty">{error}</div>}
          {!loading && !error && data && data.meta.totalBookings === 0 && (
            <div className="so-empty">No surgical bookings found for this doctor yet.</div>
          )}

          {!loading && !error && data && data.meta.totalBookings > 0 && (
            <>
              <KPIGrid items={data.kpis} />
              <div className="so-grid-2">
                <Panel title={data.chart1.title} note={data.chart1.note} chart={data.chart1} />
                <Panel title={data.chart2.title} note={data.chart2.note} chart={data.chart2} />
              </div>
              <div className="so-grid-3">
                {data.mini.map((m, idx) => (
                  <Panel key={idx} title={m.title} note={m.note} chart={m} short />
                ))}
              </div>
            </>
          )}
        </section>

        {/* Clinical */}
        <section className={`so-view${isActive("clinical")}`}>
          <div className="so-section-head">
            <h2>Daily Active Patients</h2>
            <p>{CONFIG.clinicalDesc}</p>
          </div>
          {loading && <div className="so-loading">Loading patient data…</div>}
          {!loading && error && <div className="so-empty">{error}</div>}
          {!loading && !error && <DailyActivePatientsTable bookings={bookings} doctorId={doctorId} />}
        </section>

        {/* Research */}
        <section className={`so-view${isActive("research")}`}>
          <div className="so-section-head">
            <h2>Research &amp; Academic Reports</h2>
            <p>{CONFIG.researchDesc}</p>
          </div>
          <CardList reports={CONFIG.reports.filter((r) => r.cat === "research")} />
        </section>

        {/* Admin */}
        <section className={`so-view${isActive("admin")}`}>
          <div className="so-section-head">
            <h2>Administrative &amp; Operational Reports</h2>
            <p>{CONFIG.adminDesc}</p>
          </div>
          <CardList reports={CONFIG.reports.filter((r) => r.cat === "admin")} />
        </section>

        {/* Quality */}
        <section className={`so-view${isActive("quality")}`}>
          <div className="so-section-head">
            <h2>Quality &amp; Safety Indicators</h2>
            <p>{CONFIG.qualityDesc}</p>
          </div>
          {loading && <div className="so-loading">Loading surgical data…</div>}
          {!loading && error && <div className="so-empty">{error}</div>}
          {!loading && !error && data && data.meta.totalBookings === 0 && (
            <div className="so-empty">No surgical bookings found for this doctor yet.</div>
          )}
          {!loading && !error && data && data.meta.totalBookings > 0 && (
            <QualityList items={data.quality} />
          )}
        </section>

        {/* Library */}
        <section className={`so-view${isActive("library")}`}>
          <div className="so-section-head">
            <h2>Reports Library</h2>
            <p>
              Complete catalogue of clinical, research and administrative reports maintained for{" "}
              {CONFIG.deptName}. Filter by category or search by keyword.
            </p>
          </div>
          <ReportLibrary allReports={CONFIG.reports} />
        </section>
      </main>
    </div>
  );
}
