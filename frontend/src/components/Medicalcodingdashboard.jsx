import React, { useState, useRef, useCallback } from "react";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const card = {
  background: C.white,
  border: `1px solid ${C.fog}`,
  borderRadius: "4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const actionButton = {
  padding: "9px 20px",
  borderRadius: "2px",
  fontSize: 12,
  fontWeight: 400,
  fontFamily: FONT,
  letterSpacing: "0.06em",
  background: C.black,
  color: C.white,
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  transition: "background 0.18s ease",
};

const ghostButton = {
  padding: "7px 14px",
  borderRadius: "2px",
  fontSize: 12,
  fontWeight: 400,
  fontFamily: FONT,
  letterSpacing: "0.04em",
  background: "transparent",
  color: C.charcoal,
  border: `1px solid ${C.mist}`,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
  transition: "all 0.15s ease",
};

// ─── API ──────────────────────────────────────────────────────────────────────
const API_URL =
  "https://doctorassist.ai/api/hms/users/ai-legacy/coding/analyze";

const SAMPLE_CASE = `12-year-old female was chasing her friend when she fell through a sliding glass door sustaining three lacerations. Left knee 5.5 cm laceration, involving deep subcutaneous tissue and fascia, was repaired with layered closure using 1% lidocaine anesthetic. Right knee: 7.2 cm laceration was repaired under local anesthetic with a single-layer closure. Right hand: 2.5 cm laceration of the dermis was repaired with simple closure using Derma bond© tissue adhesive. Assessment: Wounds of both knees and left hand requiring suture repair Plan: Follow-up in 10 days for suture removal. Call office if any questions or complications. What are the correct ICD-10-CM and CPT procedure codes? Do not code anesthesia administration`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function humanLabel(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

// Converts anything to a safe renderable string (no objects passed to React)
function safeStr(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map(safeStr).join(", ");
  if (typeof val === "object") {
    return Object.entries(val)
      .map(([k, v]) => `${humanLabel(k)}: ${safeStr(v)}`)
      .join(" · ");
  }
  return String(val);
}

// ─── Recursive value renderer — safely renders ANY value ─────────────────────
function RenderValue({ value, depth = 0 }) {
  if (value === null || value === undefined) return null;

  // Primitives
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return (
      <p
        style={{
          ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.7 }),
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {String(value)}
      </p>
    );
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {value.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span
              style={{
                ...os({ fontSize: 11, color: C.silver, flexShrink: 0, marginTop: 2 }),
              }}
            >
              {i + 1}.
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <RenderValue value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Objects
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([, v]) => v !== null && v !== undefined && v !== ""
    );
    if (entries.length === 0) return null;
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          ...(depth > 0
            ? { borderLeft: `2px solid ${C.fog}`, paddingLeft: 12, marginTop: 4 }
            : {}),
        }}
      >
        {entries.map(([k, v]) => (
          <div key={k}>
            <p
              style={{
                ...os({
                  fontSize: 10,
                  color: C.silver,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 3,
                }),
              }}
            >
              {humanLabel(k)}
            </p>
            <RenderValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Code extraction ──────────────────────────────────────────────────────────
function extractCodes(data, type) {
  const codes = [];
  const srcKeys =
    type === "icd"
      ? ["icd_codes", "icd10_codes", "diagnoses", "diagnosis_codes", "icd_10_codes"]
      : ["cpt_codes", "procedure_codes", "procedures", "cpt_procedure_codes"];

  for (const key of srcKeys) {
    const src = data[key];
    if (Array.isArray(src) && src.length > 0) {
      src.forEach((item) => {
        if (!item) return;
        if (typeof item === "string") {
          const pattern =
            type === "icd"
              ? /([A-Z][0-9][0-9A-Z.]{1,6})/
              : /\b(\d{4,5}[A-Z0-9]?)\b/;
          const m = item.match(pattern);
          codes.push({
            code: m ? m[1] : item,
            description: m
              ? item.replace(m[1], "").replace(/^[\s:\-–]+/, "").trim()
              : "",
            detail: "",
          });
        } else if (typeof item === "object") {
          const code = safeStr(
            item.code || item.icd_code || item.cpt_code || item.procedure_code || ""
          );
          const description = safeStr(
            item.description ||
              item.desc ||
              item.long_description ||
              item.short_description ||
              ""
          );
          const detail = safeStr(
            item.detail ||
              item.note ||
              item.rationale ||
              item.modifier ||
              item.units ||
              ""
          );
          if (code) codes.push({ code, description, detail });
        }
      });
      return codes;
    }
  }

  // Fallback: scan raw JSON string for code patterns
  const raw = JSON.stringify(data);
  if (type === "icd") {
    const matches = [...raw.matchAll(/"([A-Z][0-9][0-9A-Z.]{1,6})"/g)];
    const seen = new Set();
    matches.forEach((m) => {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        codes.push({ code: m[1], description: "", detail: "" });
      }
    });
  } else {
    const matches = [...raw.matchAll(/"(\d{5})"/g)];
    const seen = new Set();
    matches.forEach((m) => {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        codes.push({ code: m[1], description: "", detail: "" });
      }
    });
  }
  return codes;
}

function extractNarrative(data) {
  const keys = [
    "narrative", "coding_narrative", "explanation", "rationale",
    "reasoning", "analysis", "notes", "summary", "coding_summary",
  ];
  for (const k of keys) {
    const val = data[k];
    if (val && typeof val === "string") return val;
  }
  return null;
}

// Keys already handled explicitly — excluded from "extra sections"
const HANDLED_KEYS = new Set([
  "icd_codes", "icd10_codes", "diagnoses", "diagnosis_codes", "icd_10_codes",
  "cpt_codes", "procedure_codes", "procedures", "cpt_procedure_codes",
  "narrative", "coding_narrative", "explanation", "rationale", "reasoning",
  "analysis", "notes", "summary", "coding_summary",
  "status", "message", "error",
]);

// ─── Sub-components ───────────────────────────────────────────────────────────

const SectionHeader = ({ children, sub }) => (
  <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
    <p style={{ ...os({ fontSize: 13, color: C.ink, letterSpacing: "0.02em" }) }}>
      {children}
    </p>
    {sub && <p style={{ ...os({ fontSize: 11, color: C.ash, marginTop: 2 }) }}>{sub}</p>}
  </div>
);

const StatusBadge = ({ status }) => {
  const map = {
    ready:      { bg: C.ghost,    color: C.ash,      border: `1px solid ${C.fog}`,    label: "Ready"      },
    processing: { bg: "#E6F1FB",  color: "#185FA5",  border: "1px solid #B5D4F4",     label: "Processing" },
    complete:   { bg: "#EAF3DE",  color: "#3B6D11",  border: "1px solid #C0DD97",     label: "Complete"   },
    error:      { bg: "#FCEBEB",  color: "#A32D2D",  border: "1px solid #F09595",     label: "Error"      },
  };
  const s = map[status] || map.ready;
  return (
    <span
      style={{
        ...os({ fontSize: 10, letterSpacing: "0.07em" }),
        padding: "3px 10px",
        borderRadius: "2px",
        fontWeight: 400,
        background: s.bg,
        color: s.color,
        border: s.border,
      }}
    >
      {s.label}
    </span>
  );
};

const StatCard = ({ value, label }) => (
  <div style={{ ...card, padding: "12px 16px" }}>
    <p style={{ ...os({ fontSize: 26, color: C.ink, fontWeight: 400 }) }}>{value}</p>
    <p style={{ ...os({ fontSize: 11, color: C.ash, marginTop: 3 }) }}>{label}</p>
  </div>
);

const Spinner = () => (
  <div
    style={{
      width: 20,
      height: 20,
      border: `2px solid ${C.fog}`,
      borderTopColor: C.charcoal,
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      flexShrink: 0,
    }}
  />
);

const CodeRow = ({ code, description, detail, type, isLast }) => {
  const pill =
    type === "icd"
      ? { background: "#E6F1FB", color: "#185FA5" }
      : { background: "#EAF3DE", color: "#3B6D11" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "9px 0",
        borderBottom: isLast ? "none" : `1px solid ${C.fog}`,
      }}
    >
      <span
        style={{
          ...os({ fontSize: 11, fontWeight: 500, letterSpacing: "0.04em" }),
          padding: "3px 9px",
          borderRadius: "2px",
          whiteSpace: "nowrap",
          flexShrink: 0,
          fontFamily: "monospace",
          ...pill,
        }}
      >
        {code}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {description ? (
          <p style={{ ...os({ fontSize: 12, color: C.ink, lineHeight: 1.5 }) }}>
            {description}
          </p>
        ) : null}
        {detail ? (
          <p style={{ ...os({ fontSize: 11, color: C.ash, marginTop: 3 }) }}>{detail}</p>
        ) : null}
        
      </div>
    </div>
  );
};

