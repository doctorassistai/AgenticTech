import React from "react";
import { S } from "../store";
import { TODAY } from "../data/rules";
import { D, fd, days } from "../lib/helpers";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";

export default function Diary() {
  const { go } = useMact();
  const rows = S.cases
    .filter((c) => c.next && days(TODAY, D(c.next)) >= -1)
    .sort((a, b) => D(a.next) - D(b.next));
  const groups = {};
  rows.forEach((c) => (groups[c.next] = groups[c.next] || []).push(c));

  return (
    <>
      <PageHead title="Hearing diary" sub={`${rows.length} listed dates. Next dates update automatically from court orders.`} />
      {Object.keys(groups).map((dt) => (
        <div className="panel" style={{ marginBottom: 12 }} key={dt}>
          <div className="ph"><h3>{fd(dt)}</h3><span className="lbl">{days(TODAY, D(dt))} days</span></div>
          {groups[dt].map((c) => (
            <div className="li" key={c.id}>
              <div>
                <b style={{ fontWeight: 400 }}>{c.purpose}</b><br />
                <span className="mute">{c.id} · {c.victim.name} · {c.court}</span>
              </div>
              <div className="row">
                <span className="mute" style={{ fontSize: 12 }}>{c.advocate}</span>
                <button className="btn s" onClick={() => go("case", { caseId: c.id, tab: "overview" })}>Prepare</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}