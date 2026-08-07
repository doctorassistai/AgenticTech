// components/case/CaseDocumentUpload.jsx
import React, { useCallback, useRef, useState } from "react"
import { createPortal } from 'react-dom'
import { PDFDocument } from "pdf-lib"
import { normalizeDatesForForm } from "./utils"
// ── helpers ───────────────────────────────────────────────────────────────
const DROPDOWN_ONLY_FIELDS = ['insurer', 'claimMode', 'claimSubtype', 'tags', 'claimTrigger']

function stripDropdownFields(obj) {
  const result = { ...obj }
  DROPDOWN_ONLY_FIELDS.forEach(key => delete result[key])
  return result
}

function deepMerge(base, patch) {
  const result = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue
    if (
      typeof v === "object" && !Array.isArray(v) &&
      typeof result[k] === "object" && result[k] !== null && !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k], v)
    } else {
      result[k] = v
    }
  }
  return result
}

function flattenExtracted(obj, prefix = "") {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined || v === "") continue
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenExtracted(v, fullKey))
    } else {
      out[fullKey] = v
    }
  }
  return out
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

// ── PDF helpers (client-side page selection & slicing) ──────────────────────
function isPdfFile(file) {
  if (!file) return false
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")
}

async function getPdfPageCount(file) {
  try {
    const bytes = await file.arrayBuffer()
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    return pdfDoc.getPageCount()
  } catch (err) {
    console.warn("Could not read PDF page count:", err)
    return null
  }
}

// Builds a new PDF containing only the selected pages (0-indexed), preserving
// the original file name so downstream extraction/storage sees the same name.
async function slicePdfPages(file, pageIndices) {
  const bytes = await file.arrayBuffer()
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const newDoc = await PDFDocument.create()
  const sortedIndices = [...pageIndices].sort((a, b) => a - b)
  const copiedPages = await newDoc.copyPages(srcDoc, sortedIndices)
  copiedPages.forEach(p => newDoc.addPage(p))
  const newBytes = await newDoc.save()
  return new File([newBytes], file.name, { type: "application/pdf", lastModified: Date.now() })
}

const FIELD_LABELS = {
  insurer: "Insurer", policyNumber: "Policy No.", policyType: "Policy Type",
  insurerRef: "Insurer Ref", claimantName: "Claimant", claimantMobile: "Mobile",
  claimantAge: "Age", claimantEmail: "Email", city: "City", pinCode: "PIN",
  claimMode: "Claim Mode", claimSubtype: "Subtype", dateOfIncident: "Incident Date",
  claimedAmount: "Claimed ₹", sumInsured: "Sum Insured", description: "Description",
}

function flattenForPreview(obj, prefix = "") {
  const out = []
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined || v === "") continue
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenForPreview(v, fullKey))
    } else {
      out.push({
        key: fullKey,
        label: FIELD_LABELS[k] || k.replace(/([A-Z])/g, " $1").replace(/_/g, " "),
        value: String(v)
      })
    }
  }
  return out
}

