import React from "react";
import { S } from "../store";
import { TODAY, R } from "../data/rules";
import { REPORTS } from "../lib/Reports";
import { L, fd } from "../lib/helpers";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";
import { copyText } from "../lib/actions";

export default function Mis() {
  const { refresh, toast } = useMact();
  const [title, fn] = REPORTS[S.report] || REPORTS.R1;
  const r = fn();
  const states = ["All", ...new Set(S.cases.map((c) => c.state))];
  const money = (i) => !!(r.money && r.money.includes(i));
  const cell = (v, i) => (money(i) && typeof v === "number" ? L(v) : v);

  const csv = () => {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const text = [r.cols.map(q).join(",")]
      .concat(r.rows.map((x) => x.map((v) => q(typeof v === "number" ? Math.round(v) : v)).join(",")))
      .join("\n");
    copyText(text).then(toast);
  };

  const vals = r.chart != null ? r.rows.map((x) => (typeof x[r.chart] === "number" ? x[r.chart] : 0)) : [];
  const mx = Math.max(1, ...vals);

  return (
    <>
      <PageHead
        title="MIS reports"
        sub={`${Object.keys(REPORTS).length} standard reports, computed live from case records. Filter by state; copy any report as CSV.`}
        actions={
          <>
            <select className="in" aria-label="Filter by state" style={{ width: "auto" }} value={S.stateFilter}
              onChange={(e) => { S.stateFilter = e.target.value; refresh(); }}>
              {states.map((s) => <option key={s}>{s}</option>)}
            </select>
            <button className="btn" onClick={csv}>Copy as CSV</button>
          </>
        }
      />
      <div className="grid" style={{ gridTemplateColumns: "230px minmax(0,1fr)" }}>
        <div className="list" style={{ border: "1px solid var(--line)", alignSelf: "start" }}>
          {Object.entries(REPORTS).map(([k, v]) => (
            <button key={k} className={`nav ${S.report === k ? "on" : ""}`} onClick={() => { S.report = k; refresh(); }}>{v[0]}</button>
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ marginBottom: 14 }}>{title}</h2>
          {r.chart != null ? (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="ph"><h4>{r.cols[r.chart]} by {r.cols[0].toLowerCase()}</h4></div>
              {r.rows.map((x, i) => (
                <div className="hbar" key={i}>
                  <span>{x[0]}</span>
                  <div className="bar"><span style={{ width: `${(vals[i] / mx) * 100}%` }} /></div>
                  <span className="num" style={{ textAlign: "right" }}>{money(r.chart) ? L(vals[i]) : vals[i]}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="panel" style={{ padding: 0 }}>
            <div className="tw">
              <table>
                <thead><tr>{r.cols.map((c, i) => <th key={i} className={money(i) ? "r" : ""}>{c}</th>)}</tr></thead>
                <tbody>
                  {r.rows.length ? r.rows.map((x, i) => (
                    <tr key={i}>{x.map((v, j) => <td key={j} className={money(j) ? "r" : ""}>{cell(v, j)}</td>)}</tr>
                  )) : <tr><td colSpan={r.cols.length} className="mute">No records for this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mute" style={{ fontSize: 12, marginTop: 10 }}>Generated {fd(TODAY)} · rule set {R.version} · state filter: {S.stateFilter}</p>
        </div>
      </div>
    </>
  );
}