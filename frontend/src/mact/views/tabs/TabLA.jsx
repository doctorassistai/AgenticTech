import React, { useState } from "react";
import { S } from "../../store";
import { R } from "../../data/rules";
import { LA_STAGES, sitting, upcomingSittings } from "../../data/lokadalat";
import { laScore, laBand, laSuggest, laApportion, laMemo } from "../../lib/lokadalat";
import { INR, L, fd, addDays } from "../../lib/helpers";
import { useMact } from "../../ctx";
import {
  laList, laRelist, laAdjourn, laRequestMandate, laApproveMandate, laSettle, laFail, laPay, laAddRound, copyText,
} from "../../lib/actions";

const Sp = () => <div className="sp" />;

function Fitness({ sc }) {
  return (
    <div className="panel">
      <div className="ph"><h3>Why this score</h3><span className="lbl">deterministic · explainable</span></div>
      {sc.factors.length ? sc.factors.map((f, i) => (
        <div className="li" key={i}><span>{f[0]}</span><span className="num">{f[1] > 0 ? "+" : ""}{f[1]}</span></div>
      )) : <p className="mute">—</p>}
      {sc.cond.length ? (
        <>
          <h4 style={{ margin: "12px 0 6px" }}>Conditions for settlement</h4>
          {sc.cond.map((x) => <div className="note" style={{ marginBottom: 6 }} key={x}>{x}</div>)}
        </>
      ) : null}
    </div>
  );
}

function Unlisted({ c, sc }) {
  const { refresh, toast } = useMact();
  const up = upcomingSittings();
  const [sid, setSid] = useState(up[0] ? up[0].id : "");
  const blocked = /^(Hold|Not suitable)/.test(sc.bucket) || sc.bucket === "Closed" || sc.bucket === "Awaiting evidence";
  return (
    <div className="grid g2">
      <Fitness sc={sc} />
      <div className="panel">
        <h3>List for a sitting</h3>
        <p className="mute" style={{ fontSize: "12.5px", margin: "6px 0 12px" }}>
          Listing records a reference under s.20. A Lok Adalat can only record a compromise; if none is reached the case returns to the tribunal unaffected.
        </p>
        {blocked ? <p className="mute">Listing not recommended: {sc.bucket}.</p> : (
          <div className="row">
            <select className="in" style={{ width: "auto" }} value={sid} onChange={(e) => setSid(e.target.value)}>
              {up.map((s) => <option key={s.id} value={s.id}>{s.name} · {fd(s.date)}{s.tentative ? " (tentative)" : ""}</option>)}
            </select>
            <button className="btn k" disabled={!sid} onClick={() => { toast(laList(c.id, sid)); refresh(); }}>List for sitting</button>
          </div>
        )}
      </div>
    </div>
  );
}

function RoundForm({ c, la, sug, b }) {
  const { refresh, toast } = useMact();
  const last = la.rounds[la.rounds.length - 1];
  const [where, setWhere] = useState("Pre-sitting counselling");
  const [dem, setDem] = useState(String(last ? Math.round((last.demand * 0.85) / 1000) * 1000 : c.claimed));
  const [off, setOff] = useState(String(sug ? sug.offer : b ? b.opening : 0));
  const [note, setNote] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const err = laAddRound(c.id, { where, demand: +dem, offer: +off, note });
    if (err) { toast(err); return; }
    refresh();
  };
  return (
    <form className="grid g4" style={{ gap: 10 }} onSubmit={submit}>
      <label className="field"><span className="lbl">Where</span>
        <select value={where} onChange={(e) => setWhere(e.target.value)}>
          <option>Pre-sitting counselling</option><option>At the sitting</option><option>Phone / advocate meeting</option>
        </select>
      </label>
      <label className="field"><span className="lbl">Claimant demand (₹)</span><input type="number" required value={dem} onChange={(e) => setDem(e.target.value)} /></label>
      <label className="field"><span className="lbl">Insurer offer (₹)</span><input type="number" required value={off} onChange={(e) => setOff(e.target.value)} /></label>
      <label className="field"><span className="lbl">Note</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div style={{ gridColumn: "1/-1" }}><button className="btn" type="submit">Add round</button></div>
    </form>
  );
}