// ── Document viewer drawer (Claim Detail docs only — shows extracted fields) ─
function DocumentDrawer({ doc, onClose }) {
  if (!doc) return null
  const fields = flattenForPreview(doc.extractedFields || {})

  return createPortal(
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        zIndex: 1000, backdropFilter: "blur(2px)", animation: "fadeIn 0.18s ease",
      }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(92vw, 1100px)",
        background: "var(--bg, #fff)", boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
        zIndex: 1001, display: "flex", flexDirection: "column", animation: "slideIn 0.22s ease",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "14px 20px",
          borderBottom: "1px solid var(--border, #e5e7eb)", background: "var(--bg2, #f9fafb)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doc.file?.name || doc.fileName || "Document"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {doc.label}
              {doc.docId && <span style={{ marginLeft: 8, color: "var(--accent)" }}>· {doc.docId}</span>}
              {fields.length > 0 && <span style={{ marginLeft: 8, color: "var(--green, #16a34a)" }}>· {fields.length} fields extracted</span>}
            </div>
          </div>
          {doc.pdfUrl && (
            <a href={doc.pdfUrl} target="_blank" rel="noreferrer" style={{
              fontSize: 12, color: "var(--accent)", textDecoration: "none",
              padding: "6px 12px", border: "1px solid var(--accent)", borderRadius: 6, flexShrink: 0,
            }}>Open PDF ↗</a>
          )}
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 20, color: "var(--muted)", lineHeight: 1, padding: "4px 8px", borderRadius: 6,
          }}>✕</button>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{
            flex: "0 0 58%", borderRight: "1px solid var(--border, #e5e7eb)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {doc.pdfUrl ? (
              <iframe src={doc.pdfUrl} style={{ flex: 1, border: "none", width: "100%", height: "100%" }} title="PDF Viewer" />
            ) : doc.pdfObjectUrl ? (
              doc.file?.type?.startsWith("image/") ? (
                <img src={doc.pdfObjectUrl} alt="preview" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
              ) : (
                <iframe src={doc.pdfObjectUrl} style={{ flex: 1, border: "none", width: "100%", height: "100%" }} title="Document Viewer" />
              )
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--muted)", gap: 8 }}>
                <span style={{ fontSize: 40 }}>📄</span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>PDF preview not available</div>
              </div>
            )}
          </div>
          <div style={{ flex: "0 0 42%", overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Extracted Fields</div>
            {fields.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)", padding: "20px 0" }}>No fields extracted from this document.</div>
            ) : fields.map(f => (
              <div key={f.key} style={{
                display: "flex", flexDirection: "column", gap: 2, padding: "8px 10px",
                background: "var(--bg2, #f9fafb)", borderRadius: 6, border: "1px solid var(--border, #e5e7eb)",
              }}>
                <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", wordBreak: "break-word" }}>{f.value}</span>
              </div>
            ))}
            {fields.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--border, #e5e7eb)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>These fields have been merged into the form.</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes slideIn { from { transform:translateX(100%) } to { transform:translateX(0) } }
      `}</style>
    </>,
    document.body
  )
}

// ── Page picker modal (PDFs only) — left: live PDF preview, right: page
// checkboxes. The Extract/Store action lives inside this modal; confirming
// slices the PDF client-side (pdf-lib) down to the selected pages, keeps the
// original file name, and then kicks off extraction/storage with that file. ─
function PagePickerModal({ doc, onClose, actionLabel, actionColor, onConfirm }) {
  const [selected, setSelected] = useState(() => {
    if (doc?.selectedPages) return new Set(doc.selectedPages)
    if (doc?.pageCount) return new Set(Array.from({ length: doc.pageCount }, (_, i) => i))
    return new Set()
  })
  const [busy, setBusy] = useState(false)

  if (!doc) return null
  const pageCount = doc.pageCount
  const loading = pageCount === null || pageCount === undefined

  const togglePage = (idx) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(Array.from({ length: pageCount }, (_, i) => i)))
  const selectNone = () => setSelected(new Set())

  const handleConfirm = async () => {
    if (selected.size === 0 || busy) return
    setBusy(true)
    try {
      await onConfirm(Array.from(selected).sort((a, b) => a - b))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <>
      <div onClick={busy ? undefined : onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        zIndex: 1100, backdropFilter: "blur(2px)", animation: "fadeIn 0.18s ease",
      }} />
      <div style={{
        position: "fixed", top: "4vh", left: "50%", transform: "translateX(-50%)",
        width: "min(94vw, 1200px)", height: "92vh", background: "var(--bg, #fff)",
        borderRadius: 12, boxShadow: "0 12px 60px rgba(0,0,0,0.28)",
        zIndex: 1101, display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "14px 20px",
          borderBottom: "1px solid var(--border, #e5e7eb)", background: "var(--bg2, #f9fafb)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doc.file.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {loading ? "Reading page count…" : `${pageCount} page${pageCount !== 1 ? "s" : ""} · ${selected.size} selected`}
            </div>
          </div>
          <button onClick={onClose} disabled={busy} style={{
            background: "none", border: "none", cursor: busy ? "default" : "pointer",
            fontSize: 20, color: "var(--muted)", lineHeight: 1, padding: "4px 8px", borderRadius: 6,
            opacity: busy ? 0.5 : 1,
          }}>✕</button>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left: live PDF preview */}
          <div style={{ flex: "0 0 62%", borderRight: "1px solid var(--border, #e5e7eb)", display: "flex" }}>
            {doc.pdfObjectUrl ? (
              <iframe src={doc.pdfObjectUrl} style={{ flex: 1, border: "none", width: "100%", height: "100%" }} title="PDF preview" />
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                Preview unavailable
              </div>
            )}
          </div>

          {/* Right: page checkboxes */}
          <div style={{ flex: "0 0 38%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border, #e5e7eb)", flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Select pages</div>
              <button type="button" onClick={selectAll} disabled={loading}
                style={{ fontSize: 11, border: "1px solid var(--border,#e5e7eb)", background: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                All
              </button>
              <button type="button" onClick={selectNone} disabled={loading}
                style={{ fontSize: 11, border: "1px solid var(--border,#e5e7eb)", background: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                None
              </button>
            </div>

            <div style={{
              flex: 1, overflowY: "auto", padding: "10px 16px",
              display: loading ? "block" : "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
              gap: 4, alignContent: "start",
            }}>
              {loading ? (
                <div style={{ fontSize: 12, color: "var(--muted)", padding: "20px 0" }}>Reading PDF…</div>
              ) : (
                Array.from({ length: pageCount }, (_, i) => (
                  <div key={i} onClick={() => togglePage(i)} style={{
                    display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: "4px 6px",
                    borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap",
                    background: selected.has(i) ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                  }}>
                    <span style={{
                      width: 13, height: 13, minWidth: 13, minHeight: 13, borderRadius: 3,
                      border: `1.5px solid ${selected.has(i) ? actionColor : "var(--border,#cbd5e1)"}`,
                      background: selected.has(i) ? actionColor : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, boxSizing: "border-box", transition: "background 0.12s, border-color 0.12s",
                    }}>
                      {selected.has(i) && (
                        <svg width="8" height="6" viewBox="0 0 9 7" fill="none">
                          <path d="M1 3.2L3.2 5.5L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {i + 1}
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border, #e5e7eb)", flexShrink: 0 }}>
              <button type="button" className="btn btn-primary" disabled={loading || selected.size === 0 || busy}
                style={{ width: "100%", background: actionColor, borderColor: actionColor, opacity: (loading || selected.size === 0 || busy) ? 0.6 : 1 }}
                onClick={handleConfirm}>
                {busy ? "Processing…" : `${actionLabel} (${selected.size} page${selected.size !== 1 ? "s" : ""})`}
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes fadeIn { from { opacity:0 } to { opacity:1 } }`}</style>
    </>,
    document.body
  )
}

