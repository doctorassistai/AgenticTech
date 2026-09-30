import { R, TODAY, CONV, setConv } from "../data/rules.js";
import { STAGES, approver, GATED_STAGES } from "../data/masters.js";
import { S, log, persist, byId } from "../store.js";
import { SYNCQ, docsFor, docStats, pending, doOffer } from "./engine.js";
import { fd, addDays, L, D, days, hash } from "./helpers.js";
import { sitting, upcomingSittings } from "../data/lokadalat.js";
import { laBand } from "./lokadalat.js";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// Simulated court / connector sync: applies the next queued event.
export function syncNow() {
  if (S.syncIdx >= SYNCQ.length) return { msg: "All courts and connectors are up to date" };
  const ev = SYNCQ[S.syncIdx++]();
  const at = "2026-09-29 " + String(9 + S.syncIdx).padStart(2, "0") + ":0" + S.syncIdx;
  S.activity.unshift(Object.assign({ at }, ev));
  (S.audit[ev.caseId] = S.audit[ev.caseId] || []).unshift({
    at, actor: "System · " + ev.src, action: "Status updated from sync",
    detail: ev.text, model: "—", rule: R.version,
  });
  return { msg: ev.text.slice(0, 90) + (ev.text.length > 90 ? "…" : "") };
}

// Manual petition registration (Sync view form).
const isoNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Fields the views read that the backend may not send yet.
const caseDefaults = () => ({
  district: "—", state: "—", place: "As per petition",
  darOn: null, stage: 0, courtStage: "Notice served (manual)", priority: "Medium",
  officer: "Unassigned", advocate: "—", cAdv: "—", hospital: "—", accType: "—", vehCat: "—",
  victim: { name: "—", age: null, sex: "—", occ: "—" },
  vehicle: { reg: "—", cls: "—", gvw: "—", commercial: false },
  policy: { no: "—", from: null, to: null, kind: "To be matched" },
  driver: { name: "—", dl: "—", cls: "—", valid: "—" },
  claimed: 0, reserve: 0, next: null, purpose: "Appearance",
  income: { claimed: null, range: null, sources: [] }, deps: [],
  q: { emp: "fixed", married: true, depClaim: 0, depIns: 0, consClaim: 0, consIns: 0, medClaim: 0, medVer: 0,
       contribIns: 0, contribTrib: 0, disClaim: 0, disIns: 0, disTrib: 0, months: 0, lossPct: 0,
       attendant: 0, transport: 0, futureMed: 0, pain: 0, amenities: 0 },
  timeline: [], conflicts: [], coverage: [], liab: null, med: null, flags: [], law: [],
});

function withDefaults(c) {
  const d = caseDefaults();
  return {
    ...d, ...c,
    victim: { ...d.victim, ...c.victim },
    vehicle: { ...d.vehicle, ...c.vehicle },
    policy: { ...d.policy, ...c.policy },
    driver: { ...d.driver, ...c.driver },
    income: { ...d.income, ...c.income },
    q: { ...d.q, ...c.q },
    noticeOn: c.noticeOn || c.notice_on || c.filed || isoNow(),
    filed: c.filed || isoNow(),
    accident: c.accident || c.acc || null,
  };
}

