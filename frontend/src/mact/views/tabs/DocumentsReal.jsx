import React, { useEffect, useRef, useState } from "react";
import { S } from "../../store";
import { docsFor, docStats } from "../../lib/engine";
import { useMact } from "../../ctx";
import { listDocs, uploadDoc, deleteDoc, retryDoc, fetchDocBlob } from "../../lib/docsApi";

const MAX_BYTES = 20 * 1024 * 1024;
const OK_NAME = /\.(pdf|jpe?g|png|webp)$/i;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

// Opens in the console modal. The file is fetched with the login cookie and shown from a blob: URL.
export function DocViewer({ doc }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let made = null, dead = false;
    fetchDocBlob(doc.id)
      .then((b) => { if (dead) return; made = URL.createObjectURL(b); setUrl(made); })
      .catch((e) => { if (!dead) setErr(e.message || "Could not open the file"); });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [doc.id]);
  const isPdf = doc.content_type === "application/pdf";
  return (
    <>
      <span className="lbl">{doc.doc_name || "Other document"} · {doc.case_id}</span>
      <h3 style={{ margin: "4px 0 12px" }}>{doc.file_name}</h3>
      {err ? <p className="mute">{err}</p>
        : !url ? <p className="mute">Loading…</p>
        : isPdf ? <iframe title={doc.file_name} src={url} style={{ width: "min(960px, 84vw)", height: "72vh", border: "1px solid var(--line2)" }} />
        : <img alt={doc.file_name} src={url} style={{ maxWidth: "min(960px, 84vw)", maxHeight: "72vh" }} />}
      {url ? (
        <div className="row" style={{ marginTop: 10 }}>
          <a className="btn s g" href={url} download={doc.file_name}>Download</a>
        </div>
      ) : null}
    </>
  );
}

const parseBadge = (f) =>
  f.status === "parsing" ? <span className="pill d">Parsing…</span>
  : f.status === "parsed" ? <span className="pill s">Parsed · {f.pages} p</span>
  : f.status === "skipped" ? <span className="pill d" title={f.error || ""}>Parse skipped</span>
  : <span className="pill k" title={f.error || ""}>Parse failed</span>;

export function RealDocuments({ c }) {
  const { refresh, toast, showModal } = useMact();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = async () => {
    try {
      S.docs[c.id] = await listDocs(c.id);
      if (alive.current) refresh();
    } catch (e) {
      if (alive.current) toast(e.message || "Could not load documents");
    }
  };

  const files = S.docs[c.id] || [];
  const parsing = files.some((f) => f.status === "parsing");
  // While anything is being parsed, check again every 4 seconds.
  useEffect(() => {
    if (!parsing) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [parsing, c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = docsFor(c);
  const ds = docStats(c);
  const other = files.filter((f) => !rows.some((r) => r.name === f.doc_name));

  const pick = async (fileList, docName) => {
    const fs = Array.from(fileList || []);
    if (!fs.length) return;
    setBusy(true);
    let ok = 0;
    const errs = [];
    for (const f of fs) {
      if (!OK_NAME.test(f.name)) { errs.push(`${f.name}: only PDF, JPG, PNG or WebP`); continue; }
      if (f.size > MAX_BYTES) { errs.push(`${f.name}: over 20 MB`); continue; }
      try { await uploadDoc(c.id, f, docName); ok++; } catch (e) { errs.push(`${f.name}: ${e.message}`); }
    }
    await load();
    if (alive.current) setBusy(false);
    toast(ok ? `${ok} file(s) uploaded, parsing started${errs.length ? " · " + errs[0] : ""}` : errs[0] || "Nothing uploaded");
  };

  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.file_name}?`)) return;
    try { await deleteDoc(f.id); toast("Document removed"); } catch (e) { toast(e.message); }
    await load();
  };
  const retry = async (f) => {
    try { await retryDoc(f.id); toast("Parsing restarted"); } catch (e) { toast(e.message); }
    await load();
  };

  const uploadBtn = (docName, label, primary) => (
    <label className={`btn ${primary ? "k" : "s g"}`} style={busy ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      {label}
      <input type="file" multiple hidden accept={ACCEPT}
        onChange={(e) => { pick(e.target.files, docName); e.target.value = ""; }} />
    </label>
  );

  const fileLine = (f) => (
    <div className="li" key={f.id}>
      <span title={f.file_name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{f.file_name}</span>
      <span className="row" style={{ gap: 6 }}>
        {parseBadge(f)}
        {f.status === "failed" || f.status === "skipped" ? <button className="btn s g" onClick={() => retry(f)}>Retry</button> : null}
        <button className="btn s g" onClick={() => showModal(<DocViewer doc={f} />)}>View</button>
        <button className="btn s g" onClick={() => remove(f)}>Remove</button>
      </span>
    </div>
  );

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="panel"><span className="lbl">Collected</span><h2>{ds.r} / {ds.t}</h2></div>
        <div className="panel"><span className="lbl">Files uploaded</span><h2>{files.length}</h2></div>
        <div className="panel"><span className="lbl">Awaiting upload</span><h2>{rows.filter((x) => !["Received", "Not due"].includes(x.st)).length}</h2></div>
        <div className="panel"><span className="lbl">Pages parsed</span><h2>{files.reduce((s, f) => s + (f.status === "parsed" ? f.pages : 0), 0)}</h2></div>
      </div>
      <div className="row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <p className="mute">Upload one document per file (PDF, JPG, PNG or WebP, up to 20 MB). Each file is parsed after upload; several files can back the same document.</p>
        {uploadBtn(null, "Upload other document", true)}
      </div>

      <div className="tw panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Document</th><th>Source</th><th>Status</th><th>Received</th><th>Files</th><th className="r">Pages</th><th className="r" /></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.name}>
                <td>{x.name}</td>
                <td className="mute">{x.src}</td>
                <td>{x.st === "Received" ? <span className="pill k">Received</span> : x.st === "Not due" ? <span className="pill s">Not due</span> : <span className="pill d">{x.st}</span>}</td>
                <td>{x.recv}</td>
                <td style={{ minWidth: 300 }}>{x.files.length ? x.files.map(fileLine) : <span className="mute">—</span>}</td>
                <td className="r">{x.pages || "—"}</td>
                <td className="r">{uploadBtn(x.name, x.files.length ? "Add file" : "Upload")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {other.length ? (
        <div className="panel" style={{ marginTop: 18 }}>
          <div className="ph"><h4>Other documents</h4><span className="mute" style={{ fontSize: 12 }}>not linked to a checklist item; not counted in the collection gate</span></div>
          {other.map(fileLine)}
        </div>
      ) : null}
    </>
  );
}