function StatusRow({ color, spin, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color }}>
      {spin
        ? <span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        : <span>●</span>}
      {children}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── ClaimDocRow — Section A (Claim Detail Documents) ────────────────────────
function ClaimDocRow({ doc, index, onExtract, onView, onPick, onRemove }) {
  const busy = doc.state === "uploading" || doc.state === "extracting"
  const pdf = isPdfFile(doc.file) && !doc.pageCountFailed
  const colors = ["var(--accent)", "var(--teal,#14b8a6)", "var(--amber,#f59e0b)", "var(--green,#16a34a)"]
  const color  = colors[index % colors.length]

  const statusMsg = () => {
    if (doc.state === "idle")       return <StatusRow color="var(--muted)">{pdf ? "Click to select pages" : "Ready to extract"}</StatusRow>
    if (doc.state === "uploading")  return <StatusRow color="var(--accent)" spin>Uploading…</StatusRow>
    if (doc.state === "extracting") return <StatusRow color="var(--amber,#f59e0b)" spin>Parsing & extracting…</StatusRow>
    if (doc.state === "error")      return <StatusRow color="var(--red,#dc2626)">Failed — retry</StatusRow>
    if (doc.state === "done")       return <StatusRow color={color}>✓ {doc.fieldsFound || 0} fields</StatusRow>
    return null
  }

  const openPicker = () => { if (doc.state === "idle" && pdf) onPick(doc.id) }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: "var(--bg3,#f3f4f6)", borderRadius: 8,
      border: `1px solid ${doc.state === "done" ? color : doc.state === "error" ? "var(--red,#dc2626)" : "var(--border,#e5e7eb)"}`,
      opacity: busy ? 0.7 : 1, padding: "10px 14px",
    }}>
      <div style={{
        flexShrink: 0, textAlign: "center", minWidth: 76,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700,
      }}>{doc.label}</div>

      <div style={{ flex: 1, minWidth: 0 }} onClick={openPicker}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", cursor: (doc.state === "idle" && pdf) ? "pointer" : "default",
          textDecoration: (doc.state === "idle" && pdf) ? "underline" : "none",
          textDecorationColor: (doc.state === "idle" && pdf) ? "var(--border,#e5e7eb)" : "transparent",
        }}>
          {doc.file.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {formatBytes(doc.file.size)}{doc.pageCount ? ` · ${doc.pageCount} page${doc.pageCount !== 1 ? "s" : ""}` : ""}
        </div>
      </div>

      <div style={{ flexShrink: 0, minWidth: 160 }}>{statusMsg()}</div>

      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {doc.state === "idle" && (
          pdf ? (
            <button type="button" className="btn btn-primary"
              style={{ fontSize: 11, padding: "5px 10px", background: color, borderColor: color }}
              onClick={() => onPick(doc.id)}>📄 Select Pages</button>
          ) : (
            <button type="button" className="btn btn-primary"
              style={{ fontSize: 11, padding: "5px 10px", background: color, borderColor: color }}
              onClick={() => onExtract(doc.id)}>✨ Extract</button>
          )
        )}
        {doc.state === "error" && (
          <button type="button" className="btn btn-primary"
            style={{ fontSize: 11, padding: "5px 10px" }}
            onClick={() => onExtract(doc.id)}>↺ Retry</button>
        )}
        {doc.state === "done" && (
          <button type="button" className="btn btn-ghost"
            style={{ fontSize: 11, padding: "5px 10px" }}
            onClick={() => onView(doc.id)}>👁 View</button>
        )}
        {!busy && (
          <button type="button" onClick={() => onRemove(doc.id)}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", padding: "5px 8px", color: "var(--muted)", fontSize: 11 }}>
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// ── SupportDocRow — Section B (Supporting Documents, store only) ───────────
function SupportDocRow({ doc, index, onStore, onPick, onRemove }) {
  const busy = doc.state === "uploading"
  const pdf = isPdfFile(doc.file) && !doc.pageCountFailed
  const color = "var(--purple,#7c3aed)"

  const statusMsg = () => {
    if (doc.state === "idle")      return <StatusRow color="var(--muted)">{pdf ? "Click to select pages" : "Ready to store"}</StatusRow>
    if (doc.state === "uploading") return <StatusRow color={color} spin>Uploading…</StatusRow>
    if (doc.state === "error")     return <StatusRow color="var(--red,#dc2626)">Failed — retry</StatusRow>
    if (doc.state === "done")      return <StatusRow color={color}>✓ Stored · pending doctor review</StatusRow>
    return null
  }

  const openPicker = () => { if (doc.state === "idle" && pdf) onPick(doc.id) }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: "var(--bg3,#f3f4f6)", borderRadius: 8,
      border: `1px solid ${doc.state === "done" ? color : doc.state === "error" ? "var(--red,#dc2626)" : "var(--border,#e5e7eb)"}`,
      opacity: busy ? 0.7 : 1, padding: "10px 14px",
    }}>
      <div style={{
        flexShrink: 0, textAlign: "center", minWidth: 76,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700,
      }}>{doc.label}</div>

      <div style={{ flex: 1, minWidth: 0 }} onClick={openPicker}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", cursor: (doc.state === "idle" && pdf) ? "pointer" : "default",
          textDecoration: (doc.state === "idle" && pdf) ? "underline" : "none",
          textDecorationColor: (doc.state === "idle" && pdf) ? "var(--border,#e5e7eb)" : "transparent",
        }}>
          {doc.file.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {formatBytes(doc.file.size)}{doc.pageCount ? ` · ${doc.pageCount} page${doc.pageCount !== 1 ? "s" : ""}` : ""}
        </div>
      </div>

      <div style={{ flexShrink: 0, minWidth: 190 }}>{statusMsg()}</div>

      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {doc.state === "idle" && (
          pdf ? (
            <button type="button" className="btn btn-primary"
              style={{ fontSize: 11, padding: "5px 10px", background: color, borderColor: color }}
              onClick={() => onPick(doc.id)}>📄 Select Pages</button>
          ) : (
            <button type="button" className="btn btn-primary"
              style={{ fontSize: 11, padding: "5px 10px", background: color, borderColor: color }}
              onClick={() => onStore(doc.id)}>📤 Store</button>
          )
        )}
        {doc.state === "error" && (
          <button type="button" className="btn btn-primary"
            style={{ fontSize: 11, padding: "5px 10px" }}
            onClick={() => onStore(doc.id)}>↺ Retry</button>
        )}
        {(doc.state === "done") && doc.pdfUrl && (
          <a href={doc.pdfUrl} target="_blank" rel="noreferrer" className="btn btn-ghost"
            style={{ fontSize: 11, padding: "5px 10px", textDecoration: "none" }}>👁 Preview</a>
        )}
        {!busy && (
          <button type="button" onClick={() => onRemove(doc.id)}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", padding: "5px 8px", color: "var(--muted)", fontSize: 11 }}>
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────
export default function CaseDocumentUpload({ formData, setFormData, BASE_URL, caseId, setCaseId, setExtractedSuggestions }){
  const claimInputRef   = useRef(null)
  const supportInputRef = useRef(null)

  const [claimDocs, setClaimDocs]     = useState([])
  const [supportDocs, setSupportDocs] = useState([])
  const [viewingDoc, setViewingDoc]   = useState(null)
  const [pickerTarget, setPickerTarget] = useState(null) // { kind: 'claim' | 'support', id }
  const [expanded, setExpanded]       = useState(true)
  const [triggerText, setTriggerText] = useState("")
  const [fetching, setFetching]       = useState(false)
const [lastExtractedTrigger, setLastExtractedTrigger] = useState(null)
  const [creditWarning, setCreditWarning] = useState(null)
  const creatingCase = useRef(false)
  const caseIdRef    = useRef(null)

  const totalFound = claimDocs.reduce((sum, d) => sum + (d.fieldsFound || 0), 0)

  React.useEffect(() => {
    const checkCredits = () => {
      fetch(`${(BASE_URL || "").replace(/\/$/, "")}/insurance/web/llama-credit-status`)
        .then(r => r.json())
        .then(d => setCreditWarning(d.warning ? d : null))
        .catch(() => {})
    }
    checkCredits()
    const interval = setInterval(checkCredits, 60000)
    return () => clearInterval(interval)
  }, [BASE_URL])

  const updateClaimDoc   = (id, patch) => setClaimDocs(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
  const updateSupportDoc = (id, patch) => setSupportDocs(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))

  const updateCaseId = (id) => {
    caseIdRef.current = id
    setCaseId(id)
  }

  const getOrCreateCaseId = async () => {
    if (caseIdRef.current) return caseIdRef.current
    if (creatingCase.current) {
      await new Promise(resolve => {
        const interval = setInterval(() => {
          if (!creatingCase.current) { clearInterval(interval); resolve() }
        }, 50)
      })
      return caseIdRef.current
    }
    creatingCase.current = true
    try {
      const resp = await fetch(
        `${(BASE_URL || "").replace(/\/$/, "")}/insurance/web/create-draft-case`,
        { method: "POST" }
      )
      const data = await resp.json()
      if (!data.success) throw new Error("Failed to create draft case")
      updateCaseId(data.caseId)
      return data.caseId
    } finally {
      creatingCase.current = false
    }
  }

  const checkDuplicate = async (file) => {
    const activeCaseId = caseIdRef.current
    if (!activeCaseId) return false
    try {
      const resp = await fetch(
        `${(BASE_URL || "").replace(/\/$/, "")}/insurance/web/check-file-ingested/${activeCaseId}?filename=${encodeURIComponent(file.name)}`
      )
      if (resp.ok) {
        const data = await resp.json()
        if (data.already_uploaded) {
          alert(`"${file.name}" has already been uploaded and processed for this case.`)
          return true
        }
      }
    } catch (err) {
      console.warn("Duplicate check failed, proceeding anyway:", err)
    }
    return false
  }

  // ── Section A: Claim Detail Documents ───────────────────────────────────
  const handleClaimFiles = useCallback(async (files) => {
    const checkedFiles = []
    for (const file of Array.from(files)) {
      if (await checkDuplicate(file)) continue
      checkedFiles.push(file)
    }
    if (checkedFiles.length === 0) return

    const newIds = checkedFiles.map((_, i) => `claim-${Date.now()}-${i}`)

    setClaimDocs(prev => {
      const newDocs = checkedFiles.map((file, i) => ({
        id: newIds[i],
        label: `Document ${prev.length + i + 1}`,
        file,
        state: "idle",
        extractedFields: {},
        pdfUrl: null,
        pdfObjectUrl: URL.createObjectURL(file),
        docId: null,
        fieldsFound: 0,
        pageCount: null,
        pageCountFailed: false,
        selectedPages: null,
      }))
      return [...prev, ...newDocs]
    })

    // Stored locally already (idle, object URL created above). For PDFs,
    // fetch the page count in the background so the picker modal can open
    // instantly once the user clicks the document.
    checkedFiles.forEach((file, i) => {
      if (!isPdfFile(file)) return
      getPdfPageCount(file).then(count => {
        if (count == null) {
          updateClaimDoc(newIds[i], { pageCountFailed: true })
        } else {
          updateClaimDoc(newIds[i], { pageCount: count, selectedPages: Array.from({ length: count }, (_, k) => k) })
        }
      })
    })
  }, [])

  const extractClaimDoc = async (id, overrideFile) => {
    const doc = claimDocs.find(d => d.id === id)
    if (!doc) return
    const fileToSend = overrideFile || doc.file

    updateClaimDoc(id, { state: "uploading" })
    let activeCaseId
    try {
      activeCaseId = await getOrCreateCaseId()
    } catch (err) {
      console.error("Failed to create case:", err)
      updateClaimDoc(id, { state: "error" })
      return
    }

    try {
      const payload = new FormData()
      payload.append("file", fileToSend)
      payload.append("case_id", activeCaseId)
      payload.append("email_text", "")

      updateClaimDoc(id, { state: "extracting" })

      const resp = await fetch(
        `${(BASE_URL || "").replace(/\/$/, "")}/insurance/web/upload-document`,
        { method: "POST", body: payload }
      )
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null)
        throw new Error(errBody?.detail || `Upload failed: ${resp.status}`)
      }
      const data = await resp.json()
      if (!data.success || !data.extracted_fields) throw new Error("Extraction returned empty")

      setFormData(prev => deepMerge(prev, normalizeDatesForForm(stripDropdownFields(data.extracted_fields))))
      setExtractedSuggestions(prev => ({
        ...prev,
        ...flattenExtracted(data.extracted_fields),
        ...(Array.isArray(data.extracted_fields?.suggestedTriggers) && data.extracted_fields.suggestedTriggers.length
          ? { suggestedTriggers: data.extracted_fields.suggestedTriggers }
          : {}),
      }))

      updateClaimDoc(id, {
        state: "done", label: data.display_label || doc.label,
        extractedFields: data.extracted_fields,
        pdfUrl: data.pdf_url || null,
        docId: data.doc_id || null,
        fieldsFound: data.fields_found || 0,
      })
    } catch (err) {
      console.error("Claim document extraction error", err)
      updateClaimDoc(id, { state: "error" })
    }
  }

  const handleRemoveClaim = (id) => {
    setClaimDocs(prev => {
      const doc = prev.find(d => d.id === id)
      if (doc?.pdfObjectUrl) URL.revokeObjectURL(doc.pdfObjectUrl)
      const remaining = prev.filter(d => d.id !== id)
      return remaining.map((d, i) => ({ ...d, label: `Document ${i + 1}` }))
    })
  }

  // ── Section B: Supporting Documents (store only) ────────────────────────
  const handleSupportFiles = useCallback(async (files) => {
    const checkedFiles = []
    for (const file of Array.from(files)) {
      if (await checkDuplicate(file)) continue
      checkedFiles.push(file)
    }
    if (checkedFiles.length === 0) return

    const newIds = checkedFiles.map((_, i) => `support-${Date.now()}-${i}`)

    setSupportDocs(prev => {
      const newDocs = checkedFiles.map((file, i) => ({
        id: newIds[i],
        label: `Supporting Doc ${prev.length + i + 1}`,
        file,
        state: "idle",
        pdfUrl: null,
        pdfObjectUrl: URL.createObjectURL(file),
        docId: null,
        pageCount: null,
        pageCountFailed: false,
        selectedPages: null,
      }))
      return [...prev, ...newDocs]
    })

    checkedFiles.forEach((file, i) => {
      if (!isPdfFile(file)) return
      getPdfPageCount(file).then(count => {
        if (count == null) {
          updateSupportDoc(newIds[i], { pageCountFailed: true })
        } else {
          updateSupportDoc(newIds[i], { pageCount: count, selectedPages: Array.from({ length: count }, (_, k) => k) })
        }
      })
    })
  }, [])

  const storeSupportDoc = async (id, overrideFile) => {
    const doc = supportDocs.find(d => d.id === id)
    if (!doc) return
    const fileToSend = overrideFile || doc.file

    updateSupportDoc(id, { state: "uploading" })
    let activeCaseId
    try {
      activeCaseId = await getOrCreateCaseId()
    } catch (err) {
      console.error("Failed to create case:", err)
      updateSupportDoc(id, { state: "error" })
      return
    }

    try {
      const payload = new FormData()
      payload.append("file", fileToSend)
      payload.append("case_id", activeCaseId)
      payload.append("email_text", "")

      const resp = await fetch(
        `${(BASE_URL || "").replace(/\/$/, "")}/insurance/web/advanced-upload`,
        { method: "POST", body: payload }
      )
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null)
        throw new Error(errBody?.detail || `Upload failed: ${resp.status}`)
      }
      const data = await resp.json()

      updateSupportDoc(id, {
        state: "done",
        label: data.display_label || doc.label,
        pdfUrl: data.pdf_url || null,
        docId: data.doc_id || null,
        pageCount: data.page_count || doc.pageCount || 1,
      })
    } catch (err) {
      console.error("Supporting document store error", err)
      updateSupportDoc(id, { state: "error" })
    }
  }

  const handleRemoveSupport = (id) => {
    setSupportDocs(prev => {
      const doc = prev.find(d => d.id === id)
      if (doc?.pdfObjectUrl) URL.revokeObjectURL(doc.pdfObjectUrl)
      const remaining = prev.filter(d => d.id !== id)
      return remaining.map((d, i) => ({ ...d, label: `Supporting Doc ${i + 1}` }))
    })
  }

  // ── Page picker confirm handlers ─────────────────────────────────────────
  const handleConfirmClaimPages = async (selectedIndices) => {
    const doc = claimDocs.find(d => d.id === pickerTarget?.id)
    if (!doc) { setPickerTarget(null); return }

    let fileToUse = doc.file
    if (doc.pageCount != null && selectedIndices.length !== doc.pageCount) {
      fileToUse = await slicePdfPages(doc.file, selectedIndices)
    }

    if (doc.pdfObjectUrl) URL.revokeObjectURL(doc.pdfObjectUrl)
    const newObjectUrl = URL.createObjectURL(fileToUse)
    updateClaimDoc(doc.id, { file: fileToUse, pdfObjectUrl: newObjectUrl, selectedPages: selectedIndices })

    setPickerTarget(null)
    extractClaimDoc(doc.id, fileToUse)
  }

  const handleConfirmSupportPages = async (selectedIndices) => {
    const doc = supportDocs.find(d => d.id === pickerTarget?.id)
    if (!doc) { setPickerTarget(null); return }

    let fileToUse = doc.file
    if (doc.pageCount != null && selectedIndices.length !== doc.pageCount) {
      fileToUse = await slicePdfPages(doc.file, selectedIndices)
    }

    if (doc.pdfObjectUrl) URL.revokeObjectURL(doc.pdfObjectUrl)
    const newObjectUrl = URL.createObjectURL(fileToUse)
    updateSupportDoc(doc.id, { file: fileToUse, pdfObjectUrl: newObjectUrl, selectedPages: selectedIndices })

    setPickerTarget(null)
    storeSupportDoc(doc.id, fileToUse)
  }

  // ── Trigger-content-only extraction (unchanged) ─────────────────────────
  const handleExtractTriggers = async () => {
    if (!triggerText.trim()) return

    let activeCaseId
    try {
      activeCaseId = await getOrCreateCaseId()
    } catch (err) {
      console.error('Failed to create case:', err)
      return
    }

    try {
      const blob    = new Blob([triggerText], { type: 'text/plain' })
      const txtFile = new File([blob], 'trigger_content.txt', { type: 'text/plain' })

      const payload = new FormData()
      payload.append('file',       txtFile)
      payload.append('case_id',    activeCaseId)
      payload.append('email_text', triggerText)

      const resp = await fetch(
        `${(BASE_URL || '').replace(/\/$/, '')}/insurance/web/upload-document`,
        { method: 'POST', body: payload }
      )
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`)

      const data = await resp.json()
      if (!data.success || !data.extracted_fields) throw new Error('No fields returned')

      setFormData(prev => deepMerge(prev, normalizeDatesForForm(stripDropdownFields(data.extracted_fields))))
      setExtractedSuggestions(prev => ({
        ...prev,
        ...flattenExtracted(data.extracted_fields),
        ...(Array.isArray(data.extracted_fields?.suggestedTriggers) && data.extracted_fields.suggestedTriggers.length
          ? { suggestedTriggers: data.extracted_fields.suggestedTriggers }
          : {}),
      }))
      setLastExtractedTrigger({ docLabel: 'Trigger Content', fieldsFound: data.fields_found || 0 })
    } catch (err) {
      console.error('Trigger extraction error:', err)
      alert('Trigger extraction failed. Please try again.')
    }
  }

  // ── Fetch voice-annotated data from mobile ─────────────────────────────
  const handleFetchVoiceData = async () => {
    if (!caseId) return
    setFetching(true)
    try {
      const resp = await fetch(
        `${(BASE_URL || "").replace(/\/$/, "")}/insurance/web/case-documents/${caseId}`
      )
      if (!resp.ok) throw new Error("Failed to fetch")
      const data = await resp.json()
      if (data.merged_extracted_data) {
        setFormData(prev => deepMerge(prev, normalizeDatesForForm(data.merged_extracted_data)))
      }
      const totalVoiceNotes = (data.documents || []).reduce(
        (s, d) => s + (d.voice_notes?.length || 0), 0
      )
      alert(`Fetched data from ${(data.documents || []).length} document(s) with ${totalVoiceNotes} voice note(s). Form updated.`)
    } catch (err) {
      console.error("Fetch error", err)
      alert("Failed to fetch document data. Please try again.")
    } finally {
      setFetching(false)
    }
  }

  const claimPickerDoc   = pickerTarget?.kind === "claim"   ? claimDocs.find(d => d.id === pickerTarget.id)   : null
  const supportPickerDoc = pickerTarget?.kind === "support" ? supportDocs.find(d => d.id === pickerTarget.id) : null

  const claimIdlePlain     = claimDocs.filter(d => d.state === "idle" && !(isPdfFile(d.file) && !d.pageCountFailed))
  const claimIdlePdfCount  = claimDocs.filter(d => d.state === "idle" && isPdfFile(d.file) && !d.pageCountFailed).length
  const supportIdlePlain    = supportDocs.filter(d => d.state === "idle" && !(isPdfFile(d.file) && !d.pageCountFailed))
  const supportIdlePdfCount = supportDocs.filter(d => d.state === "idle" && isPdfFile(d.file) && !d.pageCountFailed).length

  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header" style={{ cursor: "pointer", userSelect: "none" }}
          onClick={() => setExpanded(p => !p)}>
          <div className="panel-title">
            <div className="dot" style={{ background: "var(--teal,#14b8a6)" }} />
            <span>Document Upload</span>
            {totalFound > 0 && (
              <span style={{
                marginLeft: 10, fontSize: 11, fontWeight: 700,
                background: "color-mix(in srgb, var(--teal,#14b8a6) 15%, transparent)",
                color: "var(--teal,#14b8a6)",
                border: "1px solid color-mix(in srgb, var(--teal,#14b8a6) 30%, transparent)",
                borderRadius: 12, padding: "2px 10px",
              }}>{totalFound} fields pre-filled</span>
            )}
            {caseId && (
              <span style={{ marginLeft: 8, fontSize: 10, color: "var(--muted)", fontFamily: "monospace", opacity: 0.55 }}>
                {caseId}
              </span>
            )}
          </div>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {expanded ? "▲ collapse" : "▼ expand"}
          </span>
        </div>

        {expanded && (
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {creditWarning && (
              <div style={{
                padding: "10px 14px", borderRadius: 8, fontSize: 12,
                background: "color-mix(in srgb, var(--amber,#f59e0b) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--amber,#f59e0b) 35%, transparent)",
                color: "var(--amber,#f59e0b)", fontWeight: 600,
              }}>
                ⚠️ Document parsing credits running low ({creditWarning.credits_used}/{creditWarning.credit_budget} used, {creditWarning.percent_used}%). Extraction may fail until the next reset.
              </div>
            )}

            {/* ── SECTION A: Claim Detail Documents ───────────────────── */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
                📋 Claim Detail Documents
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
                The documents that actually contain the claim's mandatory fields (claim form, discharge summary,
                policy copy, etc). PDFs are stored locally first — click one to choose which pages to extract.
              </div>

              <div
                onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf" || f.type.startsWith("image/") || f.name.match(/\.(pdf|jpg|jpeg|png|webp)$/i)); if (files.length) handleClaimFiles(files) }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => claimInputRef.current?.click()}
                style={{
                  border: "1.5px dashed var(--border,#e5e7eb)", borderRadius: 8,
                  padding: "20px 16px", textAlign: "center", cursor: "pointer",
                  background: "var(--bg3,#f3f4f6)", transition: "border-color 0.2s, background 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal,#14b8a6)"; e.currentTarget.style.background = "color-mix(in srgb, var(--teal,#14b8a6) 6%, var(--bg3,#f3f4f6))" }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border,#e5e7eb)"; e.currentTarget.style.background = "var(--bg3,#f3f4f6)" }}
              >
                <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Click to browse or drag & drop</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>PDF or image · Max 20 MB each</div>
              </div>
              <input
                ref={claimInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
                multiple style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.length) handleClaimFiles(e.target.files); e.target.value = "" }}
              />

              {claimDocs.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  {claimDocs.map((doc, i) => (
                    <ClaimDocRow key={doc.id} doc={doc} index={i}
                      onExtract={extractClaimDoc}
                      onView={(id) => setViewingDoc(claimDocs.find(d => d.id === id))}
                      onPick={(id) => setPickerTarget({ kind: "claim", id })}
                      onRemove={handleRemoveClaim} />
                  ))}
                  {claimIdlePlain.length > 0 && (
                    <button type="button" className="btn btn-primary"
                      style={{ alignSelf: "flex-start", marginTop: 2 }}
                      onClick={() => claimIdlePlain.forEach(d => extractClaimDoc(d.id))}>
                      ✨ Extract All ({claimIdlePlain.length} pending)
                    </button>
                  )}
                  {claimIdlePdfCount > 0 && (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {claimIdlePdfCount} PDF{claimIdlePdfCount !== 1 ? "s" : ""} still need page selection — click a document above.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── SECTION B: Supporting Documents ─────────────────────── */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--border,#e5e7eb)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--purple,#7c3aed)", marginBottom: 2 }}>
                🗂️ Supporting Documents
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
                Medical visit records, member visit notes, ID scans, or any other reference material. PDFs are
                stored locally first — click one to choose which pages to store.
              </div>

              <div
                onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf" || f.type.startsWith("image/") || f.name.match(/\.(pdf|jpg|jpeg|png|webp)$/i)); if (files.length) handleSupportFiles(files) }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => supportInputRef.current?.click()}
                style={{
                  border: "1.5px dashed var(--purple,#7c3aed)", borderRadius: 8,
                  padding: "20px 16px", textAlign: "center", cursor: "pointer",
                  background: "color-mix(in srgb, var(--purple,#7c3aed) 4%, var(--bg3,#f3f4f6))",
                  transition: "border-color 0.2s, background 0.2s",
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 6 }}>🗂️</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Click to browse or drag & drop</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>PDF or image · Max 50 MB each · Stored for doctor review</div>
              </div>
              <input
                ref={supportInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
                multiple style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.length) handleSupportFiles(e.target.files); e.target.value = "" }}
              />

              {supportDocs.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  {supportDocs.map((doc, i) => (
                    <SupportDocRow key={doc.id} doc={doc} index={i}
                      onStore={storeSupportDoc}
                      onPick={(id) => setPickerTarget({ kind: "support", id })}
                      onRemove={handleRemoveSupport} />
                  ))}
                  {supportIdlePlain.length > 0 && (
                    <button type="button" className="btn btn-primary"
                      style={{ alignSelf: "flex-start", marginTop: 2, background: "var(--purple,#7c3aed)", borderColor: "var(--purple,#7c3aed)" }}
                      onClick={() => supportIdlePlain.forEach(d => storeSupportDoc(d.id))}>
                      📤 Store All ({supportIdlePlain.length} pending)
                    </button>
                  )}
                  {supportIdlePdfCount > 0 && (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {supportIdlePdfCount} PDF{supportIdlePdfCount !== 1 ? "s" : ""} still need page selection — click a document above.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Trigger Content ──────────────────────────────────────── */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--border,#e5e7eb)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Trigger Content</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                Paste the insurer/TPA investigation instruction here. 
              </div>

              {lastExtractedTrigger && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 12px", marginBottom: 8,
                  background: "color-mix(in srgb, var(--green,#22c55e) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--green,#22c55e) 30%, transparent)",
                  borderRadius: 8, fontSize: 12, color: "var(--green,#16a34a)",
                }}>
                  <span>✓</span>
                  <span>
                    Triggers extracted from this text
                    ({lastExtractedTrigger.docLabel} · {lastExtractedTrigger.fieldsFound} fields)
                  </span>
                  <button
                    type="button"
                    onClick={() => { setLastExtractedTrigger(null); handleExtractTriggers() }}
                    style={{
                      marginLeft: "auto", fontSize: 11, fontWeight: 600,
                      padding: "2px 10px",
                      border: "1px solid color-mix(in srgb, var(--green,#22c55e) 40%, transparent)",
                      borderRadius: 6, background: "transparent",
                      color: "var(--green,#16a34a)", cursor: "pointer",
                    }}
                  >↺ Re-extract with updated text</button>
                </div>
              )}

              <textarea
                value={triggerText}
                onChange={(e) => { setTriggerText(e.target.value); setLastExtractedTrigger(null) }}
                placeholder="Paste trigger / investigation instruction text here (e.g. 'Kindly investigate the following case; 1. Location : Madurai 2. Inflated bill... 3. Webcam image seems suspicious')"
                rows={8}
                style={{
                  width: "100%", border: "1px solid var(--border,#ddd)", borderRadius: 8,
                  padding: 12, fontSize: 13, resize: "vertical"
                }}
              />
              {triggerText.trim() && !lastExtractedTrigger && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <small style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>
                    This text will be analyzed for investigation triggers only
                  </small>
                  <button
                    type="button" className="btn btn-primary"
                    style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0 }}
                    onClick={handleExtractTriggers}
                  >✨ Extract Triggers</button>
                </div>
              )}
            </div>

            {/* Voice fetch strip */}
            {caseId && (
              <div style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                background: "color-mix(in srgb, var(--purple,#7c3aed) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--purple,#7c3aed) 25%, transparent)",
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 18 }}>🎙️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Fetch Voice-Extracted Data</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    Pull the latest merged extractions from voice annotations added via mobile app.
                  </div>
                </div>
                <button type="button" className="btn btn-ghost"
                  style={{ flexShrink: 0, borderColor: "var(--purple,#7c3aed)", color: "var(--purple,#7c3aed)" }}
                  onClick={handleFetchVoiceData} disabled={fetching}>
                  {fetching ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid var(--purple,#7c3aed)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                      Fetching…
                    </span>
                  ) : "↓ Fetch & Apply"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {viewingDoc && (
        <DocumentDrawer doc={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}

      {claimPickerDoc && (
        <PagePickerModal
          doc={claimPickerDoc}
          onClose={() => setPickerTarget(null)}
          actionLabel="✨ Extract"
          actionColor="var(--accent)"
          onConfirm={handleConfirmClaimPages}
        />
      )}

      {supportPickerDoc && (
        <PagePickerModal
          doc={supportPickerDoc}
          onClose={() => setPickerTarget(null)}
          actionLabel="📤 Store"
          actionColor="var(--purple,#7c3aed)"
          onConfirm={handleConfirmSupportPages}
        />
      )}
    </>
  )
}