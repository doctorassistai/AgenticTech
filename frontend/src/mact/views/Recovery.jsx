import React from "react";
import { S } from "../store";
import { paidAmount, recovered } from "../lib/engine";
import { L } from "../lib/helpers";
import { PageHead, caseRow } from "../components/ui";
import { useMact } from "../ctx";

export default function Recovery() {
  const { go } = useMact();
  const list = S.cases.filter((c) => c.recovery);

  return (
    <>
      <PageHead title="Recovery" sub="Pay-and-recover rights detected from coverage breaches and awards." />
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Case</th><th>Basis</th><th>Against</th><th className="r">Paid</th>
                <th className="r">Recovered</th><th className="r">Outstanding</th><th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const r = c.recovery, live = !!r.recovered;
                return (
                  <tr key={c.id} {...caseRow(go, c.id, "recovery")}>
                    <td>{c.id}</td>
                    <td>{r.basis}</td>
                    <td>{r.against}</td>
                    <td className="r">{live ? L(paidAmount(c)) : "Not yet paid"}</td>
                    <td className="r">{live ? L(recovered(c)) : "—"}</td>
                    <td className="r">{live ? L(paidAmount(c) - recovered(c)) : "Potential"}</td>
                    <td>{r.next || "Track from award"}</td>
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