import React from "react";
import { STAGES, EVENTMAP, GATED_STAGES } from "../data/masters";
import { LA_STAGES } from "../data/lokadalat";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";

const code = (i) => String(i).padStart(2, "0");

export default function Workflow() {
  const { go } = useMact();
  return (
    <>
      <PageHead
        title="Workflow designer"
        sub="Seventeen stages from court intimation, with a seven-step Lok Adalat sub-flow at stage 10 to closure. Each stage lists its trigger, automation, AI engines and exit gate; the case cannot advance until the gate is met."
      />
      <div className="grid g2">
        {STAGES.map((s, i) => (
          <div className="stagecard" key={s.n}>
            <div className="n">{code(i)}</div>
            <div style={{ minWidth: 0 }}>
              <h3>{s.n}</h3>
              <p className="mute" style={{ fontSize: 12, margin: "2px 0 8px" }}>{s.own} · SLA {s.sla}</p>
              <dl className="kv" style={{ gridTemplateColumns: "90px minmax(0,1fr)", fontSize: "12.5px" }}>
                <dt>Trigger</dt><dd>{s.trig}</dd>
                <dt>Automation</dt><dd>{s.auto.join(" · ")}</dd>
                <dt>AI engines</dt><dd>{s.ai.join(" · ")}</dd>
                <dt>Exit gate</dt><dd>{s.exit}</dd>
                <dt>Status code</dt><dd className="mono">STG_{code(i)}</dd>
              </dl>
            </div>
          </div>
        ))}
      </div>
      <div className="sp" />
      <div className="panel" style={{ padding: 0 }}>
        <div className="ph" style={{ padding: "14px 16px 0" }}><h3>Court &amp; connector event → status mapping</h3></div>
        <div className="tw">
          <table>
            <thead><tr><th>Event</th><th>Effect</th></tr></thead>
            <tbody>{EVENTMAP.map((m) => <tr key={m[0]}><td>{m[0]}</td><td>{m[1]}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="sp" />
      <div className="panel">
        <h3>Human-in-the-loop rule</h3>
        <p style={{ marginTop: 6 }}>
          AI finding → evidence → legal basis → officer review → accept, modify (with reason) or reject (with reason) → final decision.
          Stages {GATED_STAGES.map(code).join(", ")} require every finding to be decided before the case advances.
        </p>
      </div>
      <div className="sp" />
      <div className="panel" style={{ padding: 0 }}>
        <div className="ph" style={{ padding: "14px 16px 0" }}>
          <h3>Stage 10 sub-flow · Lok Adalat</h3>
          <button className="btn s" onClick={() => go("lokadalat")}>Open Lok Adalat</button>
        </div>
        <div className="tw">
          <table>
            <thead><tr><th>Stage</th><th>Owner</th><th>SLA</th><th>Exit gate</th></tr></thead>
            <tbody>
              {LA_STAGES.map((x, i) => <tr key={x.n}><td>L{i} · {x.n}</td><td>{x.own}</td><td>{x.sla}</td><td className="mute">{x.exit}</td></tr>)}
              <tr><td>Returned</td><td>System</td><td>Sitting day</td><td className="mute">No compromise — case goes back to the tribunal unaffected; can be re-listed</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}