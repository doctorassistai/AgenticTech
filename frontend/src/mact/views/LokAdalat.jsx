import React, { useState } from "react";
import { S, byId } from "../store";
import { TODAY, R } from "../data/rules";
import { hubOf } from "../data/masters";
import { LA_STAGES, SITTINGS, sitting, upcomingSittings } from "../data/lokadalat";
import { laScore, laBand, laSuggest, laApportion, sitStats } from "../lib/lokadalat";
import { L, fd, days, addDays, D } from "../lib/helpers";
import { PageHead, caseRow } from "../components/ui";
import { useMact } from "../ctx";
import { laSettle, laFail, laRequestMandate, laApproveMandate } from "../lib/actions";

const byDate = (a, b) => D(a.date) - D(b.date);

/* ── Calendar & results ── */
function Overview() {
  const { refresh } = useMact();
  const up = upcomingSittings();
  const held = SITTINGS.filter((s) => s.agg && days(TODAY, D(s.date)) < 0).sort((a, b) => D(b.date) - D(a.date));
  const all = Object.values(S.la), openL = all.filter((x) => !x.outcome && !x.returned), set = all.filter((x) => x.outcome);
  const fit = S.cases.filter((c) => !S.la[c.id] && laScore(c).score >= 70).length;
  const openConsole = (id) => { S.laSit = id; S.laTab = "sitting"; refresh(); };
  const hd = { padding: "14px 16px 0" };

  return (
    <>
      <div className="kpis" style={{ marginBottom: 18 }}>
        <div className="kpi"><span className="lbl">Next sitting</span><b style={{ fontSize: 20 }}>{up[0] ? fd(up[0].date) : "—"}</b><small>{up[0] ? up[0].name : ""}</small></div>
        <div className="kpi"><span className="lbl">In pipeline</span><b>{openL.length}</b><small>{all.filter((x) => !x.outcome && x.mandate && x.mandate.status === "Approved").length} with mandate</small></div>
        <div className="kpi"><span className="lbl">Fit, not yet listed</span><b>{fit}</b><small>AI identification</small></div>
        <div className="kpi"><span className="lbl">Settled (portfolio)</span><b>{set.length}</b><small>{L(set.reduce((a, x) => a + x.outcome.amt, 0))}</small></div>
        <div className="kpi"><span className="lbl">Awards unpaid</span><b>{set.filter((x) => !byId(x.caseId).payment).length}</b><small>{R.settleDepositDays}-day payment clock</small></div>
      </div>

      <div className="panel" style={{ padding: 0, marginBottom: 18 }}>
        <div className="ph" style={hd}><h3>Upcoming sittings</h3><span className="lbl">sync from NALSA / SLSA / DLSA calendars</span></div>
        <div className="tw">
          <table>
            <thead><tr><th>Date</th><th>Sitting</th><th>Type</th><th>Authority</th><th className="r">Listed</th><th className="r">Claimed</th><th className="r">Mandates approved</th><th></th></tr></thead>
            <tbody>
              {up.map((s) => {
                const t = sitStats(s);
                return (
                  <tr key={s.id}>
                    <td>{fd(s.date)}<br /><span className="mute">{days(TODAY, D(s.date))} days{s.tentative ? " · tentative" : ""}</span></td>
                    <td>{s.name}</td><td>{s.type}</td><td className="mute">{s.auth}</td>
                    <td className="r">{t.listed}</td><td className="r">{L(t.claimed)}</td><td className="r">{L(t.mand)}</td>
                    <td><button className="btn s" onClick={() => openConsole(s.id)}>Console</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="ph" style={hd}><h3>Past sittings</h3><span className="lbl">all-hub totals are sample figures</span></div>
        <div className="tw">
          <table>
            <thead><tr><th>Date</th><th>Sitting</th><th className="r">Listed</th><th className="r">Settled</th><th className="r">Settlement rate</th><th className="r">Claimed (settled)</th><th className="r">Settled amount</th><th className="r">Settled / claimed</th><th className="r">Below tribunal estimate</th></tr></thead>
            <tbody>
              {held.map((s) => {
                const a = s.agg;
                return (
                  <tr key={s.id}>
                    <td>{fd(s.date)}</td><td>{s.name}<br /><span className="mute">{s.auth}</span></td>
                    <td className="r">{a.listed.toLocaleString("en-IN")}</td><td className="r">{a.settled.toLocaleString("en-IN")}</td>
                    <td className="r">{Math.round((a.settled / a.listed) * 100)}%</td><td className="r">{L(a.claimed)}</td><td className="r">{L(a.settledAmt)}</td>
                    <td className="r">{Math.round((a.settledAmt / a.claimed) * 100)}%</td><td className="r">{L(a.est - a.settledAmt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ── AI case identification ── */
function Identify() {
  const { go } = useMact();
  const rows = S.cases.map((c) => ({ c, s: laScore(c) })).filter((x) => x.s.bucket !== "Closed").sort((a, b) => b.s.score - a.s.score);
  const pill = (bucket) =>
    /^Fit/.test(bucket) ? <span className="pill k">{bucket}</span>
    : /Hold|Not suitable/.test(bucket) ? <span className="pill d">{bucket}</span>
    : <span className="pill">{bucket}</span>;
  return (
    <>
      <p className="mute" style={{ marginBottom: 12 }}>Scanned weekly. Scores are rule-based and every point is explained; the officer decides what to list.</p>
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead><tr><th>Case</th><th>TP hub</th><th className="r">Score</th><th>Assessment</th><th>Top reasons</th><th>Conditions</th><th className="r">Target</th><th className="r">Saving vs defending</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(({ c, s }) => {
                const b = laBand(c), la = S.la[c.id];
                const top = s.factors.slice().sort((a, z) => Math.abs(z[1]) - Math.abs(a[1])).slice(0, 2);
                return (
                  <tr key={c.id} {...caseRow(go, c.id, "lokadalat")}>
                    <td>{c.id}<br /><span className="mute">{c.victim.name}</span></td>
                    <td>{hubOf(c).name}</td>
                    <td className="r"><b style={{ fontWeight: 400, fontSize: 16 }}>{s.score}</b></td>
                    <td>{pill(s.bucket)}</td>
                    <td className="mute" style={{ fontSize: 12 }}>{top.map((f, i) => <div key={i}>{f[0]}</div>)}</td>
                    <td className="mute" style={{ fontSize: 12 }}>{s.cond.length ? s.cond.map((x, i) => <div key={i}>{x}</div>) : "—"}</td>
                    <td className="r">{b && s.score ? L(b.target) : "—"}</td>
                    <td className="r">{b && s.score ? L(b.defend - b.target) : "—"}</td>
                    <td>{la ? (la.outcome ? "Settled" : la.returned ? "Returned" : "Listed · " + fd(sitting(la.sitting).date)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ── Pipeline (kanban) ── */
function Pipeline() {
  const { go } = useMact();
  const all = Object.values(S.la), next = upcomingSittings()[0];
  const identified = next
    ? S.cases.filter((c) => !S.la[c.id] && laScore(c).score >= 50).map((c) => ({ caseId: c.id, sitting: next.id, stage: 0, rounds: [] }))
    : [];
  const Col = ({ title, items }) => (
    <div style={{ minWidth: 210, flex: "1 0 210px" }}>
      <div className="ph" style={{ marginBottom: 8 }}><h4>{title}</h4><span className="mute">{items.length}</span></div>
      {items.length ? items.map((x) => {
        const c = byId(x.caseId), b = laBand(c), st = sitting(x.sitting);
        return (
          <div className="find" style={{ cursor: "pointer" }} key={c.id} tabIndex={0}
            onClick={() => go("case", { caseId: c.id, tab: "lokadalat" })}
            onKeyDown={(e) => { if (e.key === "Enter") go("case", { caseId: c.id, tab: "lokadalat" }); }}>
            <span className="lbl">{c.id}</span>
            <div style={{ margin: "2px 0 4px" }}>{c.victim.name}</div>
            <div className="mute" style={{ fontSize: 12 }}>{st.name} · {fd(st.date)}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>{x.outcome ? "Settled " + L(x.outcome.amt) : b ? "Target " + L(b.target) + " · ceiling " + L(b.ceiling) : ""}</div>
          </div>
        );
      }) : <p className="mute" style={{ fontSize: 12 }}>—</p>}
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
        {LA_STAGES.map((s, i) => (
          <Col key={s.n} title={`L${i} · ${s.n}`} items={i === 0 ? identified : all.filter((x) => !x.returned && x.stage === i)} />
        ))}
        <Col title="Returned to court" items={all.filter((x) => x.returned)} />
      </div>
      <div className="sp" />
      <div className="panel" style={{ padding: 0 }}>
        <div className="ph" style={{ padding: "14px 16px 0" }}><h3>Lok Adalat sub-flow</h3></div>
        <div className="tw">
          <table>
            <thead><tr><th>Stage</th><th>Owner</th><th>SLA</th><th>Exit gate</th></tr></thead>
            <tbody>{LA_STAGES.map((s, i) => <tr key={s.n}><td>L{i} · {s.n}</td><td>{s.own}</td><td>{s.sla}</td><td className="mute">{s.exit}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ── Sitting-day console ── */
function SittingRow({ x }) {
  const { refresh, toast } = useMact();
  const c = byId(x.caseId), b = laBand(c), sg = laSuggest(c), last = x.rounds[x.rounds.length - 1];
  const [amt, setAmt] = useState(String(last ? last.offer : b ? b.target : ""));
  const done = (msg) => { if (msg) toast(msg); refresh(); };
  const settle = () => { const err = laSettle(c.id, +amt); done(err || "Lok Adalat award recorded — payment due in " + R.settleDepositDays + " days"); };
  const { go } = useMact();
  return (
    <tr>
      <td>
        <a href="#case" onClick={(e) => { e.preventDefault(); go("case", { caseId: c.id, tab: "lokadalat" }); }}>{c.id}</a>
        <br /><span className="mute">{c.victim.name} · {c.type}</span>
      </td>
      <td>{c.cAdv}</td>
      <td className="r">{b ? L(b.opening) : "—"}</td><td className="r">{b ? L(b.target) : "—"}</td><td className="r">{b ? L(b.ceiling) : "—"}</td>
      <td className="r">{x.mandate ? L(x.mandate.amt) + (x.mandate.status !== "Approved" ? " (pending)" : "") : <span className="mute">none</span>}</td>
      <td className="r">{last ? L(last.demand) : "—"}</td>
      <td className="mute" style={{ fontSize: 12, maxWidth: 240 }}>{x.outcome || x.returned ? "—" : sg ? sg.text : ""}</td>
      <td style={{ minWidth: 250 }}>
        {x.outcome ? <span className="pill k">Settled {L(x.outcome.amt)}</span>
        : x.returned ? <span className="pill s">Not settled</span>
        : (
          <div className="row" style={{ gap: 6 }}>
            <input className="in" type="number" style={{ width: 110 }} aria-label={`Settled amount for ${c.id}`} value={amt} onChange={(e) => setAmt(e.target.value)} />
            <button className="btn s k" onClick={settle}>Settled</button>
            <button className="btn s" onClick={() => done(laFail(c.id))}>No</button>
            {!x.mandate && b ? <button className="btn s g" onClick={() => done(laRequestMandate(c.id))}>Mandate</button>
              : x.mandate && x.mandate.status === "Pending" ? <button className="btn s g" onClick={() => done(laApproveMandate(c.id))}>Approve</button> : null}
          </div>
        )}
      </td>
    </tr>
  );
}

function SittingDay() {
  const { refresh } = useMact();
  const opts = SITTINGS.filter((s) => Object.values(S.la).some((x) => x.sitting === s.id)).sort(byDate);
  if (!opts.length) return <p className="mute">No cases are listed for any sitting.</p>;
  const cur = opts.find((o) => o.id === S.laSit) || opts.find((o) => days(TODAY, D(o.date)) >= 0) || opts[0];
  const t = sitStats(cur), L2 = Object.values(S.la).filter((x) => x.sitting === cur.id);
  const intStop = L2.filter((x) => x.outcome).reduce((a, x) => { const b = laBand(byId(x.caseId)); return a + (b ? (b.tribunal * R.interest) / 100 / 12 : 0); }, 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        {opts.map((o) => <button key={o.id} className={`chip ${o.id === cur.id ? "on" : ""}`} onClick={() => { S.laSit = o.id; refresh(); }}>{o.name} · {fd(o.date)}</button>)}
      </div>
      <div className="kpis" style={{ marginBottom: 18 }}>
        <div className="kpi"><span className="lbl">Listed</span><b>{t.listed}</b><small>{cur.auth}</small></div>
        <div className="kpi"><span className="lbl">Settled</span><b>{t.settled}</b><small>{t.listed ? Math.round((t.settled / t.listed) * 100) : 0}% · {t.returned} returned</small></div>
        <div className="kpi"><span className="lbl">Settled amount</span><b>{L(t.setAmt)}</b><small>against {L(t.claimedSet)} claimed</small></div>
        <div className="kpi"><span className="lbl">Saved vs defending</span><b>{L(t.sav)}</b><small>compensation + interest + cost</small></div>
        <div className="kpi"><span className="lbl">Interest stopped</span><b>{L(intStop)}</b><small>per month</small></div>
        <div className="kpi"><span className="lbl">Mandates on hand</span><b>{L(t.mand)}</b><small>approved before sitting</small></div>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead><tr><th>Case</th><th>Claimant advocate</th><th className="r">Opening</th><th className="r">Target</th><th className="r">Ceiling</th><th className="r">Mandate</th><th className="r">Last demand</th><th>AI advice</th><th>Outcome at the table</th></tr></thead>
            <tbody>{L2.map((x) => <SittingRow key={x.caseId + ":" + (x.outcome ? 1 : 0) + (x.returned ? 1 : 0) + x.rounds.length} x={x} />)}</tbody>
          </table>
        </div>
      </div>
      <p className="mute" style={{ fontSize: 12, marginTop: 10 }}>
        Settling above the approved mandate is blocked. Each outcome is written to the case audit trail and moves the case to payment ({R.settleDepositDays} days) or back to the tribunal.
      </p>
    </>
  );
}

/* ── Awards & payments ── */
function Payments() {
  const { go } = useMact();
  const set = Object.values(S.la).filter((x) => x.outcome).sort((a, b) => D(b.outcome.date) - D(a.outcome.date));
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="tw">
        <table>
          <thead><tr><th>Case</th><th>Sitting</th><th>Award no.</th><th className="r">Amount</th><th>Due</th><th>Paid</th><th>Minors’ FD</th><th>Status</th></tr></thead>
          <tbody>
            {set.map((x) => {
              const c = byId(x.caseId), due = addDays(x.outcome.date, R.settleDepositDays);
              const fdAmt = laApportion(c, x.outcome.amt).filter((r) => /Fixed deposit/.test(r[2])).reduce((a, r) => a + r[1], 0);
              return (
                <tr key={c.id} {...caseRow(go, c.id, "lokadalat")}>
                  <td>{c.id}<br /><span className="mute">{c.victim.name}</span></td>
                  <td>{sitting(x.sitting).name}<br /><span className="mute">{fd(x.outcome.date)}</span></td>
                  <td className="mono">{x.outcome.award}</td>
                  <td className="r">{L(x.outcome.amt)}</td>
                  <td>{fd(due)}</td>
                  <td>{c.payment ? <>{fd(c.payment.on)}<br /><span className="mute mono">{c.payment.utr}</span></> : "—"}</td>
                  <td>{fdAmt ? L(fdAmt) : "—"}</td>
                  <td>
                    {c.payment ? (D(c.payment.on) <= due ? <span className="pill s">Paid on time</span> : <span className="pill">Paid late</span>)
                    : days(TODAY, due) < 0 ? <span className="pill k">Overdue — interest running</span>
                    : <span className="pill d">{days(TODAY, due)} days left</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABS = [["overview", "Calendar & results"], ["identify", "AI case identification"], ["pipeline", "Pipeline"], ["sitting", "Sitting-day console"], ["payments", "Awards & payments"]];
const VIEWS = { overview: Overview, identify: Identify, pipeline: Pipeline, sitting: SittingDay, payments: Payments };

export default function LokAdalat() {
  const { refresh } = useMact();
  const Body = VIEWS[S.laTab] || Overview;
  return (
    <>
      <PageHead
        title="Lok Adalat settlement"
        sub="Identify, negotiate and settle MACT claims at Lok Adalat sittings under the Legal Services Authorities Act, 1987. An award is passed only on compromise (s.20), is a deemed decree and cannot be appealed (s.21)."
        actions={<button className="btn k" onClick={() => { S.laTab = "sitting"; refresh(); }}>Open sitting-day console</button>}
      />
      <div className="tabs" role="tablist">
        {TABS.map(([k, t]) => (
          <button key={k} className={`tab ${S.laTab === k ? "on" : ""}`} role="tab" onClick={() => { S.laTab = k; refresh(); }}>{t}</button>
        ))}
      </div>
      <Body />
    </>
  );
}