function Outcome({ c, la, b }) {
  const { refresh, toast } = useMact();
  const last = la.rounds[la.rounds.length - 1];
  const [amt, setAmt] = useState(String(last ? last.offer : b ? b.target : ""));
  const [utr, setUtr] = useState("");
  const done = (msg) => { toast(msg); refresh(); };
  return (
    <div className="panel">
      <h3>Sitting outcome</h3>
      {la.outcome ? (
        <>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Award</dt><dd>{la.outcome.award} · {fd(la.outcome.date)}</dd>
            <dt>Amount</dt><dd>{INR(la.outcome.amt)}</dd>
            <dt>Payment due</dt><dd>{fd(addDays(la.outcome.date, R.settleDepositDays))}</dd>
            <dt>Paid</dt><dd>{c.payment ? fd(c.payment.on) + " · " + c.payment.utr : "Not yet"}</dd>
            {b ? <><dt>Saved vs defending</dt><dd>{L(b.defend - la.outcome.amt)}</dd></> : null}
          </dl>
          {!c.payment ? (
            <div className="row" style={{ marginTop: 10 }}>
              <input className="in" placeholder="UTR / cheque no." style={{ width: "auto", flex: 1 }} value={utr} onChange={(e) => setUtr(e.target.value)} />
              <button className="btn k" onClick={() => done(laPay(c.id, utr.trim()))}>Record payment</button>
            </div>
          ) : null}
        </>
      ) : la.returned ? (
        <>
          <p className="mute" style={{ marginTop: 6 }}>Not settled — returned to the tribunal. Can be listed again.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => { laRelist(c.id); refresh(); }}>List for next sitting</button>
          </div>
        </>
      ) : (
        <div className="row" style={{ marginTop: 10 }}>
          <input className="in" type="number" aria-label="Settled amount" style={{ width: "auto", flex: 1 }} value={amt} onChange={(e) => setAmt(e.target.value)} />
          <button className="btn k" onClick={() => { const err = laSettle(c.id, +amt); done(err || "Lok Adalat award recorded — payment due in " + R.settleDepositDays + " days"); }}>Settled</button>
          <button className="btn" onClick={() => done(laFail(c.id))}>Not settled</button>
          <button className="btn g" onClick={() => done(laAdjourn(c.id))}>Move to next sitting</button>
        </div>
      )}
    </div>
  );
}

