import React, { useEffect, useState } from "react";
import { RefreshCw, Mic, Square, FileText, ChevronDown, ChevronUp } from "lucide-react";
import LongitudinalSummaryTab from "./LongitudinalSummaryTab";
const API_BASE_URL =
  "https://doctorassist.ai/api/";

/* ─────────────────────────────────────────
   THEME TOKENS  (doctorassist.ai website)
───────────────────────────────────────── */
import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const T = {
  bg: theme.bg,
  bgAlt: theme.bgAlt,
  bgTert: theme.bgTert,

  text: theme.text,
  textSec: theme.textSec,
  textMuted: theme.textMuted,

  sec: theme.sec,

  border: theme.border,
  borderStr: theme.borderStr,

  accent: theme.accent,
  accentHover: theme.accentHover,
  accentLight: theme.accentLight,

  success: theme.success,
  warning: theme.warning,
  danger: theme.danger,
  info: theme.info,

  font: theme.font || "'Open Sans', sans-serif",
};

/* ─────────────────────────────────────────
   GLOBAL CSS
───────────────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; color: ${T.text}; font-family: ${T.font}; -webkit-font-smoothing: antialiased; }
  ::selection { background: #000; color: #fff; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: ${T.bgAlt}; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; }
  .da-tab-btn { cursor: pointer; border: none; background: none; font-family: ${T.font}; transition: all 0.15s; white-space: nowrap; padding: 0; }
  .da-tab-btn:hover { color: ${T.text} !important; }
  .da-tbl-row:hover td { background: ${T.bgAlt} !important; }
  .da-card:hover { border-color: ${T.borderStr} !important; }
  .da-action-btn:hover { background: transparent !important; color: ${T.text} !important; }
  .da-link-btn { cursor: pointer; border: none; background: none; font-family: ${T.font}; }
  .fade-in { animation: da-fadeup 0.2s ease forwards; }
  @keyframes da-fadeup { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes da-spin { to { transform: rotate(360deg); } }
`;

/* ─────────────────────────────────────────
   MICRO COMPONENTS
───────────────────────────────────────── */

/* Badge — replaces colored Tag */
function Badge({ label, accent }) {
  if (label === undefined || label === null || label === "") return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "0.18rem 0.5rem",
      border: `1px solid ${accent ? T.borderStr : T.border}`,
      fontSize: "0.6rem", fontWeight: 400,
      textTransform: "uppercase", letterSpacing: "0.08em",
      color: accent ? T.text : T.textMuted,
      whiteSpace: "nowrap", fontFamily: T.font,
      background: T.bg,
    }}>{label}</span>
  );
}

/* Flat card */
function Card({ children, style, accentLeft }) {
  return (
    <div className="da-card" style={{
      background: T.bg,
      border: `1px solid ${T.border}`,
      padding: "1rem 1.25rem",
      borderLeft: accentLeft ? `2px solid ${T.borderStr}` : `1px solid ${T.border}`,
      transition: "border-color 0.15s",
      ...style,
    }}>{children}</div>
  );
}

/* Section label */
function SecLabel({ children }) {
  return (
    <div style={{
      fontSize: "0.6rem", fontWeight: 400,
      textTransform: "uppercase", letterSpacing: "0.18em",
      color: T.textMuted, marginBottom: "0.75rem",
      fontFamily: T.font,
    }}>{children}</div>
  );
}

/* Empty state */
function EmptyState({ msg }) {
  return (
    <div style={{ textAlign: "center", padding: "3rem 1.25rem", color: T.textMuted, fontSize: "0.78rem", fontWeight: 300 }}>
      <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem", opacity: 0.3 }}>—</div>
      {msg || "No data available"}
    </div>
  );
}

/* Divider */
function Divider() {
  return <div style={{ height: "1px", background: T.border, margin: "1.25rem 0" }} />;
}

