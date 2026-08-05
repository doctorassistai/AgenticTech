// DocumentVerificationStep.jsx
// Step 2: Verify each investigator-submitted document

import { useState } from "react";

const INV_META = {
  MV:   { label: "Medical Visit",          color: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE" },
  HV:   { label: "Hospital Visit",         color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" },
  HVI:  { label: "Home / Neighbour Visit", color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" },
  TELE: { label: "Telephone Verification", color: "#6D28D9", bg: "#FAF5FF", border: "#DDD6FE" },
  BILL: { label: "Bill Verification",      color: "#92400E", bg: "#FFFBEB", border: "#FDE68A" },
};

const ENTITY_META = {
  Diagnosis:   { bg: "#FEE2E2", color: "#991B1B" },
  Finding:     { bg: "#FEF3C7", color: "#92400E" },
  Procedure:   { bg: "#EDE9FE", color: "#5B21B6" },
  Measurement: { bg: "#DBEAFE", color: "#1D4ED8" },
  Treatment:   { bg: "#D1FAE5", color: "#065F46" },
};

const em = (t) => ENTITY_META[t] || { bg: "#F1F5F9", color: "#334155" };

// Fullscreen PDF preview modal
function PdfPreview({ doc, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14,
          width: "min(920px, 94vw)", height: "90vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 32px 80px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
      >
        {/* Preview header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid #E2E8F0",
          background: "#F8FAFC", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{doc.label}</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>{doc.file_name || doc.document_id || ""}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={doc.file_url} target="_blank" rel="noreferrer"
              style={{
                padding: "6px 12px", borderRadius: 7,
                background: "#EFF6FF", color: "#2563EB",
                fontSize: 12, fontWeight: 600, textDecoration: "none",
                border: "1px solid #BFDBFE",
              }}
            >Open in new tab ↗</a>
            <button
              onClick={onClose}
              style={{
                border: "1px solid #E2E8F0", borderRadius: 7,
                background: "#fff", padding: "6px 10px",
                cursor: "pointer", color: "#64748B", fontSize: 16,
              }}
            >✕</button>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* iframe */}
          <iframe
            src={doc.file_url}
            title="Document preview"
            style={{ flex: 3, border: "none", minHeight: 0 }}
          />
          {/* Entities panel */}
          <div style={{
            flex: 2, borderLeft: "1px solid #E2E8F0",
            overflowY: "auto", padding: 16,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: "#94A3B8",
              textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12,
            }}>Extracted Entities</div>
            {doc.entities?.length > 0 ? doc.entities.map((e, i) => {
              const c = em(e.entity_type);
              return (
                <div key={i} style={{
                  marginBottom: 9, padding: "9px 12px",
                  background: c.bg, borderRadius: 9,
                  borderLeft: `3px solid ${c.color}`,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: c.color, opacity: 0.8, marginBottom: 3 }}>
                    {e.entity_type}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: c.color, marginBottom: e.entity_value ? 3 : 0 }}>{e.entity_name}</div>
                  {e.entity_value && <div style={{ fontSize: 12, color: c.color, opacity: 0.85 }}>{e.entity_value}</div>}
                  {e.evidence_text && (
                    <div style={{ fontSize: 10, color: c.color, opacity: 0.55, marginTop: 5, fontStyle: "italic", lineHeight: 1.5 }}>
                      "{e.evidence_text}"
                    </div>
                  )}
                </div>
              );
            }) : (
              <div style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic" }}>No extracted entities.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Single document card with view, entities, and tick/cross
function DocCard({ doc, invMeta, value, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState(false);
  const isVerified = value === true;
  const isDisputed = value === false;

  return (
    <>
      <div style={{
        border: `1.5px solid ${isVerified ? "#BBF7D0" : isDisputed ? "#FECACA" : "#E2E8F0"}`,
        borderRadius: 10,
        background: isVerified ? "#F0FDF4" : isDisputed ? "#FFF5F5" : "#fff",
        marginBottom: 7,
        overflow: "hidden",
        transition: "all 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px" }}>
          {/* File icon */}
          <div style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: doc.submitted ? invMeta.bg : "#F8FAFC",
            border: `1px solid ${doc.submitted ? invMeta.border : "#E2E8F0"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={doc.submitted ? invMeta.color : "#CBD5E1"} strokeWidth="2" strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: doc.submitted ? "#1E293B" : "#94A3B8" }}>
              {doc.label}
            </div>
            <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doc.submitted ? (doc.file_name || "Document received") : "Not submitted"}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            {doc.submitted && doc.entities?.length > 0 && (
              <span style={{
                padding: "2px 7px", borderRadius: 99, fontSize: 10,
                background: "#EDE9FE", color: "#5B21B6", fontWeight: 700,
              }}>{doc.entities.length} entities</span>
            )}

            {doc.submitted && (
              <>
                {/* View button */}
                <button
                  onClick={() => setPreview(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 8px", borderRadius: 7, cursor: "pointer",
                    border: "1px solid #BFDBFE", background: "#EFF6FF",
                    color: "#2563EB", fontSize: 11, fontWeight: 600,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  View
                </button>
                {/* Expand */}
                <button
                  onClick={() => setExpanded(v => !v)}
                  style={{ border: "none", background: "transparent", padding: "4px", cursor: "pointer", color: "#94A3B8" }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                    style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                    <polyline points="6,9 12,15 18,9"/>
                  </svg>
                </button>
              </>
            )}

            {/* Tick / Cross */}
            {doc.submitted && (
              <div style={{ display: "flex", gap: 3 }}>
                <button
                  onClick={() => onToggle(doc.doc_key, "document", isVerified ? null : true)}
                  style={{
                    width: 30, height: 30, borderRadius: 7, border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: isVerified ? "#16A34A" : "#F1F5F9",
                    color: isVerified ? "#fff" : "#94A3B8",
                    transition: "all 0.15s",
                    boxShadow: isVerified ? "0 2px 8px rgba(22,163,74,0.3)" : "none",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                </button>
                <button
                  onClick={() => onToggle(doc.doc_key, "document", isDisputed ? null : false)}
                  style={{
                    width: 30, height: 30, borderRadius: 7, border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: isDisputed ? "#DC2626" : "#F1F5F9",
                    color: isDisputed ? "#fff" : "#94A3B8",
                    transition: "all 0.15s",
                    boxShadow: isDisputed ? "0 2px 8px rgba(220,38,38,0.3)" : "none",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Expanded entities */}
        {expanded && doc.submitted && (
          <div style={{
            borderTop: "1px solid #F1F5F9",
            padding: "10px 13px",
            background: "#FAFBFC",
          }}>
            {doc.entities?.length > 0 ? (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Extracted Data
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {doc.entities.map((e, i) => {
                    const c = em(e.entity_type);
                    return (
                      <div key={i} style={{
                        display: "inline-flex", alignItems: "baseline", gap: 4,
                        padding: "3px 8px", borderRadius: 99,
                        background: c.bg, color: c.color, fontSize: 11,
                      }}>
                        <span style={{ fontWeight: 800, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7 }}>
                          {e.entity_type}
                        </span>
                        <span style={{ fontWeight: 600 }}>{e.entity_name}</span>
                        {e.entity_value && <span style={{ opacity: 0.85 }}>→ {e.entity_value}</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic" }}>No extracted entities</div>
            )}
          </div>
        )}
      </div>
      {preview && <PdfPreview doc={doc} onClose={() => setPreview(false)} />}
    </>
  );
}

// Investigation type section
function InvSection({ invType, inv, verifState, onToggle }) {
  const [open, setOpen] = useState(true);
  const meta = INV_META[invType] || INV_META.MV;
  const submitted = inv.docs.filter(d => d.submitted).length;
  const verified  = inv.docs.filter(d => verifState.documents?.[d.doc_key] === true).length;
  const disputed  = inv.docs.filter(d => verifState.documents?.[d.doc_key] === false).length;

  return (
    <div style={{
      border: `1.5px solid ${meta.border}`,
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 12,
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "11px 14px", background: meta.bg, border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          padding: "3px 8px", borderRadius: 6,
          background: meta.color, color: "#fff",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
        }}>{invType}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{inv.label}</div>
          <div style={{ fontSize: 11, color: "#64748B" }}>
            {inv.investigatorName}
            {inv.submission?.submitted_at ? ` · submitted ${inv.submission.submitted_at}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{submitted}/{inv.docs.length}</span>
          {verified > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#DCFCE7", color: "#166534" }}>✓ {verified}</span>
          )}
          {disputed > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#FEE2E2", color: "#991B1B" }}>✗ {disputed}</span>
          )}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2.5" strokeLinecap="round"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <polyline points="6,9 12,15 18,9"/>
          </svg>
        </div>
      </button>

      {open && (
        <div style={{ padding: "10px 14px" }}>
          {/* Text fields summary */}
          {inv.submission?.text_fields && Object.keys(inv.submission.text_fields).length > 0 && (
            <div style={{
              background: "#F8FAFC", borderRadius: 8, padding: "10px 12px",
              marginBottom: 10, border: "1px solid #E2E8F0",
            }}>
              {Object.entries(inv.submission.text_fields).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, marginBottom: 5, fontSize: 12 }}>
                  <span style={{ color: "#94A3B8", minWidth: 130, textTransform: "capitalize", flexShrink: 0 }}>
                    {k.replace(/_/g, " ")}
                  </span>
                  <span style={{ color: "#334155", flex: 1 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {inv.docs.map(doc => (
            <DocCard
              key={doc.doc_key}
              doc={doc}
              invMeta={meta}
              value={verifState.documents?.[doc.doc_key]}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocumentVerificationStep({
  detail,
  verifState,
  onToggle,
  onBack,
  onSubmitContinue,
  submitting,
}) {
  const investigations = detail?.investigations || {};
  const allDocs = Object.values(investigations).flatMap(inv => inv.docs.filter(d => d.submitted));
  const verifiedDocs = allDocs.filter(d => verifState.documents?.[d.doc_key] === true).length;
  const disputedDocs = allDocs.filter(d => verifState.documents?.[d.doc_key] === false).length;
  const reviewedDocs = verifiedDocs + disputedDocs;
  const pct = allDocs.length > 0 ? Math.round((reviewedDocs / allDocs.length) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px 12px",
        background: "#fff",
        borderBottom: "1px solid #E2E8F0",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(135deg, #7C3AED, #BE185D)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>2</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A" }}>Document Verification</div>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              Review investigator-submitted documents. View each file and its extracted data.
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 99,
              width: `${pct}%`,
              background: disputedDocs > 0 ? "linear-gradient(90deg,#7C3AED,#F59E0B)" : "linear-gradient(90deg,#7C3AED,#16A34A)",
              transition: "width 0.3s ease",
            }} />
          </div>
          <span style={{ fontSize: 11, color: "#64748B", flexShrink: 0, minWidth: 80, textAlign: "right" }}>
            {reviewedDocs}/{allDocs.length} reviewed
          </span>
          {verifiedDocs > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: "#DCFCE7", color: "#166534", fontWeight: 700 }}>✓ {verifiedDocs}</span>
          )}
          {disputedDocs > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: "#FEE2E2", color: "#991B1B", fontWeight: 700 }}>✗ {disputedDocs}</span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
        {Object.keys(investigations).length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#94A3B8", fontSize: 13 }}>
            No investigator submissions found
          </div>
        ) : (
          Object.entries(investigations).map(([invType, inv]) => (
            <InvSection
              key={invType}
              invType={invType}
              inv={inv}
              verifState={verifState}
              onToggle={onToggle}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "14px 20px",
        background: "#fff",
        borderTop: "1px solid #E2E8F0",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <button
          onClick={onBack}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px", borderRadius: 10,
            border: "1.5px solid #E2E8F0", background: "#fff",
            color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/>
          </svg>
          Back
        </button>

        {disputedDocs > 0 && (
          <div style={{
            flex: 1, fontSize: 11, color: "#92400E",
            background: "#FEF3C7", borderRadius: 8,
            padding: "7px 11px", border: "1px solid #FDE68A",
          }}>
            ⚠ {disputedDocs} document{disputedDocs !== 1 ? "s" : ""} disputed
          </div>
        )}
        {disputedDocs === 0 && <div style={{ flex: 1 }} />}

        <button
          onClick={onSubmitContinue}
          disabled={submitting}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "11px 24px", borderRadius: 10, border: "none",
            background: submitting ? "#94A3B8" : "linear-gradient(135deg,#7C3AED,#BE185D)",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: submitting ? "not-allowed" : "pointer",
            boxShadow: submitting ? "none" : "0 4px 14px rgba(124,58,237,0.3)",
          }}
        >
          {submitting && (
            <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.7s linear infinite" }} />
          )}
          Submit & Continue
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
          </svg>
        </button>
      </div>
    </div>
  );
}