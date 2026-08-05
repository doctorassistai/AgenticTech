import React, { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const ConsultationDataTab = ({ patientId, doctorId }) => {
  const [reports, setReports] = useState([]);
  const [filteredReports, setFilteredReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
  const [availableDates, setAvailableDates] = useState([]);
  const [expandedReport, setExpandedReport] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});

  const API_BASE = import.meta.env.VITE_BACKEND_URL;

  /* ── fetch ── */
  useEffect(() => {
    const fetchReports = async () => {
      try {
        const res = await fetch(
          `${API_BASE}hms/users/orchestration/patient/${patientId}/consultations`
        );
        const rawData = await res.json();
        const reportsArray = Array.isArray(rawData)
          ? rawData
          : rawData?.data || rawData?.consultations || [];
        const sortedData = reportsArray.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
        setReports(sortedData);
        const uniqueDates = [
          ...new Set(
            sortedData.map((r) => new Date(r.created_at).toISOString().split("T")[0])
          ),
        ].slice(0, 5);
        setAvailableDates(uniqueDates);
        if (uniqueDates.length > 0) setSelectedDate(uniqueDates[0]);
      } catch (err) {
        console.error("Error fetching reports:", err);
      } finally {
        setLoading(false);
      }
    };
    if (patientId) fetchReports();
  }, [patientId]);

  useEffect(() => {
    if (selectedDate && reports.length > 0) {
      setFilteredReports(
        reports.filter(
          (r) => new Date(r.created_at).toISOString().split("T")[0] === selectedDate
        )
      );
    } else {
      setFilteredReports(reports);
    }
  }, [selectedDate, reports]);

  const toggleReport = (id) =>
    setExpandedReport(expandedReport === id ? null : id);

  const toggleSection = (reportId, section) =>
    setExpandedSections((prev) => ({
      ...prev,
      [reportId]: { ...prev[reportId], [section]: !prev[reportId]?.[section] },
    }));

  const formatDate = (ds) =>
    new Date(ds).toLocaleDateString("en-US", {
      day: "2-digit", month: "short", year: "numeric",
    });

  const formatTime = (ds) =>
    new Date(ds + "Z").toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

  const getCount = (date) =>
    reports.filter(
      (r) => new Date(r.created_at).toISOString().split("T")[0] === date
    ).length;

  /* ── loading ── */
  if (loading) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={S.center}>
          <div className="cd-spin" />
          <p style={{ color: "#888", fontSize: 13, fontWeight: 300, fontFamily: "Open Sans" }}>
            Loading medical records…
          </p>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════ */
  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* ── PAGE HEADER ── */}
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>Medical Consultation Records</h1>
          <p style={S.pageSub}>Complete patient consultation history and clinical documentation</p>
        </div>
      </div>

      {/* ── DATE TABS ── */}
      {availableDates.length > 0 && (
        <div style={S.dateTabs}>
          <span style={S.dateTabsLabel}>Visit History</span>
          <div style={S.dateTabList}>
            {availableDates.map((date) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`cd-tab${selectedDate === date ? " cd-tab-active" : ""}`}
              >
                {formatDate(date)}
                <span className={`cd-count${selectedDate === date ? " cd-count-active" : ""}`}>
                  {getCount(date)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── EMPTY ── */}
      {filteredReports.length === 0 && (
        <div style={S.empty}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" style={{ marginBottom: 12 }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p style={{ fontSize: 14, fontWeight: 400, color: "#000", marginBottom: 4 }}>
            No Consultation Records
          </p>
          <p style={{ color: "#888", fontSize: 12, fontWeight: 300 }}>
            No records available for the selected date.
          </p>
        </div>
      )}

      {/* ── REPORTS ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "#e0e0e0", border: filteredReports.length ? "1px solid #e0e0e0" : "none" }}>
        {filteredReports.map((report) => {
          const data = report.clinical_data || {};
          const isExpanded = expandedReport === report.report_id;
          const secs = expandedSections[report.report_id] || {};

          return (
            <div key={report.report_id} style={{ background: "#fff" }}>

              {/* ── REPORT ROW HEADER ── */}
              <div
                style={S.reportHeader}
                onClick={() => toggleReport(report.report_id)}
                className="cd-row"
              >
                <div style={S.reportHeaderLeft}>
                  {/* Date block */}
                  <div style={S.dateBadge}>
                    <span style={S.dateMain}>{formatDate(report.created_at)}</span>
                    <span style={S.dateTime}>{formatTime(report.created_at)}</span>
                  </div>

                  {/* Diagnosis preview */}
                  <div style={S.diagPreview}>
                    <span style={S.sectionLabel}>PRIMARY DIAGNOSIS</span>
                    <span style={{ fontSize: 13, fontWeight: 400, color: "#000" }}>
                      {data.primary_diagnosis || "Diagnosis pending"}
                    </span>
                  </div>

                  {/* Counters */}
                  <div style={S.reportCounters}>
                    {data.prescriptions?.length > 0 && (
                      <span className="cd-badge">{data.prescriptions.length} Rx</span>
                    )}
                    {data.investigations?.length > 0 && (
                      <span className="cd-badge">{data.investigations.length} Inv</span>
                    )}
                    {data.soap_note && Object.values(data.soap_note).some((v) => v) && (
                      <span className="cd-badge">SOAP</span>
                    )}
                  </div>
                </div>

                <button className="cd-expand-btn" aria-label={isExpanded ? "Collapse" : "Expand"}>
                  {isExpanded ? "−" : "+"}
                </button>
              </div>

              {/* ── REPORT BODY ── */}
              {isExpanded && (
                <div style={S.reportBody}>

                  {/* Clinical Assessment */}
                  <div style={S.section}>
                    <div
                      style={S.sectionHeader}
                      onClick={() => toggleSection(report.report_id, "clinical")}
                      className="cd-section-toggle"
                    >
                      <span style={S.sectionTitle}>Clinical Assessment</span>
                      <span style={S.toggleIcon}>{secs.clinical ? "−" : "+"}</span>
                    </div>

                    {secs.clinical && (
                      <div style={S.sectionContent}>
                        <div style={S.infoGrid}>
                          <InfoItem label="Primary Diagnosis" value={data.primary_diagnosis || "Not specified"} />

                          {data.differential_diagnoses?.length > 0 && (
                            <div style={S.infoItem}>
                              <span style={S.sectionLabel}>DIFFERENTIAL DIAGNOSES</span>
                              <div style={S.pillRow}>
                                {data.differential_diagnoses.map((d, i) => (
                                  <span key={i} className="cd-pill cd-pill-dark">{d}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {data.symptoms?.length > 0 && (
                            <div style={S.infoItem}>
                              <span style={S.sectionLabel}>SYMPTOMS</span>
                              <div style={S.pillRow}>
                                {data.symptoms.map((s, i) => (
                                  <span key={i} className="cd-pill">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {data.clinical_findings?.length > 0 && (
                            <div style={S.infoItem}>
                              <span style={S.sectionLabel}>CLINICAL FINDINGS</span>
                              <div style={S.pillRow}>
                                {data.clinical_findings.map((f, i) => (
                                  <span key={i} className="cd-pill">{f}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {data.clinical_assessment && (
                            <InfoItem label="Assessment" value={data.clinical_assessment} />
                          )}
                          {data.treatment_plan && (
                            <InfoItem label="Treatment Plan" value={data.treatment_plan} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prescriptions */}
                  {data.prescriptions?.length > 0 && (
                    <div style={S.section}>
                      <div
                        style={S.sectionHeader}
                        onClick={() => toggleSection(report.report_id, "prescriptions")}
                        className="cd-section-toggle"
                      >
                        <span style={S.sectionTitle}>
                          Prescriptions
                          <span style={S.sectionCount}>{data.prescriptions.length}</span>
                        </span>
                        <span style={S.toggleIcon}>{secs.prescriptions ? "−" : "+"}</span>
                      </div>

                      {secs.prescriptions && (
                        <div style={S.sectionContent}>
                          <div style={S.rxGrid}>
                            {data.prescriptions.map((med, i) => (
                              <div key={i} style={S.rxCard}>
                                <div style={S.rxName}>{med.medicine_name}</div>
                                <div style={S.rxRows}>
                                  {[
                                    ["Strength",   med.strength],
                                    ["Dosage",     med.dosage],
                                    ["Frequency",  med.frequency],
                                    ["Route",      med.route],
                                    ["Duration",   med.duration],
                                  ].filter(([, v]) => v).map(([label, value]) => (
                                    <div key={label} style={S.rxRow}>
                                      <span style={S.rxLabel}>{label}</span>
                                      <span style={S.rxValue}>{value}</span>
                                    </div>
                                  ))}
                                </div>
                                {med.special_instructions && (
                                  <div style={S.rxNote}>
                                    <span style={{ fontWeight: 400 }}>Note:</span> {med.special_instructions}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Investigations */}
                  {data.investigations?.length > 0 && (
                    <div style={S.section}>
                      <div
                        style={S.sectionHeader}
                        onClick={() => toggleSection(report.report_id, "investigations")}
                        className="cd-section-toggle"
                      >
                        <span style={S.sectionTitle}>
                          Investigations
                          <span style={S.sectionCount}>{data.investigations.length}</span>
                        </span>
                        <span style={S.toggleIcon}>{secs.investigations ? "−" : "+"}</span>
                      </div>

                      {secs.investigations && (
                        <div style={S.sectionContent}>
                          <div style={S.rxGrid}>
                            {data.investigations.map((inv, i) => (
                              <div key={i} style={S.rxCard}>
                                <div style={S.rxName}>{inv.test_name}</div>
                                <div style={S.rxRows}>
                                  {inv.category && (
                                    <div style={S.rxRow}>
                                      <span style={S.rxLabel}>Category</span>
                                      <span style={S.rxValue}>{inv.category}</span>
                                    </div>
                                  )}
                                  {inv.urgency && (
                                    <div style={S.rxRow}>
                                      <span style={S.rxLabel}>Priority</span>
                                      <span className="cd-urgency">{inv.urgency}</span>
                                    </div>
                                  )}
                                </div>
                                {inv.clinical_reason && (
                                  <div style={S.rxNote}>{inv.clinical_reason}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SOAP */}
                  {data.soap_note && Object.values(data.soap_note).some((v) => v) && (
                    <div style={{ ...S.section, marginBottom: 0 }}>
                      <div
                        style={S.sectionHeader}
                        onClick={() => toggleSection(report.report_id, "soap")}
                        className="cd-section-toggle"
                      >
                        <span style={S.sectionTitle}>SOAP Documentation</span>
                        <span style={S.toggleIcon}>{secs.soap ? "−" : "+"}</span>
                      </div>

                      {secs.soap && (
                        <div style={S.sectionContent}>
                          <div style={S.soapGrid}>
                            {[
                              ["Subjective",  data.soap_note.subjective],
                              ["Objective",   data.soap_note.objective],
                              ["Assessment",  data.soap_note.assessment],
                              ["Plan",        data.soap_note.plan],
                            ].filter(([, v]) => v).map(([label, value]) => (
                              <div key={label} style={S.soapCell}>
                                <div style={S.soapLabel}>{label.toUpperCase()}</div>
                                <div style={S.soapValue}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── Helper ── */
const InfoItem = ({ label, value }) => (
  <div style={S.infoItem}>
    <span style={S.sectionLabel}>{label.toUpperCase()}</span>
    <span style={{ fontSize: 13, color: "#000", fontWeight: 300, lineHeight: 1.6 }}>{value}</span>
  </div>
);

/* ── Style tokens ── */
const S = {
  page: {
    maxWidth: 1280, margin: "0 auto", padding: "28px 24px",
    fontFamily: "'Open Sans', sans-serif", fontWeight: 300,
    background: "#fafafa", minHeight: "100vh", color: "#000",
  },
  center: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: 400,
  },
  pageHeader: {
    marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #000",
  },
  pageTitle: {
    margin: "0 0 4px", fontSize: 20, fontWeight: 400, color: "#000",
    letterSpacing: "-0.02em", fontFamily: "'Open Sans', sans-serif",
  },
  pageSub: {
    color: "#888", fontSize: 12, margin: 0, fontWeight: 300, letterSpacing: "0.01em",
  },

  /* date tabs */
  dateTabs: {
    marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
  },
  dateTabsLabel: {
    fontSize: 9, color: "#888", letterSpacing: "0.18em", textTransform: "uppercase",
    fontFamily: "'Open Sans', sans-serif", fontWeight: 400, whiteSpace: "nowrap",
  },
  dateTabList: { display: "flex", gap: 1, background: "#e0e0e0", border: "1px solid #e0e0e0" },

  /* report row */
  reportHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 18px", cursor: "pointer", borderBottom: "1px solid #f0f0f0",
    background: "#fff",
  },
  reportHeaderLeft: {
    display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
  },
  dateBadge: {
    display: "flex", flexDirection: "column", gap: 2, minWidth: 110,
  },
  dateMain: {
    fontSize: 12, fontWeight: 400, color: "#000", letterSpacing: "-0.01em",
  },
  dateTime: {
    fontSize: 10, color: "#888", letterSpacing: "0.05em", textTransform: "uppercase",
  },
  diagPreview: {
    display: "flex", flexDirection: "column", gap: 2,
  },
  reportCounters: { display: "flex", gap: 6, alignItems: "center" },

  /* report body */
  reportBody: { padding: "16px 18px 20px", background: "#fff" },

  /* section */
  section: { marginBottom: 20 },
  sectionHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 0", borderBottom: "1px solid #e0e0e0", cursor: "pointer",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: 400, color: "#000", fontFamily: "'Open Sans', sans-serif",
    display: "flex", alignItems: "center", gap: 8,
  },
  sectionCount: {
    fontSize: 10, color: "#888", border: "1px solid #e0e0e0",
    padding: "1px 6px", letterSpacing: "0.05em",
  },
  toggleIcon: { fontSize: 14, color: "#888", fontWeight: 300, userSelect: "none" },
  sectionContent: { animation: "cd-fadeIn 0.2s ease" },
  sectionLabel: {
    fontSize: 9, color: "#888", letterSpacing: "0.15em",
    textTransform: "uppercase", fontFamily: "'Open Sans', sans-serif", fontWeight: 400,
  },

  /* info grid */
  infoGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14, padding: "12px 14px", background: "#fafafa", border: "1px solid #e0e0e0",
  },
  infoItem: { display: "flex", flexDirection: "column", gap: 5 },
  pillRow: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 },

  /* prescription / investigation grid */
  rxGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 1, background: "#e0e0e0", border: "1px solid #e0e0e0",
  },
  rxCard: { background: "#fff", padding: "12px 14px" },
  rxName: {
    fontSize: 12, fontWeight: 400, color: "#000", marginBottom: 10,
    paddingBottom: 8, borderBottom: "1px solid #e0e0e0",
  },
  rxRows: { display: "flex", flexDirection: "column", gap: 6 },
  rxRow: { display: "flex", alignItems: "baseline", gap: 8 },
  rxLabel: { fontSize: 10, color: "#888", minWidth: 60, letterSpacing: "0.03em", fontWeight: 400 },
  rxValue: { fontSize: 11, color: "#000", fontWeight: 400 },
  rxNote: {
    marginTop: 10, padding: "8px 10px", background: "#fafafa",
    borderLeft: "2px solid #000", fontSize: 11, color: "#444",
    fontWeight: 300, lineHeight: 1.6,
  },

  /* SOAP */
  soapGrid: {
    display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
    gap: 1, background: "#e0e0e0", border: "1px solid #e0e0e0",
  },
  soapCell: { background: "#fff", padding: "12px 14px" },
  soapLabel: {
    fontSize: 9, fontWeight: 400, color: "#888", marginBottom: 7,
    textTransform: "uppercase", letterSpacing: "0.15em",
    fontFamily: "'Open Sans', sans-serif",
  },
  soapValue: { fontSize: 12, color: "#000", lineHeight: 1.7, fontWeight: 300 },

  empty: {
    textAlign: "center", padding: "56px 32px", background: "#fff",
    border: "1px solid #e0e0e0", display: "flex",
    flexDirection: "column", alignItems: "center",
  },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #ccc; }

  @keyframes cd-fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes cd-spinK  { to { transform: rotate(360deg); } }

  .cd-spin {
    width: 28px; height: 28px;
    border: 2px solid #e0e0e0; border-top-color: #000;
    border-radius: 50%; animation: cd-spinK 0.9s linear infinite;
    margin-bottom: 12px;
  }

  /* date tabs */
  .cd-tab {
    padding: 7px 14px; background: #fff; border: none;
    font-size: 11px; font-weight: 400; font-family: 'Open Sans', sans-serif;
    color: #444; cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; gap: 8px;
    letter-spacing: 0.02em;
  }
  .cd-tab:hover { background: #f5f5f5; color: #000; }
  .cd-tab-active { background: #000 !important; color: #fff !important; }

  .cd-count {
    font-size: 9px; background: #f0f0f0; color: #888;
    padding: 1px 6px; letter-spacing: 0.08em;
    font-family: 'Open Sans', sans-serif;
  }
  .cd-count-active { background: rgba(255,255,255,0.2); color: #fff; }

  /* report row hover */
  .cd-row:hover { background: #fafafa !important; }

  /* expand button */
  .cd-expand-btn {
    width: 28px; height: 28px; background: #fafafa;
    border: 1px solid #e0e0e0; color: #888;
    font-size: 14px; font-weight: 300; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Open Sans', sans-serif; transition: all 0.15s; flex-shrink: 0;
  }
  .cd-expand-btn:hover { border-color: #000; color: #000; }

  /* section toggle hover */
  .cd-section-toggle:hover { opacity: 0.7; }

  /* badges */
  .cd-badge {
    font-size: 9px; color: #888; border: 1px solid #e0e0e0;
    padding: 2px 7px; font-family: 'Open Sans', sans-serif;
    letter-spacing: 0.08em; text-transform: uppercase; font-weight: 400;
    background: #fafafa;
  }

  /* pills */
  .cd-pill {
    font-size: 11px; color: #444; background: #fafafa;
    border: 1px solid #e0e0e0; padding: 2px 9px; font-weight: 300;
    font-family: 'Open Sans', sans-serif;
  }
  .cd-pill-dark { background: #000; color: #fff; border-color: #000; }

  /* urgency */
  .cd-urgency {
    font-size: 9px; font-weight: 400; font-family: 'Open Sans', sans-serif;
    letter-spacing: 0.1em; text-transform: uppercase;
    border: 1px solid #000; padding: 1px 7px; color: #000; background: #fff;
  }
`;

export default ConsultationDataTab;