function Listed({ c, la, sc, b }) {
  const { refresh, toast } = useMact();
  const sug = laSuggest(c);
  const ap = b ? laApportion(c, la.outcome ? la.outcome.amt : b.target) : [];
  const disputed = c.liab && c.liab.disp && c.liab.disp.length;
  const rows = b ? [["Form XI / opening", b.opening], ["Target", b.target], ["Ceiling (walk-away)", b.ceiling], ["Tribunal-method estimate", b.tribunal], ["Cost of defending to award", b.defend]] : [];
  const act = (fn) => () => { toast(fn(c.id)); refresh(); };

  return (
    <>
      <div className="stepper">
        {LA_STAGES.map((s, i) => (
          <div className={`step ${la.returned ? "" : i < la.stage ? "done" : i === la.stage ? "cur" : ""}`} key={s.n}><b>L{i}</b>{s.n}</div>
        ))}
      </div>

      <div className="grid g2" style={{ marginBottom: 18 }}>
        {b ? (
          <div className="panel">
            <div className="ph"><h3>Negotiation band</h3><span className="lbl">engine {R.version}</span></div>
            {rows.map((x, i) => (
              <div className="hbar" key={x[0]} style={{ gridTemplateColumns: "minmax(120px,190px) minmax(0,1fr) 90px" }}>
                <span>{x[0]}</span>
                <div className={`bar ${i === 2 ? "h" : ""}`}><span style={{ width: `${(x[1] / b.defend) * 100}%` }} /></div>
                <span className="num" style={{ textAlign: "right" }}>{L(x[1])}</span>
              </div>
            ))}
            <p className="mute" style={{ fontSize: 12, marginTop: 8 }}>
              Ceiling = lower of the tribunal-method upper band and 95% of the cost of defending (compensation + {b.months} months’ interest + legal{disputed ? " + Local Commissioner" : ""} cost). Any settlement below the ceiling saves money against contesting.
            </p>
          </div>
        ) : <div />}
        <Fitness sc={sc} />
      </div>

      <div className="panel">
        <div className="ph"><h3>Negotiation rounds</h3><span className="lbl">{la.rounds.length} recorded</span></div>
        {la.rounds.length ? (
          <div className="tw">
            <table>
              <thead><tr><th>Date</th><th>Where</th><th className="r">Claimant demand</th><th className="r">Insurer offer</th><th>Note</th></tr></thead>
              <tbody>
                {la.rounds.map((r, i) => (
                  <tr key={i}><td>{fd(r.date)}</td><td>{r.where}</td><td className="r">{L(r.demand)}</td><td className="r">{L(r.offer)}</td><td className="mute" style={{ fontSize: 12 }}>{r.note || ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="mute">No rounds yet.</p>}
        {sug ? <div className="note" style={{ margin: "12px 0" }}>{sug.text}</div> : null}
        {la.stage < 5 && !la.returned ? <RoundForm key={la.rounds.length} c={c} la={la} sug={sug} b={b} /> : null}
      </div>
      <Sp />

      <div className="grid g3">
        <div className="panel">
          <h3>Pre-sitting mandate</h3>
          <p className="mute" style={{ fontSize: "12.5px", margin: "6px 0 10px" }}>A mandate approved before the sitting lets the Designated Officer settle on the day without calling for approval.</p>
          {la.mandate ? (
            <dl className="kv">
              <dt>Amount</dt><dd>{L(la.mandate.amt)}</dd>
              <dt>Approver</dt><dd>{la.mandate.level}</dd>
              <dt>Status</dt><dd>{la.mandate.status}{la.mandate.on ? " · " + fd(la.mandate.on) : ""}</dd>
            </dl>
          ) : null}
          {la.stage < 5 && b ? (
            <div className="row" style={{ marginTop: 10 }}>
              {!la.mandate || la.mandate.status !== "Pending" ? <button className="btn" onClick={act(laRequestMandate)}>Request mandate {L(b.ceiling)}</button> : null}
              {la.mandate && la.mandate.status === "Pending" ? <button className="btn k" onClick={act(laApproveMandate)}>Approve as {la.mandate.level}</button> : null}
            </div>
          ) : null}
        </div>

        <Outcome key={la.rounds.length + ":" + (la.outcome ? 1 : 0) + ":" + (la.returned ? 1 : 0)} c={c} la={la} b={b} />

        {ap.length ? (
          <div className="panel" style={{ padding: 0 }}>
            <div className="ph" style={{ padding: "14px 16px 0" }}><h3>Apportionment {la.outcome ? "" : "(at target)"}</h3></div>
            <div className="tw">
              <table>
                <thead><tr><th>Claimant</th><th className="r">Share</th><th>Mode</th></tr></thead>
                <tbody>{ap.map((r) => <tr key={r[0]}><td>{r[0]}</td><td className="r">{INR(r[1])}</td><td className="mute" style={{ fontSize: 12 }}>{r[2]}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        ) : <div />}
      </div>
      <Sp />

      <div className="panel">
        <div className="ph">
          <h3>Joint memo of compromise</h3>
          <button className="btn s" onClick={async () => toast(await copyText(laMemo(c)))}>Copy text</button>
        </div>
        <div className="draft">{laMemo(c)}</div>
      </div>
    </>
  );
}

export function LokAdalatTab({ c }) {
  const la = S.la[c.id], sc = laScore(c), b = laBand(c);
  const st = la ? sitting(la.sitting) : null;
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="panel"><span className="lbl">Settlement fitness</span><h2>{sc.score}</h2><p className="mute">{sc.bucket}</p></div>
        <div className="panel">
          <span className="lbl">Sitting</span><h3 style={{ marginTop: 4 }}>{st ? st.name : "Not listed"}</h3>
          <p className="mute">{st ? fd(st.date) + (st.tentative ? " · tentative" : "") : "—"}</p>
        </div>
        <div className="panel">
          <span className="lbl">Lok Adalat stage</span>
          <h3 style={{ marginTop: 4 }}>{la ? (la.returned ? "Not settled — returned to court" : LA_STAGES[la.stage].n) : "—"}</h3>
          <p className="mute">{la ? la.ref : ""}</p>
        </div>
        <div className="panel">
          <span className="lbl">Mandate</span><h3 style={{ marginTop: 4 }}>{la && la.mandate ? L(la.mandate.amt) : "—"}</h3>
          <p className="mute">{la && la.mandate ? la.mandate.status + " · " + la.mandate.level : "Not requested"}</p>
        </div>
      </div>
      {la ? <Listed c={c} la={la} sc={sc} b={b} /> : <Unlisted c={c} sc={sc} />}
    </>
  );
}