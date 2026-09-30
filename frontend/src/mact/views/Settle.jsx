import React from "react";
import { S } from "../store";
import { R } from "../data/rules";
import { STAGES, approver } from "../data/masters";
import { scenarios, doOffer, surveyorOf } from "../lib/engine";
import { L, fd, addDays } from "../lib/helpers";
import { PageHead, caseRow } from "../components/ui";
import { useMact } from "../ctx";

function Window({ c, gap }) {
  if (c.stage === 16) return <span className="pill s">Closed</span>;
  if ((c.flags || []).some((f) => f[0] === "high") && c.stage < 10) return <span className="pill d">Verify flags first</span>;
  if (gap != null && gap < 0.35) return <span className="pill k">Close to agreement</span>;
  return <span className="pill">Open</span>;
}

export default function Settle() {
  const { go } = useMact();
  const list = S.cases.filter((c) => (c.stage >= 4 && c.stage <= 11) || c.settle);

  return (
    <>
      <PageHead
        title="Settlement desk"
        sub="Cases where an evidence-based offer can close the claim early. Form XI offer = insurer evidence-based scenario + configured margin (fixed amount for s.164 claims), approved under the delegation of powers."
      />
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Case</th><th>Status</th><th>DAR / offer due</th><th className="r">Claimed</th>
                <th className="r">Tribunal-method</th><th className="r">Form XI offer</th><th className="r">Demand</th>
                <th>Surveyor</th><th>Approval</th><th>Window</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const s = scenarios(c), o = doOffer(c), sv = surveyorOf(c);
                const due = c.darOn ? addDays(c.darOn, R.doOfferDays) : null;
                const offer = (c.settle && c.settle.offer) || o;
                const demand = c.settle && c.settle.demand;
                const gap = demand && o ? (demand - o) / o : null;
                return (
                  <tr key={c.id} {...caseRow(go, c.id, "settlement")}>
                    <td>{c.id}<br /><span className="mute">{c.victim.name}</span></td>
                    <td>{c.settle ? c.settle.status : STAGES[c.stage].n}</td>
                    <td>{c.darOn ? <>{fd(c.darOn)}<br /><span className="mute">due {fd(due)}</span></> : "—"}</td>
                    <td className="r">{L(c.claimed)}</td>
                    <td className="r">{s && c.income.range ? L(s.tribunal.net) : "—"}</td>
                    <td className="r">{o ? L(offer) : "—"}</td>
                    <td className="r">{demand ? L(demand) : "—"}</td>
                    <td className="mute" style={{ fontSize: 12 }}>{sv.verdict || sv.status}</td>
                    <td className="mute" style={{ fontSize: 12 }}>{o ? approver(offer) : "—"}</td>
                    <td><Window c={c} gap={gap} /></td>
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