// Manual petition registration: POST to the backend, then mirror into local state.
export async function registerCase(payload) {
  const res = await fetch(`${API_BASE_URL}hms/mact/cases`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    const err = new Error(
      typeof d === "string" ? d
      : Array.isArray(d) ? d.map((x) => x.msg).join("; ")
      : "Request failed"
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  const c = withDefaults(data.case);
  S.cases = S.cases.filter((x) => x.id !== c.id);
  S.cases.unshift(c);
  log(c.id, "Case registered manually", `${c.mvc}, ${c.court}`);
  S.activity[0].src = "Manual";
  return c;
}

// Load registered cases from the database into local state (runs once after login).
export async function loadCasesFromDb() {
  const res = await fetch(`${API_BASE_URL}hms/mact/cases?include_samples=false&limit=200`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("list failed " + res.status);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : data.cases || data.items || [];
  const have = new Set(S.cases.map((c) => c.id));
  const fresh = [];
  for (const r of rows) {
    if (!r || !r.id || have.has(r.id)) continue;
    // Summaries may send victim as a plain string or flat fields.
    const victim = typeof r.victim === "string"
      ? { name: r.victim, age: r.age ?? null }
      : r.victim;
    fresh.push(withDefaults({ ...r, victim: victim || {} }));
  }
  S.cases = fresh.concat(S.cases); // real cases first
  return fresh.length;
}

// Old local-only version, no longer used. You can delete this whole function.
function registerCaseLocal(g) {
  const n = +g("age") || 35;
  const c = {
    id: "MACT-2026-" + String(150 + S.cases.length).padStart(4, "0"),
    cnr: g("cnr"), mvc: g("mvc"), court: g("court"), district: "—", state: "Karnataka",
    type: g("type"), nfKind: g("type") === "No-fault" ? "Death" : undefined,
    accident: g("acc"), place: "As per petition", filed: "2026-09-29", noticeOn: "2026-09-29",
    darOn: null, stage: 0, courtStage: "Notice served (manual)", priority: "Medium",
    officer: "Unassigned", advocate: "—", cAdv: "—", hospital: "—", accType: "—", vehCat: "—",
    victim: { name: g("victim"), age: n, sex: "—", occ: "—" },
    vehicle: { reg: "—", cls: "—", gvw: "—", commercial: false },
    policy: { no: g("pol"), from: "2026-01-01", to: "2026-12-31", kind: "To be matched" },
    driver: { name: "—", dl: "—", cls: "—", valid: "—" },
    claimed: +g("claim") || 0, reserve: 0, next: null, purpose: "Appearance",
    income: { claimed: null, range: null, sources: [] }, deps: [],
    q: { emp: "fixed", married: true, depClaim: 0, depIns: 0, consClaim: 0, consIns: 0, medClaim: 0, medVer: 0,
         contribIns: 0, contribTrib: 0, disClaim: 0, disIns: 0, disTrib: 0, months: 0, lossPct: 0,
         attendant: 0, transport: 0, futureMed: 0, pain: 0, amenities: 0 },
    timeline: [], conflicts: [], coverage: [], liab: null, med: null, flags: [], law: [],
  };
  S.cases.unshift(c);
  log(c.id, "Case registered manually", `${c.mvc}, ${c.court}; documents requested from connectors`);
  S.activity[0].src = "Manual";
  return c;
}


const ME = "Admin (you)";

// ── Finding decisions ──
export function decideAccept(f) {
  S.decisions[f.id] = { d: "accept", note: "", by: ME, at: fd(TODAY) };
  log(S.caseId, "Finding accepted", f.id);
  persist.set("decisions", S.decisions);
}

export function decideSave(f, mode, note) {
  S.decisions[f.id] = { d: mode, note, by: ME, at: fd(TODAY) };
  log(S.caseId, "Finding " + (mode === "modify" ? "modified" : "rejected"), f.id + " — " + note);
  persist.set("decisions", S.decisions);
}

export function undoDecision(f) {
  delete S.decisions[f.id];
  log(S.caseId, "Finding reopened", f.id);
  persist.set("decisions", S.decisions);
}

// ── Documents ──
export function requestAllMissing(c) {
  const m = docsFor(c).filter((d) => !["Received", "Not due"].includes(d.st));
  log(c.id, "Documents requested", m.map((d) => d.name).join(", ") || "none");
  return m.length ? `${m.length} requests sent; retry daily until received` : "Nothing missing";
}

export function uploadDocs(c, fileList) {
  const fs = Array.from(fileList || []);
  if (!fs.length) return "No files selected";
  S.uploads[c.id] = (S.uploads[c.id] || []).concat(
    fs.map((f) => ({
      name: f.name, src: "Manual upload", ch: "Upload", st: "Received",
      pages: Math.max(1, Math.round(f.size / 60000)), conf: 91, recv: fd(TODAY), fields: 0,
    }))
  );
  log(c.id, "Documents uploaded", fs.map((f) => f.name).join(", "));
  return fs.length + " file(s) queued for extraction";
}

// ── Stage gate. Returns { msg, tab? }; tab is set when the gate blocks and the user should be sent there ──
export function advanceStage(c) {
  if (c.stage === 4 && !c.darOn) return { msg: "DAR not received — surveyor verification cannot start", tab: "dar" };
  const n = pending(c);
if (GATED_STAGES.includes(c.stage) && n)
    return { msg: `Decide ${n} pending finding${n > 1 ? "s" : ""} before leaving “${STAGES[c.stage].n}”`, tab: "overview" };
  if (c.stage === 2 && docStats(c).p < 0.8)
    return { msg: "Document gate: at least 80% of documents must be received", tab: "documents" };
  c.stage++;
  log(c.id, "Stage advanced", "→ " + STAGES[c.stage].n);
  return { msg: "Moved to " + STAGES[c.stage].n };
}

// Local-date ISO string (toISOString() would shift the day in timezones ahead of UTC).
const isoToday = () => {
  const d = TODAY;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── Quantum inputs ──
export function setQuantumInput(c, key, val) {
  S.edit[c.id] = S.edit[c.id] || {};
  S.edit[c.id][key] = val;
  log(c.id, "Quantum input changed", key + " = " + val);
  persist.set("edit", S.edit);
}
export function resetQuantum(c) {
  delete S.edit[c.id];
  persist.set("edit", S.edit);
}

// ── Surveyor ──
export function recordSurvey(c, dispute) {
  if (dispute) c.darDispute = "Surveyor found material discrepancies with the DAR; report forwarded to the Deputy Commissioner of Police.";
  c._f = null;
  if (c.stage < 5) c.stage = 5;
  log(c.id, "Surveyor report recorded", dispute ? "DAR disputed — report to DCP" : "DAR accepted");
  return dispute ? "DAR dispute recorded; report sent to DCP" : "DAR accepted; moved to coverage & liability review";
}

// ── Settlement (Form XI) ──
export function settleAccept(c) {
  const st = c.settle;
  st.status = "Accepted — record of settlement";
  st.settled = st.offer || doOffer(c);
  st.settledOn = isoToday();
  st.note = `Deposit due ${fd(addDays(st.settledOn, R.settleDepositDays))}`;
  log(c.id, "Claimant accepted Form XI", `${L(st.settled)} · deposit due ${fd(addDays(st.settledOn, R.settleDepositDays))}`);
  return "Settlement recorded — 30-day deposit clock started";
}
export function settleReject(c) {
  const st = c.settle;
  st.offer = st.offer || doOffer(c);
  st.status = "Rejected — inquiry limited to enhancement";
  st.note = `Offered ${L(st.offer)} is the floor`;
  log(c.id, "Claimant rejected Form XI", "Inquiry limited to enhancement; floor " + L(st.offer));
  return "Rejection recorded — inquiry limited to enhancement";
}
export function settleFile(c) {
  c.settle = { status: "Offer made", offerOn: isoToday(), offer: doOffer(c), demand: null, note: "Form XI filed before tribunal" };
  log(c.id, "Form XI filed", L(c.settle.offer) + " · approval: " + approver(c.settle.offer));
  return "Form XI recorded as filed";
}

// ── Award / appeal ──
export function decideAward(c, mode) {
  c.award.decided = true;
  if (mode === "override")
    c.award.decision = "Opposite of proposal recorded by Admin: " + (c.award.decision.startsWith("No appeal") ? "appeal to be filed" : "comply, no appeal");
  log(c.id, "Appeal decision", c.award.decision);
}

// ── Clipboard ──
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return "Copied to clipboard";
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let msg = "Select the text and copy manually";
    try { if (document.execCommand("copy")) msg = "Copied to clipboard"; } catch { /* keep msg */ }
    ta.remove();
    return msg;
  }
}



// ── Conventional heads step (rules master) ──
export function applyConv(step) {
  setConv(step);
  persist.set("conv", R.convStep);
  return "Conventional heads set to " + CONV[R.convStep].label;
}


// ───────────── Lok Adalat ─────────────
export function laList(id, sid) {
  const c = byId(id), st = sitting(sid);
  S.la[id] = { caseId: id, sitting: sid, stage: 1, ref: "Application by insurer, s.20(1)", rounds: [], mandate: null, outcome: null, returned: false };
  c.courtStage = "Referred to Lok Adalat — " + fd(st.date);
  log(id, "Listed for Lok Adalat", st.name + ", " + fd(st.date));
  return "Listed for " + st.name;
}

export function laRelist(id) {
  const la = S.la[id];
  const nx = upcomingSittings().find((x) => x.id !== la.sitting) || upcomingSittings()[0];
  Object.assign(la, { sitting: nx.id, returned: false, stage: Math.max(1, Math.min(la.stage, 3)) });
  log(id, "Re-listed for Lok Adalat", nx.name + ", " + fd(nx.date));
}

export function laAdjourn(id) {
  const la = S.la[id];
  const nx = upcomingSittings().find((x) => D(x.date) > D(sitting(la.sitting).date));
  if (!nx) return "No later sitting on the calendar";
  la.sitting = nx.id;
  log(id, "Moved to next Lok Adalat", nx.name + ", " + fd(nx.date));
  return "Moved to " + nx.name;
}

export function laRequestMandate(id) {
  const b = laBand(byId(id));
  S.la[id].mandate = { amt: b.ceiling, level: approver(b.ceiling), status: "Pending", on: null };
  log(id, "Lok Adalat mandate requested", `${L(b.ceiling)} — ${approver(b.ceiling)}`);
  return "Mandate request sent to " + approver(b.ceiling);
}

export function laApproveMandate(id) {
  const la = S.la[id];
  la.mandate.status = "Approved";
  la.mandate.on = isoToday();
  if (la.stage < 3) la.stage = 3;
  log(id, "Lok Adalat mandate approved", `${L(la.mandate.amt)} by ${la.mandate.level}`, la.mandate.level);
  return "Mandate approved";
}

export function laAddRound(id, r) {
  if (!r.demand || !r.offer) return "Enter both demand and offer";
  const la = S.la[id];
  la.rounds.push({ date: isoToday(), where: r.where, demand: r.demand, offer: r.offer, note: r.note });
  if (la.stage < 2) la.stage = 2;
  log(id, "Lok Adalat negotiation round", `${r.where}: demand ${L(r.demand)}, offer ${L(r.offer)}`);
  return null;
}

// Returns an error message, or null on success. Settling above the approved mandate is blocked.
export function laSettle(id, amt) {
  const c = byId(id), la = S.la[id], st = sitting(la.sitting);
  if (!amt || amt <= 0) return "Enter the settled amount";
  const mand = la.mandate && la.mandate.status === "Approved" ? la.mandate.amt : 0;
  if (amt > mand) return `${L(amt)} exceeds the approved mandate${mand ? " of " + L(mand) : ""}. Obtain approval from ${approver(amt)} first.`;
  const on = days(TODAY, D(st.date)) > 0 ? isoToday() : st.date;
  la.stage = 5; la.returned = false;
  la.outcome = { amt, date: on, award: "LA/" + st.id.split("-")[0] + "/" + on.slice(0, 4) + "/" + String(1000 + (hash(id) % 9000)) };
  c.settle = Object.assign(c.settle || {}, { status: "Settled — Lok Adalat award", settled: amt, settledOn: on, note: `Award under s.21 — deemed decree, no appeal; pay within ${R.settleDepositDays} days` });
  c.stage = 14; c.courtStage = "Disposed — Lok Adalat award"; c.next = null;
  c.purpose = "Pay Lok Adalat award by " + fd(addDays(on, R.settleDepositDays));
  log(id, "Settled in Lok Adalat", `${L(amt)} at ${st.name} (award ${la.outcome.award}); payment due ${fd(addDays(on, R.settleDepositDays))}`);
  return null;
}

export function laFail(id) {
  S.la[id].returned = true;
  byId(id).courtStage = "Returned from Lok Adalat — regular board";
  log(id, "Not settled at Lok Adalat", "Returned to tribunal without prejudice (s.20(5))");
  return "Recorded as not settled — case returns to the tribunal";
}

export function laPay(id, utr) {
  const c = byId(id), la = S.la[id];
  c.payment = { on: isoToday(), utr: utr || "UTR (to be entered)", note: "Lok Adalat award paid" };
  la.stage = 6;
  if (c.recovery) {
    c.recovery.recovered = c.recovery.recovered || [];
    c.recovery.ep = c.recovery.ep || "Recovery petition to be filed on the reserved right";
    c.recovery.next = c.recovery.next || "Issue recovery notice to owner";
    c.stage = 15;
  } else c.stage = 16;
  log(id, "Lok Adalat award paid", `${L(la.outcome.amt)} · ${c.payment.utr}`);
  return "Payment recorded";
}