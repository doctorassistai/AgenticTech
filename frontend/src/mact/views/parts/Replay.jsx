import React from "react";
import { S } from "../../store";
import { R, MODEL } from "../../data/rules";
import { LAW, STAT } from "../../data/masters";
import { scenarios, quantum, findings, docsFor, pending } from "../../lib/engine";
import { INR, L } from "../../lib/helpers";

const verdict = (d) => (d.d === "accept" ? "Accepted" : d.d === "reject" ? "Rejected" : "Modified");

function Chain({ steps }) {
  return (
    <div className="chain">
      {steps.map(([k, v]) => (
        <div className="cstep" key={k}><span className="lbl">{k}</span><div>{v}</div></div>
      ))}
    </div>
  );
}

// Data-driven: the finding's own `impact` key decides which input is swapped.
function calcText(c, f) {
  const s = scenarios(c);
  if (!s || !f.impact || !c.income || !c.income.range) return "Not a quantum finding.";
  const q = c.q, mid = (c.income.range[0] + c.income.range[1]) / 2;
  const b = { income: mid, dep: q.depClaim, cons: q.consClaim, med: q.medVer || q.medClaim, disab: q.disTrib, contrib: q.contribTrib };
  const alt = { ...b };
  let lbl = "";
  if (f.impact === "income" && c.income.claimed) { alt.income = c.income.claimed; lbl = `income ${INR(c.income.claimed)} (claimed) vs ${INR(mid)} (evidence midpoint)`; }
  if (f.impact === "disab") { alt.disab = c.med.disClaim; lbl = `disability ${c.med.disClaim}% (claimed) vs ${q.disTrib}% (probable functional)`; }
  if (f.impact === "dep") { alt.dep = q.depIns; alt.cons = q.consIns; lbl = `${q.depClaim} vs ${q.depIns} dependants`; }
  if (f.impact === "contrib") { alt.contrib = q.contribIns; lbl = `contributory negligence ${q.contribIns}% vs ${q.contribTrib}%`; }
  if (!lbl) return "Not a quantum finding.";
  const d = quantum(c, alt).net - quantum(c, b).net;
  return `Deterministic engine ${R.version}: ${lbl} changes net compensation by ${L(Math.abs(d))}.`;
}

export function FindingReplay({ c, f }) {
  const d = S.decisions[f.id];
  const laws = (f.law || []).filter((k) => LAW[k]);
  const steps = [
    ["Question", f.q || f.title],
    ["Evidence", <ul style={{ margin: 0, paddingLeft: 18 }}>{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>],
    ["Conflicts", (c.conflicts || []).length ? c.conflicts.map((x, i) => <div key={i}>{x[0]} ↔ {x[1]}</div>) : "None recorded"],
    ["Legal rules", (STAT[f.engine] || ["—"]).map((x, i) => <div key={i}>{x}</div>)],
    ["Precedents", laws.length ? laws.map((k) => <div key={k}>{LAW[k].t}, {LAW[k].c}</div>) : "None required"],
    ["Calculation", calcText(c, f)],
    ["AI assessment", <>{f.detail}<br /><span className="mute">Confidence {f.conf} · {f.engine} · {MODEL.reason}</span></>],
    ["Human decision", d ? `${verdict(d)} by ${d.by} on ${d.at}${d.note ? " — " + d.note : ""}` : <span className="pill d">Pending review</span>],
  ];
  return (
    <>
      <span className="lbl">Reasoning replay · {c.id}</span>
      <h2 style={{ margin: "4px 0 14px" }}>{f.title}</h2>
      <Chain steps={steps} />
    </>
  );
}

export function CaseReplay({ c }) {
  const F = findings(c), s = scenarios(c);
  const rec = docsFor(c).filter((d) => d.st === "Received").map((d) => d.name).join(" · ");
  const breaches = (c.coverage || []).filter((r) => r[3] !== "ok").map((r) => r[0]).join(" · ");
  const laws = [...new Set(c.law || [])].filter((k) => LAW[k]);
  const steps = [
    ["Question", "Is insurer liability established, and what is the probable quantum?"],
    ["Evidence", rec || "Awaiting documents"],
    ["Conflicts", (c.conflicts || []).length ? c.conflicts.map((x, i) => <div key={i}>{x[0]} ↔ {x[1]}</div>) : "None"],
    ["Legal rules", `MV Act ss.147, 149, 166, 168 · ${breaches || "no policy defences"}`],
    ["Precedents", laws.length ? laws.map((k) => <div key={k}>{LAW[k].t}</div>) : "—"],
    ["Calculation", s && c.income && c.income.range
      ? `Insurer ${L(s.insurer.net)} · tribunal-method ${L(s.tribunal.net)} (range ${L(s.band[0])}–${L(s.band[1])}) · claimant ${L(s.claimant.net)} — ${R.version}`
      : "Pending"],
    ["AI assessment", `${F.length} findings: ${F.filter((f) => f.sev === "high").length} high, ${F.filter((f) => f.sev === "med").length} medium.`],
    ["Human decision", `${F.filter((f) => S.decisions[f.id]).length} of ${F.length} findings decided · ${pending(c)} pending`],
  ];
  return (
    <>
      <span className="lbl">Reasoning replay · {c.id}</span>
      <h2 style={{ margin: "4px 0 14px" }}>How the case assessment was reached</h2>
      <Chain steps={steps} />
    </>
  );
}