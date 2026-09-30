import React from "react";
import { S } from "../store";
import { STAGES, hubOf } from "../data/masters";
import { exposure, docStats } from "../lib/engine";
import { L, fd } from "../lib/helpers";
import { useMact } from "../ctx";

const TypePill = ({ c }) =>
  c.type === "Death" ? <span className="pill k">Death</span>
  : c.type === "Injury" ? <span className="pill">Injury</span>
  : <span className="pill d">No-fault s.164</span>;

const SevPill = ({ s }) =>
  s === "high" ? <span className="pill k">High</span>
  : s === "med" ? <span className="pill">Medium</span>
  : <span className="pill s">Low</span>;

export default function Cases() {
  const { go, refresh } = useMact();

  const stateFilter = S.stateFilter || "All";
  const states = ["All", ...new Set(S.cases.map((c) => c.state))];
  const list = S.cases.filter((c) => stateFilter === "All" || c.state === stateFilter);

  const openCase = (id) => go("case", { caseId: id, tab: "overview" });

  return (
    <>
      <div className="top">
        <div>
          <span className="lbl">MACT·AI · Third-party (MACT) · TP hub configuration</span>
          <h1>Case register</h1>
          <p className="sub">{list.length} cases. Select a case to open its intelligence workspace.</p>
        </div>
        <div className="row">
          <select
            className="in"
            aria-label="Filter by state"
            style={{ width: "auto" }}
            value={stateFilter}
            onChange={(e) => { S.stateFilter = e.target.value; refresh(); }}
          >
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="tw panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Case</th><th>Claimant / victim</th><th>Tribunal</th><th>TP hub</th><th>Type</th>
              <th>Workflow stage</th><th>Court stage</th><th>Docs</th>
              <th className="r">Claimed</th><th className="r">Expected</th><th>Next date</th><th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const ds = docStats(c);
              const ex = exposure(c);
              const hub = hubOf(c);
              const flags = c.flags || [];
              return (
                <tr
                  key={c.id}
                  tabIndex={0}
                  onClick={() => openCase(c.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") openCase(c.id); }}
                >
                  <td><b style={{ fontWeight: 400 }}>{c.id}</b><br /><span className="mute mono">{c.mvc}</span></td>
                  <td>{c.victim.name}<br /><span className="mute">{c.victim.age} · {String(c.victim.occ || "").split("(")[0]}</span></td>
                  <td>{c.court}<br /><span className="mute">{c.state}</span></td>
                  <td>{hub.name}<br /><span className="mute">{hub.type}</span></td>
                  <td><TypePill c={c} /></td>
                  <td>{String(c.stage).padStart(2, "0")} · {STAGES[c.stage].n}</td>
                  <td className="mute">{c.courtStage}</td>
                  <td style={{ minWidth: 80 }}>
                    <div className="bar"><span style={{ width: `${ds.p * 100}%` }} /></div>
                    <span className="mute" style={{ fontSize: 11 }}>{ds.r}/{ds.t}</span>
                  </td>
                  <td className="r">{L(c.claimed)}</td>
                  <td className="r">{L(ex.v)}</td>
                  <td>{c.next ? fd(c.next) : "—"}</td>
                  <td>
                    {flags.length
                      ? <SevPill s={flags.find((f) => f[0] === "high") ? "high" : "med"} />
                      : <span className="mute">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}