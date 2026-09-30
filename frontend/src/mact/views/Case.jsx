import React, { useEffect } from "react";
import { S, byId, isReal } from "../store";
import { R } from "../data/rules";
import { STAGES, hubOf } from "../data/masters";
import { exposure, interestTo } from "../lib/engine";
import { L, fd } from "../lib/helpers";
import { useMact } from "../ctx";
import { advanceStage } from "../lib/actions";
import { listDocs } from "../lib/docsApi";
import Cases from "./Cases";
import {
  Overview, Documents, Twin, Timeline, Coverage, Liability, Medical, Income, Dependency,
} from "./tabs/Tabsa";
import {
  Dar, Quantum, Legal, Integrity, Drafts, Settlement, Award, Recovery, Audit,
} from "./tabs/Tabsb";
import { LokAdalatTab } from "./tabs/TabLA";
const TABS = [
  ["overview", "Workspace"], ["dar", "DAR & surveyor"], ["documents", "Documents"], ["twin", "Evidence graph"],
  ["timeline", "Reconstruction"], ["coverage", "Coverage"], ["liability", "Liability"], ["medical", "Medical"],
  ["income", "Income"], ["dependency", "Dependants"], ["quantum", "Compensation"], ["legal", "Legal & precedents"],
  ["integrity", "Integrity"], ["drafts", "Drafts"],["settlement", "Settlement"], ["lokadalat", "Lok Adalat"], ["award", "Award & appeal"],
  ["recovery", "Recovery"], ["audit", "Audit trail"],
];

// Add each newly ported tab here.
const TAB_VIEWS = {
  overview: Overview, documents: Documents, twin: Twin, timeline: Timeline, coverage: Coverage,
  liability: Liability, medical: Medical, income: Income, dependency: Dependency,
  dar: Dar, quantum: Quantum, legal: Legal, integrity: Integrity, drafts: Drafts,
 settlement: Settlement, lokadalat: LokAdalatTab, award: Award,recovery: Recovery, audit: Audit,
};

const Unported = () => <p className="mute">This tab is ported in the next batch.</p>;

export default function Case() {
  const { go, refresh, toast, setTab, showCaseReplay } = useMact();
  const c = byId(S.caseId);
  useEffect(() => {
    if (!c || !isReal(c)) return undefined;
    let dead = false;
    listDocs(c.id).then((l) => { if (!dead) { S.docs[c.id] = l; refresh(); } }).catch(() => {});
    return () => { dead = true; };
  }, [S.caseId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <p className="mute">Case not found: {String(S.caseId)}</p>;
  
  const tabs = TABS.filter(
    ([k]) =>
      !(k === "medical" && c.type === "Death" && !c.med) &&
      !(k === "dependency" && !(c.deps && c.deps.length))
  );
  const ex = exposure(c);
  const hub = hubOf(c);
  const Body = TAB_VIEWS[S.tab] || (TABS.some((t) => t[0] === S.tab) ? Unported : Overview);
  const resNote =
    c.reserve && ex.v ? (c.reserve < ex.v * 0.9 ? "below expected" : c.reserve > ex.v * 1.2 ? "above expected" : "aligned") : "—";

  const advance = () => {
    const r = advanceStage(c);
    toast(r.msg);
    if (r.tab) S.tab = r.tab;
    refresh();
  };

  return (
    <>
      <div className="top">
        <div>
          <span className="lbl">
            <a href="#cases" style={{ color: "inherit" }} onClick={(e) => { e.preventDefault(); go("cases"); }}>Case register</a> / {c.id}
          </span>
          <h1>{c.victim.name}</h1>
          <p className="sub">
            {c.type === "No-fault" ? "No-fault (s.164) " + String(c.nfKind).toLowerCase() : c.type} claim · {hub.name} · {c.mvc} · {c.court} · CNR{" "}
            <span className="mono">{c.cnr}</span> · Accident {fd(c.accident)} at {c.place}
          </p>
        </div>
        <div className="row">
          <button className="btn g" onClick={showCaseReplay}>Reasoning replay</button>
          {c.stage < 16 ? (
            <button className="btn k" onClick={advance}>
              Advance to {String(c.stage + 1).padStart(2, "0")} · {STAGES[c.stage + 1].n}
            </button>
          ) : null}
        </div>
      </div>

      <div className="stepper" aria-label="Workflow stage">
        {STAGES.map((s, i) => (
          <div className={`step ${i < c.stage ? "done" : i === c.stage ? "cur" : ""}`} key={s.n}>
            <b>{String(i).padStart(2, "0")}</b>{s.n}
          </div>
        ))}
      </div>

      <div className="kpis" style={{ marginBottom: 18 }}>
        <div className="kpi"><span className="lbl">Claimed</span><b>{L(c.claimed)}</b><small>petition</small></div>
        <div className="kpi"><span className="lbl">Expected liability</span><b>{L(ex.v)}</b><small>{ex.basis}</small></div>
        <div className="kpi"><span className="lbl">Reserve</span><b>{L(c.reserve)}</b><small>{resNote}</small></div>
        <div className="kpi">
          <span className="lbl">Interest accrued</span>
          <b>{L(c.payment ? 0 : interestTo(ex.v, c.filed))}</b>
          <small>{c.payment ? "deposited" : "at " + R.interest + "% from petition"}</small>
        </div>
        <div className="kpi">
          <span className="lbl">Next date</span>
          <b style={{ fontSize: 20 }}>{c.next ? fd(c.next) : "—"}</b>
          <small>{c.purpose}</small>
        </div>
        <div className="kpi">
          <span className="lbl">Designated Officer · advocate</span>
          <b style={{ fontSize: 15, marginTop: 8 }}>{c.officer}</b>
          <small>{c.advocate} · Nodal: {hub.nodal.split(",")[0]}</small>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([k, t]) => (
          <button key={k} className={`tab ${S.tab === k ? "on" : ""}`} role="tab" onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      <Body c={c} />
    </>
  );
}