const CodeSection = ({ label, codes, type }) => {
  if (!codes || codes.length === 0) return null;
  return (
    <div>
      <p
        style={{
          ...os({
            fontSize: 10,
            color: C.silver,
            textTransform: "uppercase",
            letterSpacing: "0.09em",
            marginBottom: 8,
          }),
        }}
      >
        {label}
      </p>
      <div style={{ ...card, padding: "0 14px" }}>
        {codes.map((c, i) => (
          <CodeRow key={i} {...c} type={type} isLast={i === codes.length - 1} />
        ))}
      </div>
    </div>
  );
};

// Collapsible card for structured sections like claim_summary, coding_rationale
const StructuredSection = ({ label, value }) => {
  const [expanded, setExpanded] = useState(false);
  if (!value) return null;
  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          ...ghostButton,
          width: "100%",
          justifyContent: "space-between",
          padding: "9px 14px",
          marginBottom: expanded ? 8 : 0,
        }}
      >
        <span style={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{label}</span>
        <span style={{ ...os({ fontSize: 10, color: C.silver }) }}>
          {expanded ? "▲ collapse" : "▼ expand"}
        </span>
      </button>
      {expanded && (
        <div style={{ ...card, padding: "14px 16px" }}>
          <RenderValue value={value} depth={0} />
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MedicalCodingDashboard() {
  const [caseText, setCaseText]             = useState("");
  const [includeNarrative, setIncludeNarrative] = useState(true);
  const [status, setStatus]                 = useState("ready");
  const [result, setResult]                 = useState(null);
  const [errorMsg, setErrorMsg]             = useState("");
  const textareaRef = useRef(null);

  const icdCodes     = result ? extractCodes(result, "icd") : [];
  const cptCodes     = result ? extractCodes(result, "cpt") : [];
  const narrativeObj = result?.narrative;
  const totalCodes   = icdCodes.length + cptCodes.length;

  // All keys not already handled explicitly — rendered as collapsible structured sections
  const extraSections = result
    ? Object.entries(result).filter(([key, val]) => {
        if (!val) return false;
        if (HANDLED_KEYS.has(key.toLowerCase())) return false;
        return true; // render everything else, whether string or object
      })
    : [];

  const processCase = useCallback(async () => {
    const text = caseText.trim();
    if (!text) { textareaRef.current?.focus(); return; }
    setStatus("processing");
    setResult(null);
    setErrorMsg("");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_text: text, include_narrative: includeNarrative }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      console.log(data)
      setResult(data);
      setStatus("complete");
    } catch (err) {
      setErrorMsg(err.message || "Unexpected error");
      setStatus("error");
    }
  }, [caseText, includeNarrative]);

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") processCase();
  };

  const handleClear = () => {
    setCaseText("");
    setResult(null);
    setStatus("ready");
    setErrorMsg("");
    textareaRef.current?.focus();
  };

  const loadSample = () => {
    setCaseText(SAMPLE_CASE);
    setResult(null);
    setStatus("ready");
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  return (
    <div
      style={{
        fontFamily: FONT,
        fontWeight: FW,
        background: C.ghost,
        minHeight: "100vh",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        textarea:focus { outline: none; }
        button { font-family: inherit; }
        button:hover { opacity: 0.88; }
        button:active { opacity: 0.75; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.mist}; border-radius: 2px; }
      `}</style>

      {/* Top Bar */}
      <div
        style={{
          ...card,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <p style={{ ...os({ fontSize: 15, color: C.ink, letterSpacing: "0.02em" }) }}>
            DoctorAssist.AI — Medical Coding
          </p>
          <p style={{ ...os({ fontSize: 11, color: C.ash, marginTop: 2 }) }}>
            ICD-10-CM &amp; CPT code extraction
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {status === "complete" && (
            <p style={{ ...os({ fontSize: 11, color: C.ash }) }}>
              {totalCodes} code{totalCodes !== 1 ? "s" : ""} found
            </p>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Main Grid */}
      <div
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 16,
  }}
>
        {/* Left: Input */}
        <div style={{ ...card, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <SectionHeader sub="Paste or type clinical case notes">
            Clinical Case Input
          </SectionHeader>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <textarea
              ref={textareaRef}
              value={caseText}
              onChange={(e) => setCaseText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Enter clinical case notes, operative report, or encounter documentation here...\n\nTip: Press Ctrl+Enter to process.`}
              style={{
                ...os({ fontSize: 12, color: C.ink, lineHeight: 1.7 }),
                minHeight: 280,
                width: "100%",
                padding: "12px 14px",
                border: `1px solid ${C.mist}`,
                borderRadius: "2px",
                background: C.white,
                resize: "vertical",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.target.style.borderColor = C.charcoal)}
              onBlur={(e)  => (e.target.style.borderColor = C.mist)}
            />

            <label
              style={{
                ...os({ fontSize: 12, color: C.smoke }),
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={includeNarrative}
                onChange={(e) => setIncludeNarrative(e.target.checked)}
                style={{ accentColor: C.black, width: 13, height: 13, cursor: "pointer" }}
              />
              Include narrative reasoning
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={loadSample} style={ghostButton}>Load sample</button>
              <button onClick={handleClear} style={ghostButton}>Clear</button>
              <button
                onClick={processCase}
                disabled={status === "processing"}
                style={{
                  ...actionButton,
                  marginLeft: "auto",
                  opacity: status === "processing" ? 0.5 : 1,
                  cursor: status === "processing" ? "not-allowed" : "pointer",
                }}
              >
                {status === "processing" ? <><Spinner /> Processing...</> : "Process"}
              </button>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.fog}`, padding: "10px 20px", background: C.ghost }}>
            <p style={{ ...os({ fontSize: 10, color: C.silver, letterSpacing: "0.04em" }) }}>
              Ctrl + Enter to process · Supports ICD-10-CM &amp; CPT extraction
            </p>
          </div>
        </div>

        {/* Right: Results */}
        <div style={{ ...card, overflow: "hidden" }}>
          <SectionHeader
            sub={
              status === "complete"
                ? `${totalCodes} code${totalCodes !== 1 ? "s" : ""} extracted`
                : "AI-generated codes appear here"
            }
          >
            Coding Results
          </SectionHeader>

          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 360,
            }}
          >
            {/* Empty state */}
            {status === "ready" && !result && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "48px 0",
                  gap: 10,
                  textAlign: "center",
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                  stroke={C.mist} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                <p style={{ ...os({ fontSize: 12, color: C.silver }) }}>
                  Paste a clinical case and click Process
                  <br />to extract ICD-10-CM and CPT codes
                </p>
              </div>
            )}

            {/* Loading */}
            {status === "processing" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "48px 0",
                  gap: 14,
                }}
              >
                <Spinner />
                <p style={{ ...os({ fontSize: 12, color: C.ash }) }}>
                  Analyzing clinical documentation...
                </p>
              </div>
            )}

            {/* Error */}
            {status === "error" && (
              <div
                style={{
                  background: "#FCEBEB",
                  border: "1px solid #F09595",
                  borderRadius: "4px",
                  padding: "14px 16px",
                }}
              >
                <p style={{ ...os({ fontSize: 12, color: "#A32D2D", lineHeight: 1.6 }) }}>
                  <strong>Error:</strong> {errorMsg}
                  <br />Please check the case text and try again.
                </p>
              </div>
            )}

            {/* Results */}
            {status === "complete" && result && (
              <>
                {/* Stat summary */}
                {totalCodes > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <StatCard value={icdCodes.length} label="ICD-10-CM codes" />
                    <StatCard value={cptCodes.length} label="CPT procedure codes" />
                  </div>
                )}

                {/* ICD codes */}
                <CodeSection label="ICD-10-CM Diagnosis Codes" codes={icdCodes} type="icd" />

                {/* CPT codes */}
                <CodeSection label="CPT Procedure Codes" codes={cptCodes} type="cpt" />

                {/* Plain-string narrative */}
                {includeNarrative && result?.narrative && (
  <div>
    <p
      style={{
        ...os({
          fontSize: 10,
          color: C.silver,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          marginBottom: 8,
        }),
      }}
    >
      Clinical Coding Narrative
    </p>

    <div style={{ ...card, padding: "14px 16px" }}>
      {typeof result.narrative === "string" ? (
        <p
          style={{
            ...os({
              fontSize: 12,
              color: C.charcoal,
              lineHeight: 1.8,
              whiteSpace: "pre-wrap",
            }),
          }}
        >
          {result.narrative}
        </p>
      ) : (
        <RenderValue value={result.narrative} />
      )}
    </div>
  </div>
)}

                {/* Extra structured sections — claim_summary, coding_rationale, etc. */}
                {extraSections.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <p
                      style={{
                        ...os({
                          fontSize: 10,
                          color: C.silver,
                          textTransform: "uppercase",
                          letterSpacing: "0.09em",
                        }),
                      }}
                    >
                      Additional Details
                    </p>
                    {extraSections.map(([key, val]) => (
                      <StructuredSection key={key} label={humanLabel(key)} value={val} />
                    ))}
                  </div>
                )}

                {/* Absolute fallback — nothing rendered above */}
                {totalCodes === 0 && !narrativeStr && extraSections.length === 0 && (
                  <div style={{ ...card, padding: "14px 16px" }}>
                    <p
                      style={{
                        ...os({
                          fontSize: 10,
                          color: C.silver,
                          textTransform: "uppercase",
                          letterSpacing: "0.09em",
                          marginBottom: 10,
                        }),
                      }}
                    >
                      Raw API Response
                    </p>
                    <RenderValue value={result} depth={0} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          ...card,
          marginTop: 16,
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <p style={{ ...os({ fontSize: 10, color: C.silver, letterSpacing: "0.04em" }) }}>
          DoctorAssist.AI · For educational and clinical decision support use only
        </p>
        <p style={{ ...os({ fontSize: 10, color: C.silver }) }}>
          ICD-10-CM &amp;CPT 
        </p>
      </div>
    </div>
  );
}