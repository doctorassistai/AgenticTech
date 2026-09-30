import React from "react";
import { S } from "../store";
import { RECURRING, INTEGRITY_CHECKS } from "../data/masters";
import { PageHead, SevPill, caseRow } from "../components/ui";
import { useMact } from "../ctx";

const RANK = { high: 0, med: 1 };
const rank = (sev) => (sev in RANK ? RANK[sev] : 2);

export default function Integrity() {
  const { go } = useMact();
  const rows = S.cases
    .flatMap((c) => (c.flags || []).map((f) => ({ c, f })))
    .sort((a, b) => rank(a.f[0]) - rank(b.f[0]));
  const mx = Math.max(1, ...RECURRING.map((x) => x[2]));

  return (
    <>
      <PageHead
        title="Claims integrity"
        sub="Evidence-based anomaly flags across the portfolio. Flags prompt verification; they are not accusations."
      />
      <div className="panel" style={{ padding: 0, marginBottom: 18 }}>
        <div className="tw">
          <table>
            <thead><tr><th>Severity</th><th>Case</th><th>Flag</th><th>Evidence</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.c.id + i} {...caseRow(go, r.c.id, "integrity")}>
                  <td><SevPill s={r.f[0]} /></td>
                  <td>{r.c.id}</td>
                  <td>{r.f[1]}</td>
                  <td className="mute">{r.f[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g2">
        <div className="panel">
          <h3>Recurring entities</h3>
          <div className="sp" style={{ height: 8 }} />
          {RECURRING.map(([name, kind, n]) => (
            <div className="hbar" key={name}>
              <span>{name}<br /><span className="mute" style={{ fontSize: 11 }}>{kind}</span></span>
              <div className="bar"><span style={{ width: `${(n / mx) * 100}%` }} /></div>
              <span className="num" style={{ textAlign: "right" }}>{n} claims</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Checks run on every case</h3>
          <div className="sp" style={{ height: 8 }} />
          {INTEGRITY_CHECKS.map((x) => (
            <div className="li" key={x}><span>{x}</span><span className="mute">Active</span></div>
          ))}
        </div>
      </div>
    </>
  );
}