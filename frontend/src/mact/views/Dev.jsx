import React from "react";
import { S } from "../store";
import { R } from "../data/rules";
import { DEV } from "../lib/Devdata";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";
import { copyText } from "../lib/actions";

const ENGINE_SPLIT = [
  ["LLM", "Extraction, summarisation, comparison, drafting, question generation"],
  ["Rules engine", `Coverage rules, eligibility, all money calculations (${R.version})`],
  ["Knowledge graph", "People, vehicles, policies, hospitals, advocates, witnesses, courts"],
  ["Search / RAG", "Judgments, statutes, circulars — binding vs persuasive by court and date"],
  ["Audit", "Append-only, hash-chained; model, prompt and rule versions per conclusion"],
  ["Deployment", "On-premise or private VPC; SSO, MFA, RBAC by branch; PII masking; SIEM & DLP"],
];

export default function Dev() {
  const { toast } = useMact();
  // Sample = the case being viewed, else the first fully-populated case.
  const c = S.cases.find((x) => x.id === S.caseId) || S.cases.find((x) => x.liab) || S.cases[0];
  const sample = JSON.stringify(c, (k, v) => (k === "_f" ? undefined : v), 2);
  const hd = { padding: "14px 16px 0" };

  return (
    <>
      <PageHead
        title="Developer hand-off"
        sub="Reference model for backend build: entities, API, events and a full sample case record. The front-end on this page reads the same shapes."
        actions={<button className="btn" onClick={async () => toast(await copyText(sample))}>Copy sample case JSON</button>}
      />
      <div className="grid g2">
        <div className="panel" style={{ padding: 0 }}>
          <div className="ph" style={hd}><h3>Core entities</h3></div>
          <div className="tw">
            <table>
              <tbody>{DEV.ents.map((e) => <tr key={e[0]}><td style={{ whiteSpace: "nowrap" }}>{e[0]}</td><td className="mono" style={{ fontSize: "11.5px" }}>{e[1]}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="panel" style={{ padding: 0 }}>
            <div className="ph" style={hd}><h3>API</h3></div>
            <div className="tw">
              <table>
                <tbody>
                  {DEV.api.map((a) => (
                    <tr key={a[0] + a[1]}><td className="mono">{a[0]}</td><td className="mono" style={{ fontSize: "11.5px" }}>{a[1]}</td><td className="mute" style={{ fontSize: 12 }}>{a[2]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h3>Domain events</h3>
            <div className="sp" style={{ height: 8 }} />
            <div className="row">
              {DEV.evs.map((e) => <span key={e} className="src mono" style={{ textTransform: "none", letterSpacing: 0 }}>{e}</span>)}
            </div>
          </div>
          <div className="panel">
            <h3>Engine split</h3>
            <dl className="kv" style={{ marginTop: 8, gridTemplateColumns: "120px minmax(0,1fr)" }}>
              {ENGINE_SPLIT.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
            </dl>
          </div>
        </div>
      </div>
      <div className="sp" />
      <div className="panel">
        <div className="ph"><h3>Sample case record</h3><span className="lbl">{c ? c.id : ""}</span></div>
        <pre className="draft mono" style={{ fontSize: "11.5px" }}>{sample}</pre>
      </div>
    </>
  );
}