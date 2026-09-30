import React from "react";
import { S } from "../store";
import { TODAY, R } from "../data/rules";
import { awardTotal, insurerAwardTotal } from "../lib/engine";
import { L, fd, days, addDays } from "../lib/helpers";
import { PageHead, caseRow } from "../components/ui";
import { useMact } from "../ctx";

export default function Awards() {
  const { go } = useMact();
  const list = S.cases.filter((c) => c.award);

  return (
    <>
      <PageHead
        title="Awards & appeals"
        sub="Every award is compared with the insurer’s position; appeal issues come with authorities and money impact."
      />
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Case</th><th>Award date</th><th className="r">Award</th><th className="r">Insurer position</th>
                <th className="r">Difference</th><th>Limitation</th><th>Proposal</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const lim = addDays(c.award.date, R.appealDays), left = days(TODAY, lim);
                return (
                  <tr key={c.id} {...caseRow(go, c.id, "award")}>
                    <td>{c.id}<br /><span className="mute">{c.victim.name}</span></td>
                    <td>{fd(c.award.date)}</td>
                    <td className="r">{L(awardTotal(c))}</td>
                    <td className="r">{L(insurerAwardTotal(c))}</td>
                    <td className="r">{L(awardTotal(c) - insurerAwardTotal(c))}</td>
                    <td>{fd(lim)}<br /><span className="mute">{left > 0 ? left + " days" : "expired"}</span></td>
                    <td>{c.award.decision}</td>
                    <td>{c.award.decided ? <span className="pill k">Decided</span> : <span className="pill">Pending</span>}</td>
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