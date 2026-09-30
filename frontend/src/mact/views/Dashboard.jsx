import React from "react";
import { S, open } from "../store";
import { TODAY, R } from "../data/rules";
import { STAGES } from "../data/masters";
import { exposure, paidAmount, recovered, surveyorOf, actionQueue } from "../lib/engine";
import { QA } from "../lib/qa";
import { L, D, fd, days, addDays } from "../lib/helpers";
import { PageHead, caseRow } from "../components/ui";
import { useMact } from "../ctx";
import { syncNow } from "../lib/actions";
import { upcomingSittings } from "../data/lokadalat";
import { laScore } from "../lib/lokadalat";

export default function Dashboard() {
  const { go, refresh, toast } = useMact();

  const oc = S.cases.filter(open);
  const exp = oc.reduce((s, c) => s + exposure(c).v, 0);
  const claimed = oc.reduce((s, c) => s + c.claimed, 0);
  const reserve = oc.reduce((s, c) => s + c.reserve, 0);
  const paid = S.cases.reduce((s, c) => s + paidAmount(c), 0);
  const recOut = S.cases
    .filter((c) => c.recovery && c.recovery.recovered)
    .reduce((s, c) => s + (paidAmount(c) - recovered(c)), 0);
  const avgAge = Math.round(oc.reduce((s, c) => s + days(c.filed), 0) / oc.length / 30.4);
  const h7 = oc.filter((c) => c.next && days(TODAY, D(c.next)) >= 0 && days(TODAY, D(c.next)) <= 7).length;
  const flags = S.cases.reduce((s, c) => s + (c.flags || []).length, 0);
    const nextSit = upcomingSittings()[0];
  const laListed = nextSit ? Object.values(S.la).filter((x) => x.sitting === nextSit.id).length : 0;
  const laFit = S.cases.filter((c) => !S.la[c.id] && laScore(c).score >= 70).length;
  const stageCounts = STAGES.map((s, i) => S.cases.filter((c) => c.stage === i).length);
  const mx = Math.max(1, ...stageCounts);
  const queue = actionQueue().slice(0, 7);

  const formXiDue = S.cases.filter((c) => {
    if (!(c.darOn && !c.settle && c.stage <= 7)) return false;
    const d = days(TODAY, addDays(c.darOn, R.doOfferDays));
    return d >= 0 && d <= 30;
  }).length;
  const surveyorsOpen = S.cases.filter(
    (c) => c.darOn && c.stage <= 4 && surveyorOf(c).due && !surveyorOf(c).verdict
  ).length;

  const runSync = () => { toast(syncNow().msg); refresh(); };

  return (
    <>
      <PageHead
        title="Command centre"
        sub={`Portfolio as of ${fd(TODAY)}. Figures are sample data. Expected liability uses the deterministic tribunal-method engine (${R.version}); nothing is shown without an evidence trail.`}
        actions={
          <>
            <button className="btn" onClick={runSync}>Sync courts now</button>
            <button className="btn k" onClick={() => go("cases")}>Open case register</button>
          </>
        }
      />

      <div className="kpis">
        <div className="kpi"><span className="lbl">Open cases</span><b>{oc.length}</b><small>{S.cases.length - oc.length} closed</small></div>
        <div className="kpi"><span className="lbl">Amount claimed</span><b>{L(claimed)}</b><small>open cases</small></div>
        <div className="kpi"><span className="lbl">Expected liability</span><b>{L(exp)}</b><small>{Math.round((exp / claimed) * 100)}% of claimed</small></div>
        <div className="kpi"><span className="lbl">Reserve held</span><b>{L(reserve)}</b><small>{reserve < exp ? "short by " + L(exp - reserve) : "adequate"}</small></div>
        <div className="kpi"><span className="lbl">Paid (incl. interest)</span><b>{L(paid)}</b><small>awards &amp; settlements</small></div>
        <div className="kpi"><span className="lbl">Recovery outstanding</span><b>{L(recOut)}</b><small>pay-and-recover</small></div>
        <div className="kpi"><span className="lbl">Average age</span><b>{avgAge} mo</b><small>from petition</small></div>
        <div className="kpi"><span className="lbl">Form XI due · 30 days</span><b>{formXiDue}</b><small>{surveyorsOpen} surveyor reports open</small></div>
                <div className="kpi"><span className="lbl">Next Lok Adalat</span><b style={{ fontSize: 20 }}>{nextSit ? fd(nextSit.date) : "—"}</b><small>{laListed} listed · {laFit} more fit</small></div>
        <div className="kpi"><span className="lbl">Hearings · 7 days</span><b>{h7}</b><small>{flags} integrity flags open</small></div>
      </div>
      <div className="sp" />

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
        <div className="panel">
          <div className="ph"><h3>Next best actions</h3><span className="lbl">AI-prioritised · by money at risk × deadline</span></div>
          <div className="tw">
            <table>
              <thead><tr><th>Case</th><th>Action</th><th>Why now</th><th className="r">At stake</th></tr></thead>
              <tbody>
                {queue.map((a, i) => (
                  <tr key={a.c.id + i} {...caseRow(go, a.c.id)}>
                    <td><b style={{ fontWeight: 400 }}>{a.c.id}</b><br /><span className="mute">{a.c.victim.name}</span></td>
                    <td>{a.act}</td>
                    <td className="mute">{a.why}</td>
                    <td className="r">{L(a.amt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="ph"><h3>Pipeline by stage</h3><span className="lbl">cases</span></div>
          {STAGES.map((s, i) => (
            <div className="hbar" key={s.n}>
              <span>{String(i).padStart(2, "0")} · {s.n}</span>
              <div className="bar"><span style={{ width: `${(stageCounts[i] / mx) * 100}%` }} /></div>
              <span className="num r" style={{ textAlign: "right" }}>{stageCounts[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sp" />

      <div className="grid g2">
        <div className="panel feed">
          <div className="ph"><h3>Latest from courts &amp; connectors</h3><button className="btn s g" onClick={() => go("sync")}>All events</button></div>
          <div className="list">
            {S.activity.slice(0, 6).map((e, i) => (
              <div className="li" key={e.at + e.caseId + i}>
                <div>
                  <span className="src">{e.src || "Workflow"}</span>{" "}
                  <span className="mute" style={{ fontSize: "11.5px" }}>{e.at}</span>
                  <div style={{ marginTop: 3 }}>{e.text}</div>
                </div>
                <button className="btn s g" onClick={() => go("case", { caseId: e.caseId, tab: "overview" })}>{e.caseId.slice(5)}</button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="ph"><h3>Ask the portfolio</h3><span className="lbl">Portfolio Intelligence</span></div>
          <p className="mute" style={{ marginBottom: 12 }}>Structured questions over the whole MACT book. Answers list the cases and the evidence behind them.</p>
          <div className="row">
            {QA.map((q, i) => (
              <button key={q.q} className="chip" onClick={() => go("ask", { qa: i })}>{q.q}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}