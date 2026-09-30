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
function ClaimDocRow({ doc, index, onExtract, onView, onRemove }) {
  const busy = doc.state === "uploading" || doc.state === "extracting"
  const colors = ["var(--accent)", "var(--teal,#14b8a6)", "var(--amber,#f59e0b)", "var(--green,#16a34a)"]
  const color  = colors[index % colors.length]

  const statusMsg = () => {
    if (doc.state === "idle")       return <StatusRow color="var(--muted)">Ready to extract — remove if added by mistake</StatusRow>
    if (doc.state === "uploading")  return <StatusRow color="var(--accent)" spin>Uploading…</StatusRow>
    if (doc.state === "extracting") return <StatusRow color="var(--amber,#f59e0b)" spin>Parsing & extracting…</StatusRow>
    if (doc.state === "error")      return <StatusRow color="var(--red,#dc2626)">Failed — retry</StatusRow>
    if (doc.state === "done")       return <StatusRow color={color}>✓ {doc.fieldsFound || 0} fields</StatusRow>
    return null
  }

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

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap",
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
          <button type="button" className="btn btn-primary"
            style={{ fontSize: 11, padding: "5px 10px", background: color, borderColor: color }}
            onClick={() => onExtract(doc.id)}>✨ Extract</button>
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
function SupportDocRow({ doc, index, onStore, onRemove }) {
  const busy = doc.state === "uploading"
  const color = "var(--purple,#7c3aed)"

  const statusMsg = () => {
    if (doc.state === "idle")      return <StatusRow color="var(--muted)">Ready to store — remove if added by mistake</StatusRow>
    if (doc.state === "uploading") return <StatusRow color={color} spin>Uploading…</StatusRow>
    if (doc.state === "error")     return <StatusRow color="var(--red,#dc2626)">Failed — retry</StatusRow>
    if (doc.state === "done")      return <StatusRow color={color}>✓ Stored — available for doctor review</StatusRow>
    return null
  }

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

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap",
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
          <button type="button" className="btn btn-primary"
            style={{ fontSize: 11, padding: "5px 10px", background: color, borderColor: color }}
            onClick={() => onStore(doc.id)}>📤 Store</button>
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
  const [expanded, setExpanded]       = useState(true)
  // Stored on formData so it is saved with the case (draft save + submit)
  const triggerText = formData?.triggerContent || ""
  const setTriggerText = (v) => setFormData(prev => ({ ...prev, triggerContent: v }))
    const [fetching, setFetching]       = useState(false)
const [lastExtractedTrigger, setLastExtractedTrigger] = useState(null)
  const [creditWarning, setCreditWarning] = useState(null)
  const creatingCase = useRef(false)
  const caseIdRef    = useRef(caseId || null)

  // Keep caseIdRef in sync with the caseId prop. Without this, editing an
  // existing case (where NewCase.jsx passes down a real caseId from the
  // very first render) still starts this component's ref at null, so the
  // first upload in the session thinks there's no case yet and creates a
  // brand-new draft case instead of attaching the document to the case
  // being edited.
  React.useEffect(() => {
    if (caseId) caseIdRef.current = caseId
  }, [caseId])

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
      }))
      return [...prev, ...newDocs]
    })

    // Page count is display-only now (no selection) — fetch in the
    // background just to show the "N pages" marker on the row.
    checkedFiles.forEach((file, i) => {
      if (!isPdfFile(file)) return
      getPdfPageCount(file).then(count => {
        if (count != null) updateClaimDoc(newIds[i], { pageCount: count })
      })
    })
  }, [])
  const pollClaimDocTask = async (id, taskId) => {
    const base = (BASE_URL || "").replace(/\/$/, "")
    const POLL_INTERVAL_MS = 3000
    const MAX_ATTEMPTS = 600 // ~30 minutes ceiling
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      let statusResp
      try {
        statusResp = await fetch(`${base}/insurance/web/advanced-upload/status/${taskId}`)
      } catch (err) {
        continue // transient network hiccup — keep polling, don't fail the doc
      }
      if (!statusResp.ok) continue
      const statusData = await statusResp.json().catch(() => null)
      if (!statusData) continue

      if (statusData.status === "success") {
        const data = statusData.result || {}
        if (data.extracted_fields) {
          setFormData(prev => deepMerge(prev, normalizeDatesForForm(stripDropdownFields(data.extracted_fields))))
          setExtractedSuggestions(prev => ({
            ...prev,
            ...flattenExtracted(data.extracted_fields),
            ...(Array.isArray(data.extracted_fields?.suggestedTriggers) && data.extracted_fields.suggestedTriggers.length
              ? { suggestedTriggers: data.extracted_fields.suggestedTriggers }
              : {}),
          }))
        }
        updateClaimDoc(id, {
          state: "done", label: data.display_label || undefined,
          extractedFields: data.extracted_fields || {},
          pdfUrl: data.pdf_url || null,
          docId: data.doc_id || null,
          fieldsFound: data.fields_found || 0,
        })
        return
      }

      if (statusData.status === "failed" || statusData.status === "rejected") {
        console.error("Claim document extraction failed:", statusData.error)
        updateClaimDoc(id, { state: "error" })
        return
      }
      // "queued" / "processing" — keep polling
    }

    // Timed out client-side without a terminal status. The backend job
    // itself may still complete — surface as error so the user can retry
    // (check-file-ingested will short-circuit the retry if it finished).
    console.warn("Claim document extraction poll timed out for task", taskId)
    updateClaimDoc(id, { state: "error" })
  }

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
      if (!data.success) throw new Error("Upload returned empty")

      // Trigger-content (.txt) uploads still return extracted_fields
      // synchronously — no task to poll. Everything else is now queued.
      if (data.extraction_mode === "trigger" && data.extracted_fields) {
        setFormData(prev => deepMerge(prev, normalizeDatesForForm(stripDropdownFields(data.extracted_fields))))
        updateClaimDoc(id, {
          state: "done", label: data.display_label || doc.label,
          extractedFields: data.extracted_fields,
          fieldsFound: data.fields_found || 0,
        })
        return
      }

      if (!data.task_id) throw new Error("No task_id returned for queued extraction")
      updateClaimDoc(id, { docId: data.doc_id || null, pdfUrl: data.pdf_url || null })
      await pollClaimDocTask(id, data.task_id)
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

  const handleSupportFiles = useCallback(async (files) => {
    if (supportLocked) {
      alert("Finish extracting Claim Detail Documents first — Supporting Documents are processed after.")
      return
    }
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
      }))
      return [...prev, ...newDocs]
    })

    checkedFiles.forEach((file, i) => {
      if (!isPdfFile(file)) return
      getPdfPageCount(file).then(count => {
        if (count != null) updateSupportDoc(newIds[i], { pageCount: count })
      })
    })
  }, [])

  const storeSupportDoc = async (id, overrideFile) => {
    if (supportLocked) {
      alert("Finish extracting Claim Detail Documents first — Supporting Documents are processed after.")
      return
    }
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

      // Upload succeeded — that's all the allocation team needs to know.
      // Parsing/extraction runs in the background and is queued server-side
      // already; its status only ever shows up on the doctor's page.
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

const claimIdle   = claimDocs.filter(d => d.state === "idle")
  const supportIdle = supportDocs.filter(d => d.state === "idle")

  // Claim Detail Documents take priority — Supporting Documents must wait
  // until every claim doc currently added has finished extracting (or has
  // no docs added yet, in which case there's nothing to block on).
  const claimDocsBusy    = claimDocs.some(d => d.state === "uploading" || d.state === "extracting")
  const claimDocsPending = claimDocs.some(d => d.state === "idle" || d.state === "error")
  const supportLocked    = claimDocsBusy || claimDocsPending
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
                      onRemove={handleRemoveClaim} />
                  ))}
                  {claimIdle.length > 0 && (
                    <button type="button" className="btn btn-primary"
                      style={{ alignSelf: "flex-start", marginTop: 2 }}
                      onClick={() => claimIdle.forEach(d => extractClaimDoc(d.id))}>
                      ✨ Extract All ({claimIdle.length} pending)
                    </button>
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

              {supportLocked && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                  padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: "color-mix(in srgb, var(--amber,#f59e0b) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--amber,#f59e0b) 30%, transparent)",
                  color: "var(--amber,#f59e0b)",
                }}>
                  🔒 Finish extracting Claim Detail Documents above first
                </div>
              )}
              <div
                onDrop={(e) => { e.preventDefault(); if (supportLocked) { alert("Finish extracting Claim Detail Documents first — Supporting Documents are processed after."); return } const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf" || f.type.startsWith("image/") || f.name.match(/\.(pdf|jpg|jpeg|png|webp)$/i)); if (files.length) handleSupportFiles(files) }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => { if (supportLocked) { alert("Finish extracting Claim Detail Documents first — Supporting Documents are processed after."); return } supportInputRef.current?.click() }}
                style={{
                  border: "1.5px dashed var(--purple,#7c3aed)", borderRadius: 8,
                  padding: "20px 16px", textAlign: "center", cursor: supportLocked ? "not-allowed" : "pointer",
                  background: "color-mix(in srgb, var(--purple,#7c3aed) 4%, var(--bg3,#f3f4f6))",
                  transition: "border-color 0.2s, background 0.2s",
                  opacity: supportLocked ? 0.5 : 1,
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
                      onRemove={handleRemoveSupport} />
                  ))}
                  {supportIdle.length > 0 && (
                    <button type="button" className="btn btn-primary"
                      disabled={supportLocked}
                      style={{
                        alignSelf: "flex-start", marginTop: 2,
                        background: "var(--purple,#7c3aed)", borderColor: "var(--purple,#7c3aed)",
                        opacity: supportLocked ? 0.5 : 1, cursor: supportLocked ? "not-allowed" : "pointer",
                      }}
                      onClick={() => { if (supportLocked) return; supportIdle.forEach(d => storeSupportDoc(d.id)) }}>
                      📤 Store All ({supportIdle.length} pending)
                    </button>
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

      </>
  )
}