/* Stat counter box */
function Counter({ n, label }) {
  return (
    <div style={{
      flex: 1, minWidth: 80,
      background: T.bgAlt, border: `1px solid ${T.border}`,
      padding: "0.875rem 1rem", textAlign: "center",
    }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 300, letterSpacing: "-0.04em", color: T.text, lineHeight: 1 }}>{n ?? "—"}</div>
      <div style={{ fontSize: "0.58rem", color: T.textMuted, marginTop: "0.35rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
    </div>
  );
}

/* Inline callout */
function Callout({ label, children }) {
  return (
    <div style={{
      borderLeft: `2px solid ${T.borderStr}`,
      padding: "0.875rem 1.25rem",
      background: T.bgAlt,
      marginBottom: "1rem",
    }}>
      {label && (
        <span style={{
          fontSize: "0.6rem", textTransform: "uppercase",
          letterSpacing: "0.15em", color: T.textMuted,
          fontWeight: 400, display: "block", marginBottom: "0.35rem",
        }}>{label}</span>
      )}
      {children}
    </div>
  );
}

/* Render text that may contain **bold** markdown segments (used for
   confirmed-diagnosis bolding coming from the clinical summary agent) */
function MarkdownBoldText({ text }) {
  if (!text) return null;
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

/* ─────────────────────────────────────────
   TAB: Clinical Summary
   Backend shape: data.summary = {
     diagnosis_header, confirmed_diagnosis_present, confirmed_diagnoses,
     paragraphs: string[] (may contain **bold** markers), full_text
   }
───────────────────────────────────────── */
function ClinicalSummaryTab({ data }) {
  const summarySrc = data?.summary;

  const [editMode, setEditMode] = useState(false);
  const [paragraphs, setParagraphs] = useState([]);
  const [recordingIndex, setRecordingIndex] = useState(null);

  useEffect(() => {
    if (!data?.summary) return;
    setParagraphs(Array.isArray(data.summary.paragraphs) ? [...data.summary.paragraphs] : []);
  }, [data]);

  const handleChange = (idx, value) => {
    setParagraphs(prev => prev.map((p, i) => (i === idx ? value : p)));
  };

  const handleAddParagraph = () => {
    setParagraphs(prev => [...prev, ""]);
  };

  const handleSave = async () => {
    try {
      const full_text = paragraphs.filter(p => p && p.trim()).join("\n\n");
      await fetch(`${API_BASE_URL}hms/users/data/context/update-clinical-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: data.patient_id,
          content: { paragraphs, full_text },
        }),
      });
      setEditMode(false);
    } catch (err) {
      console.error("Save failed", err);
    }
  };

  const startVoiceForField = async (idx) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const formData = new FormData();
          formData.append("file", blob);

          const res = await fetch(
            `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`,
            { method: "POST", body: formData }
          );

          const resData = await res.json();

          setParagraphs(prev => prev.map((p, i) =>
            i === idx ? `${p || ""} ${resData?.text || ""}` : p
          ));
        } catch (err) {
          console.error(err);
        }
        setRecordingIndex(null);
      };

      recorder.start();
      setRecordingIndex({ idx, recorder });
    } catch (err) {
      console.error(err);
    }
  };

  const stopVoiceRecording = () => {
    if (!recordingIndex?.recorder) return;
    recordingIndex.recorder.stop();
    recordingIndex.recorder.stream.getTracks().forEach((track) => track.stop());
  };

  const has = paragraphs.length > 0;
  if (!has) return <EmptyState msg="Clinical summary not yet generated" />;

  const diagnosisHeader = summarySrc?.diagnosis_header;
  const confirmedPresent = !!summarySrc?.confirmed_diagnosis_present;
  const confirmedList = summarySrc?.confirmed_diagnoses ?? [];

  return (
    <div>
      {diagnosisHeader && diagnosisHeader !== "Not documented" && (
        <Callout label={confirmedPresent ? "Confirmed Diagnosis" : "Working Diagnosis"}>
          <div style={{ fontSize: "0.88rem", color: T.text, fontWeight: 400, lineHeight: 1.6 }}>
            <MarkdownBoldText text={diagnosisHeader} />
          </div>
          {confirmedPresent && confirmedList.length > 1 && (
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {confirmedList.map((d, i) => (
                <Badge key={i} label={d} accent />
              ))}
            </div>
          )}
        </Callout>
      )}

      <Card>
        {/* ACTION BAR */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginBottom: "1rem" }}>
          {!editMode ? (
            <button className="da-action-btn" onClick={() => setEditMode(true)}>
              Edit
            </button>
          ) : (
            <>
              <button className="da-action-btn" onClick={handleAddParagraph}>
                + Add Paragraph
              </button>
              <button className="da-action-btn" onClick={handleSave}>
                Save
              </button>
            </>
          )}
        </div>

        <div style={{ fontSize: "0.85rem", lineHeight: 1.8, color: T.textSec, fontWeight: 300 }}>
          {paragraphs.map((text, idx) => (
            <div key={idx} style={{ marginBottom: "0.875rem" }}>
              {editMode ? (
                <div style={{ position: "relative" }}>
                  <textarea
                    value={text || ""}
                    onChange={(e) => handleChange(idx, e.target.value)}
                    style={{
                      width: "100%",
                      minHeight: "80px",
                      border: `1px solid ${T.border}`,
                      padding: "0.5rem",
                      paddingRight: "45px",
                      fontFamily: T.font,
                      fontSize: "0.82rem",
                    }}
                  />
                  <button
                    onClick={() => {
                      if (recordingIndex?.idx === idx) {
                        stopVoiceRecording();
                      } else {
                        startVoiceForField(idx);
                      }
                    }}
                    style={{
                      position: "absolute",
                      top: "10px",
                      right: "10px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {recordingIndex?.idx === idx ? <Square size={18} /> : <Mic size={18} />}
                  </button>
                </div>
              ) : (
                <p><MarkdownBoldText text={text} /></p>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────
   TAB: Timeline
   Backend shape: data.timeline = {
     timeline: [{
       date,
       documents: ["doc name", ...],
       narrative: "Sentence-style paragraph summarizing this date's findings",
       entity_types: [{ entity_type, entities: [{name, relation, evidence, source_document}] }]
     }],   // ordered LATEST DATE FIRST
     undated: [{ entity_type, entities: [{name, relation, evidence, source_document}] }],
     date_range: {
       earliest_date, latest_date, total_dates,
       total_dated_entities, total_undated_entities
     },
     completeness_check: { all_entities_included, notes }
   }
───────────────────────────────────────── */
function DetailedFindings({ entityTypes }) {
  const [open, setOpen] = useState(false);
  if (!entityTypes || entityTypes.length === 0) return null;

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <button
        className="da-link-btn"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: "4px",
          fontSize: "0.68rem", color: T.textMuted,
          textTransform: "uppercase", letterSpacing: "0.08em",
          cursor: "pointer", padding: 0,
        }}
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {open ? "Hide detailed findings" : "View detailed findings"}
      </button>

      {open && (
        <div style={{ marginTop: "0.65rem" }}>
          {entityTypes.map((group, gi) => {
            const entities = group.entities ?? [];
            return (
              <div key={gi} style={{ marginBottom: gi < entityTypes.length - 1 ? "0.75rem" : 0 }}>
                <div style={{ marginBottom: "0.4rem" }}>
                  <Badge label={group.entity_type} />
                </div>
                {entities.map((ent, ei) => (
                  <div key={ei} style={{
                    padding: "0.4rem 0",
                    borderBottom: ei < entities.length - 1 ? `1px solid ${T.border}` : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", flexWrap: "wrap", marginBottom: "2px" }}>
                      <span style={{ fontSize: "0.76rem", fontWeight: 400, color: T.text }}>{ent.name}</span>
                      {ent.relation && <span style={{ fontSize: "0.6rem", color: T.textMuted }}>({ent.relation})</span>}
                    </div>
                    {ent.evidence && (
                      <div style={{ fontSize: "0.68rem", color: T.textSec, lineHeight: 1.5, fontWeight: 300 }}>{ent.evidence}</div>
                    )}
                    {ent.source_document && (
                      <div style={{ fontSize: "0.6rem", color: T.textMuted, marginTop: "2px" }}>{ent.source_document}</div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateEntry({ day, isLast }) {
  const documents = day.documents ?? [];
  const entityTypes = day.entity_types ?? [];

  return (
    <div style={{ display: "flex", gap: "1rem", paddingBottom: "1.25rem" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 16 }}>
        <div style={{ width: 8, height: 8, border: `1px solid ${T.borderStr}`, background: T.bg, marginTop: 4, flexShrink: 0 }} />
        {!isLast && <div style={{ flex: 1, width: 1, background: T.border, marginTop: 4 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.6rem", flexWrap: "wrap" }}>
          <Badge label={day.date} accent />
        </div>

        <Card>
          {documents.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "0.65rem", flexWrap: "wrap" }}>
              <FileText size={13} style={{ color: T.textMuted, marginTop: "2px", flexShrink: 0 }} />
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {documents.map((doc, di) => (
                  <span key={di} style={{ fontSize: "0.68rem", color: T.textSec, fontWeight: 300 }}>
                    {doc}{di < documents.length - 1 ? " ·" : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p
            style={{
              fontSize: "0.82rem",
              color: T.text,
              lineHeight: 1.7,
              fontWeight: 300,
              whiteSpace: "pre-wrap", // preserves new lines
            }}
          >
            <MarkdownBoldText
              text={day.narrative || "No narrative available for this date."}
            />
          </p>

          <DetailedFindings entityTypes={entityTypes} />
        </Card>
      </div>
    </div>
  );
}

function TimelineTab({ data }) {
  const tl = data?.timeline;
  if (!tl) return <EmptyState />;
  const events    = tl.timeline ?? [];
  const undated   = tl.undated ?? [];
  const dateRange = tl.date_range ?? {};

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <Counter n={dateRange.total_dates ?? events.length} label="Dated Entries" />
        <Counter n={dateRange.total_dated_entities ?? "—"} label="Dated Findings" />
        <Counter n={dateRange.total_undated_entities ?? "—"} label="Undated Findings" />
      </div>

      {(dateRange.earliest_date || dateRange.latest_date) && (
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, background: T.bgAlt, border: `1px solid ${T.border}`, padding: "0.75rem 1rem", minWidth: 140 }}>
            <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.35rem" }}>Latest</div>
            <div style={{ fontSize: "0.82rem", color: T.text, fontWeight: 400 }}>{dateRange.latest_date || "—"}</div>
          </div>
          <div style={{ flex: 1, background: T.bgAlt, border: `1px solid ${T.border}`, padding: "0.75rem 1rem", minWidth: 140 }}>
            <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.35rem" }}>Earliest</div>
            <div style={{ fontSize: "0.82rem", color: T.text, fontWeight: 400 }}>{dateRange.earliest_date || "—"}</div>
          </div>
        </div>
      )}

      <SecLabel>Chronological Findings (Latest First)</SecLabel>
      {events.length > 0 ? events.map((day, i) => (
        <DateEntry key={i} day={day} isLast={i === events.length - 1} />
      )) : <EmptyState msg="No dated timeline entries" />}

      {undated.length > 0 && (
        <>
          <Divider />
          <SecLabel>Undated Findings</SecLabel>
          <Card>
            <DetailedFindings entityTypes={undated} />
          </Card>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   TAB: Organ Analysis
   Backend shape: data.organ_analysis = {
     organ_systems: [{ system, consolidated_status, key_findings:[{finding,date,source_document}],
                        trend, first_documented, latest_documented }],
     systems_summary_note: string,
     completeness_check: {...}
   }
───────────────────────────────────────── */
// function OrgansTab({ data }) {
//   const oa = data?.organ_analysis;
//   if (!oa) return <EmptyState />;
//   const systems = oa.organ_systems ?? [];

//   return (
//     <div>
//       {oa.systems_summary_note && (
//         <Callout label="Summary">
//           <p style={{ fontSize: "0.82rem", color: T.textSec, lineHeight: 1.7, fontWeight: 300 }}>{oa.systems_summary_note}</p>
//         </Callout>
//       )}

//       {systems.length > 0 ? (
//         <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.875rem" }}>
//           {systems.map((sys, i) => (
//             <Card key={i} style={{ borderTop: `2px solid ${T.borderStr}` }}>
//               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.625rem" }}>
//                 <div style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text }}>{sys.system}</div>
//                 <Badge label={sys.trend || "undetermined"} accent={sys.trend === "worsening"} />
//               </div>

//               <p style={{ fontSize: "0.75rem", color: T.textSec, lineHeight: 1.6, fontWeight: 300, marginBottom: sys.key_findings?.length ? "0.65rem" : 0 }}>
//                 {sys.consolidated_status}
//               </p>

//               {sys.key_findings?.length > 0 && (
//                 <div style={{ marginBottom: "0.5rem" }}>
//                   {sys.key_findings.map((f, fi) => (
//                     <div key={fi} style={{
//                       padding: "0.4rem 0",
//                       borderBottom: fi < sys.key_findings.length - 1 ? `1px solid ${T.border}` : "none",
//                     }}>
//                       <div style={{ fontSize: "0.72rem", color: T.text, lineHeight: 1.5 }}>{f.finding}</div>
//                       <div style={{ fontSize: "0.62rem", color: T.textMuted, marginTop: "2px" }}>
//                         {f.date} {f.source_document ? `· ${f.source_document}` : ""}
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               )}

//               {(sys.first_documented || sys.latest_documented) && (
//                 <div style={{ fontSize: "0.65rem", color: T.textMuted, marginTop: "0.5rem", borderTop: `1px solid ${T.border}`, paddingTop: "0.5rem", fontWeight: 300 }}>
//                   First: {sys.first_documented || "—"} · Latest: {sys.latest_documented || "—"}
//                 </div>
//               )}
//             </Card>
//           ))}
//         </div>
//       ) : (
//         <EmptyState msg="No organ system data available" />
//       )}
//     </div>
//   );
// }

/* ─────────────────────────────────────────
   TAB DEFINITIONS
───────────────────────────────────────── */
const TABS = [
  { id: "summary",  label: "Clinical Summary" },
  { id: "timeline", label: "Timeline"         },
  { id: "Longitudinal",  label: "Longitudinal Summary" },
  // { id: "organs",   label: "Organ Analysis"   },
];

/* ─────────────────────────────────────────
   ROOT COMPONENT
───────────────────────────────────────── */
export default function PatientSummary({ patientId, trigger }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState("summary");
  const [error,   setError]   = useState("");

  const handleRefresh = async () => {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/patient-summary/${patientId}`
      );

      const json = await res.json();

      if (json?.status === "success") {
        setData(json.data);
      } else {
        setError("No patient summary found.");
      }
    } catch (err) {
      setError("Failed to load patient summary.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!patientId) return;
    const load = async () => {
      try {
        if (!data) setLoading(true);
        const res  = await fetch(`${API_BASE_URL}hms/users/data/context/patient-summary/${patientId}`);
        const json = await res.json();
        if (json?.status === "success") setData(json.data);
        else setError("No patient summary found.");
      } catch { setError("Failed to load patient summary."); }
      finally  { setLoading(false); }
    };
    load();
  }, [patientId, trigger]);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "280px", flexDirection: "column", gap: "1rem", background: T.bg }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: 28, height: 28, border: `1px solid ${T.border}`, borderTopColor: T.borderStr, borderRadius: "50%", animation: "da-spin 0.7s linear infinite" }} />
      <div style={{ fontSize: "0.72rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.15em", fontFamily: T.font }}>Loading clinical data…</div>
    </div>
  );

  if (error) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
        padding: "1.25rem", border: `1px solid ${T.borderStr}`, background: T.bgAlt,
        fontSize: "0.82rem", color: T.text, fontFamily: T.font,
      }}>
        <span>{error}</span>
        <button
          className="da-action-btn"
          onClick={handleRefresh}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            border: `1px solid ${T.borderStr}`, background: T.bg,
            cursor: "pointer", padding: "0.4rem 0.75rem",
            fontSize: "0.72rem", fontFamily: T.font, color: T.text,
            flexShrink: 0,
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? "da-spin 0.7s linear infinite" : "none" }} />
          REFRESH
        </button>
      </div>
    </>
  );

  if (!data) return null;

  const { documents_analyzed, generated_at } = data;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: T.font, fontWeight: 300 }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Top bar ── */}
      <div style={{
        background: T.bg, borderBottom: `1px solid ${T.border}`,
        padding: "0.875rem 1.5rem",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.2rem" }}>
              <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: T.textMuted }}>
                Patient Summary
              </span>

              <button
                className="da-action-btn"
                onClick={handleRefresh}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1px solid ${T.border}`, background: T.bg,
                  cursor: "pointer", width: "24px", height: "24px", padding: 0,
                }}
              >
                <RefreshCw size={12} style={{ animation: loading ? "da-spin 0.7s linear infinite" : "none" }} />
              </button>
            </div>

            <p style={{
              fontSize: "0.72rem", fontWeight: 300, color: T.textMuted,
              maxWidth: 440, whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", margin: 0,
            }}>
              {documents_analyzed != null ? `${documents_analyzed} document${documents_analyzed === 1 ? "" : "s"} analyzed` : ""}
              {generated_at ? ` · ${new Date(generated_at).toLocaleString()}` : ""}
            </p>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 1.5rem 3rem" }}>

        {/* ── Tab bar + content ── */}
        <div style={{ border: `1px solid ${T.border}`, background: T.bg, marginTop: "1.5rem" }}>
          {/* tabs */}
          <div style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${T.border}`, background: T.bgAlt }}>
            {TABS.map(t => (
              <button key={t.id} className="da-tab-btn"
                onClick={() => setTab(t.id)}
                style={{
                  padding: "0.75rem 1rem",
                  fontSize: "0.72rem",
                  fontWeight: tab === t.id ? 400 : 300,
                  color: tab === t.id ? T.text : T.textMuted,
                  borderBottom: tab === t.id ? `2px solid ${T.borderStr}` : "2px solid transparent",
                  background: tab === t.id ? T.bg : "transparent",
                  letterSpacing: tab === t.id ? "0" : "0.02em",
                  marginBottom: "-1px",
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* content */}
          <div style={{ padding: "1.5rem", minHeight: "380px" }} className="fade-in" key={tab}>
            {tab === "summary"  && <ClinicalSummaryTab data={data} />}
            {tab === "timeline" && <TimelineTab        data={data} />}
            {tab === "Longitudinal" && (
              <LongitudinalSummaryTab
                patientId={patientId}
                trigger={trigger}
              />
            )}
            {/* {tab === "organs"   && <OrgansTab          data={data} />} */}
          </div>
        </div>

      </div>
    </div>
  );
}