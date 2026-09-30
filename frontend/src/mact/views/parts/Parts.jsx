import React, { useState } from "react";
import { S } from "../../store";
import { LAW } from "../../data/masters";
import { scenarios, findings } from "../../lib/engine";
import { SevPill } from "../../components/ui";
import { decideAccept, decideSave, undoDecision } from "../../lib/actions";
import { useMact } from "../../ctx";

export function CiteList({ keys }) {
  const ks = [...new Set(keys || [])];
  if (!ks.length) return <p className="mute">No authorities linked yet.</p>;
  return ks.map((k) =>
    LAW[k] ? (
      <div className="cite" key={k}>
        <b>{LAW[k].t}</b>, {LAW[k].c} <span className="mute">· {LAW[k].ct}</span>
        <br />
        <span className="mute">{LAW[k].h}</span>
      </div>
    ) : null
  );
}

export function FindingCard({ f }) {
  const { refresh, showReplay } = useMact();
  const [mode, setMode] = useState(null); // 'modify' | 'reject' | null
  const [note, setNote] = useState("");
  const [err, setErr] = useState(false);
  const d = S.decisions[f.id];

  const accept = () => { decideAccept(f); refresh(); };
  const save = () => {
    const v = note.trim();
    if (!v) { setErr(true); return; }
    decideSave(f, mode, v);
    setMode(null); setNote(""); setErr(false);
    refresh();
  };
  const undo = () => { undoDecision(f); refresh(); };

  return (
    <div className={`find ${f.sev}`}>
      <div className="fh">
        <div>
          <span className="lbl">{f.engine}</span>
          <h4 style={{ marginTop: 2, fontWeight: 400, fontSize: "13.5px" }}>{f.title}</h4>
        </div>
        <SevPill s={f.sev} />
      </div>
      <p className="fb">{f.detail}</p>
      <div className="fa">
        <span className="mute" style={{ fontSize: "11.5px" }}>
          Confidence {f.conf} · {f.evidence.length} evidence item{f.evidence.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="fa" style={{ marginTop: 8 }}>
        {d ? (
          <>
            <span className={`pill ${d.d === "accept" ? "k" : d.d === "reject" ? "s" : ""}`}>
              {d.d === "accept" ? "Accepted" : d.d === "reject" ? "Rejected" : "Modified"}
            </span>
            <span className="dec">{d.by} · {d.at}{d.note ? " · " + d.note : ""}</span>
            <button className="btn s g" onClick={undo}>Reopen</button>
          </>
        ) : (
          <>
            <button className="btn s k" onClick={accept}>Accept</button>
            <button className="btn s" onClick={() => setMode("modify")}>Modify</button>
            <button className="btn s g" onClick={() => setMode("reject")}>Reject</button>
          </>
        )}
        <button className="btn s g" onClick={() => showReplay(f)}>Why?</button>
      </div>
      {mode && !d ? (
        <div style={{ marginTop: 8 }}>
          <input
            className="in" autoFocus value={note}
            placeholder={err ? "A reason is required" : "Reason for modification or rejection (required)"}
            onChange={(e) => { setNote(e.target.value); setErr(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn s k" onClick={save}>Save decision</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Meters({ c }) {
  const F = findings(c);
  const cov = c.coverage || [];
  const covScore = cov.length ? cov.filter((r) => r[3] === "ok").length / cov.length : 0;
  const inc = c.income && c.income.range && c.income.claimed
    ? Math.max(0.1, Math.min(1, c.income.range[1] / c.income.claimed))
    : c.income && c.income.range ? 0.6 : 0;
  const neg = c.liab ? (1 - (c.liab.contrib[1] || 0) / 100) * (c.liab.disp.length ? 0.7 : 1) : 0;
  const med = c.med ? Math.max(0.15, Math.min(1, c.med.disAI / Math.max(1, c.med.disClaim))) : c.type === "Death" ? 0.85 : 0;
  const dep = c.deps && c.deps.length ? c.deps.filter((d) => d[2] !== "?").length / c.deps.length : c.type === "Injury" ? 1 : 0;
  const risk = Math.min(1, F.filter((f) => f.sev === "high").length * 0.25 + F.filter((f) => f.sev === "med").length * 0.1);

  const rows = c.type === "No-fault"
    ? [["Coverage", covScore, "Clear"], ["Negligence", 1, "Not required (s.164)"], ["Income", 1, "Not required (s.164)"],
       ["Dependency", dep, dep === 1 ? "Verified" : "Requires verification"], ["Legal risk", 0, "Low"]]
    : [["Coverage", covScore, covScore > 0.95 ? "Clear" : covScore > 0.7 ? "Review" : "Breach indicators"],
       ["Negligence", neg, neg > 0.85 ? "Established" : neg > 0.5 ? "Disputed" : "Contested"],
       ["Income", inc, inc > 0.9 ? "Consistent" : inc > 0.6 ? "Partly supported" : "Weak evidence"],
       ["Medical", med, med > 0.8 ? "Consistent" : med > 0.4 ? "Partly supported" : "Unsupported claims"],
       ["Dependency", dep, dep === 1 ? "Verified" : "Requires verification"],
       ["Legal risk", risk, risk > 0.5 ? "Significant" : risk > 0.2 ? "Moderate" : "Low"]];

  return rows.map((x) => (
    <div className="meter" key={x[0]}>
      <span>{x[0]}</span>
      <div className={`bar ${c.type !== "No-fault" && x[0] === "Legal risk" ? "h" : ""}`}>
        <span style={{ width: `${Math.round(x[1] * 100)}%` }} />
      </div>
      <span className="mute">{x[2]}</span>
    </div>
  ));
}

export const Sp = ({ h }) => <div className="sp" style={h ? { height: h } : undefined} />;