// Calls to the MACT documents API (public path /hms/mact/..., cookie login).
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const base = `${API_BASE_URL}hms/mact`;

async function read(res) {
  let data = {};
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const d = data.detail;
    const msg = typeof d === "string" ? d
      : d && d.message ? d.message
      : Array.isArray(d) ? d.map((x) => x.msg).join("; ")
      : "Request failed";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const listDocs = async (caseId) =>
  (await read(await fetch(`${base}/cases/${encodeURIComponent(caseId)}/documents`, { credentials: "include" }))).documents || [];

export async function uploadDoc(caseId, file, docName) {
  const form = new FormData();
  form.append("file", file);
  if (docName) form.append("doc_name", docName);
  const res = await fetch(`${base}/cases/${encodeURIComponent(caseId)}/documents`, {
    method: "POST", credentials: "include", body: form,
  });
  return (await read(res)).document;
}

export const deleteDoc = async (docId) =>
  read(await fetch(`${base}/documents/${docId}`, { method: "DELETE", credentials: "include" }));

export const retryDoc = async (docId) =>
  (await read(await fetch(`${base}/documents/${docId}/retry`, { method: "POST", credentials: "include" }))).document;

// The file is behind the login cookie, so it is fetched as a blob and shown from a blob: URL.
export async function fetchDocBlob(docId) {
  const res = await fetch(`${base}/documents/${docId}/file`, { credentials: "include" });
  if (!res.ok) await read(res);
  return res.blob();
}