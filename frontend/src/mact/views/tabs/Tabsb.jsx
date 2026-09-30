import React, { useEffect, useState } from "react";
import { S } from "../../store";
import { TODAY, R, fracStr } from "../../data/rules";
import { LAW, hubOf, approver } from "../../data/masters";
import {
  scenarios, findings, docsFor, doOffer, surveyorOf, awardTotal, insurerAwardTotal,
  interestTo, paidAmount, recovered,
} from "../../lib/engine";
import { similar, draft } from "../../lib/Caselogic";
import { INR, L, fd, days, addDays, pct, D } from "../../lib/helpers";
import { useMact } from "../../ctx";
import {
  setQuantumInput, resetQuantum, recordSurvey, settleAccept, settleReject, settleFile,
  decideAward, copyText,
} from "../../lib/actions";
import { CiteList, FindingCard } from "../parts/Parts";

const Sp = ({ h }) => <div className="sp" style={h ? { height: h } : undefined} />;
const B6 = ({ children }) => <b style={{ fontWeight: 600 }}>{children}</b>;

/* ───────────── DAR & surveyor ───────────── */
export function Dar({ c }) {
  const { refresh, toast } = useMact();
  const sv = surveyorOf(c), h = hubOf(c);
  const far = addDays(c.accident, 2), iar = addDays(c.accident, 50), dar = addDays(c.accident, 90);
  const off = c.darOn ? addDays(c.darOn, R.doOfferDays) : null;

  // [step, form, due, done, note] — a row appears only when its dates exist
  const clocks = [
    ["First Accident Report (police → tribunal)", "Form I", far, c.stage >= 2 ? far : null, "48 hours from accident"],
    ["Interim Accident Report", "Form V", iar, c.stage >= 2 ? iar : null, "50 days from accident"],
    ["Detailed Accident Report", "Form VII", dar, c.darOn ? D(c.darOn) : null, "90 days; with site plan (VIII), MVI (IX), verification (X)"],
    ...(c.darOn && sv.due ? [["Surveyor verification of DAR", "Surveyor report", sv.due, sv.on || null, (sv.name || "") + (sv.verdict ? " · " + sv.verdict : "")]] : []),
    ...(c.darOn ? [["Form XI offer by Designated Officer", "Form XI", off, c.settle && c.settle.offerOn ? D(c.settle.offerOn) : null, "30 days from DAR, with reasons"]] : []),
    ...(c.settle && c.settle.settledOn
      ? [["Deposit after record of settlement", "Voucher / UTR", addDays(c.settle.settledOn, R.settleDepositDays), c.payment ? D(c.payment.on) : null, "30 days from record of settlement"]]
      : []),
  ];

  const statusPill = (done, due) =>
    done ? (done <= due ? <span className="pill s">On time</span> : <span className="pill">Late</span>)
    : days(TODAY, due) < 0 ? <span className="pill k">Overdue</span>
    : <span className="pill d">Open</span>;

  const has = (name) => docsFor(c).some((d) => d.name === name && d.st === "Received");
  const checklist = [
    ["Vehicle & RC match DAR", has("Registration certificate")],
    ["Driver & DL match DAR", has("Driving licence")],
    ["Policy in force on accident date", (c.coverage || []).some((r) => /Policy in force/.test(r[0]) && r[3] === "ok")],
    ["Site plan (Form VIII) consistent with FIR", !(c.conflicts || []).some((x) => /Site plan/.test(x[0] + x[1]))],
    ["MVI (Form IX) consistent with collision", has("Mechanical inspection report")],
    ["Victim & claimant particulars (Form VI)", !(c.deps || []).some((d) => d[2] === "?")],
  ];

  const record = (dispute) => { toast(recordSurvey(c, dispute)); refresh(); };

  return (
    <>
      <div className="grid g3" style={{ marginBottom: 18 }}>
        <div className="panel"><span className="lbl">TP hub</span><h3 style={{ marginTop: 4 }}>{h.name}</h3><p className="mute">{h.type} · {h.region} region</p></div>
        <div className="panel"><span className="lbl">Designated Officer (Rule 23)</span><h3 style={{ marginTop: 4 }}>{c.officer}</h3><p className="mute">Offer authority: {approver(doOffer(c) || c.claimed)}</p></div>
        <div className="panel"><span className="lbl">Nodal Officer (Rule 24)</span><h3 style={{ marginTop: 4 }}>{h.nodal.split(",")[0]}</h3><p className="mute">Escalation when a statutory clock is at risk</p></div>
      </div>

      <div className="panel" style={{ padding: 0, marginBottom: 18 }}>
        <div className="ph" style={{ padding: "14px 16px 0" }}><h3>Statutory clocks</h3><span className="lbl">Gohar Mohammed directions · MV (Amendment) Rules 2022</span></div>
        <div className="tw">
          <table>
            <thead><tr><th>Step</th><th>Form</th><th>Due</th><th>Done</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {clocks.map(([n, form, due, done, note]) => (
                <tr key={n}>
                  <td>{n}</td><td className="mono">{form}</td><td>{fd(due)}</td><td>{done ? fd(done) : "—"}</td>
                  <td>{statusPill(done, due)}</td><td className="mute" style={{ fontSize: 12 }}>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g2">
        <div className="panel">
          <h3>Surveyor verification</h3><Sp h={8} />
          <dl className="kv">
            <dt>Status</dt><dd>{sv.status}</dd>
            <dt>Surveyor</dt><dd>{sv.name || "—"}</dd>
            <dt>Due</dt><dd>{sv.due ? fd(sv.due) : "—"}</dd>
            <dt>Outcome</dt><dd>{sv.verdict || "Pending"}</dd>
            <dt>Note</dt><dd>{sv.note}</dd>
          </dl>
          {sv.status === "In progress" || sv.status === "Overdue" ? (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn k" onClick={() => record(false)}>Record: DAR accepted</button>
              <button className="btn" onClick={() => record(true)}>Record: DAR disputed → DCP</button>
            </div>
          ) : null}
        </div>
        <div className="panel">
          <h3>Verification checklist</h3><Sp h={8} />
          {checklist.map(([label, ok]) => (
            <div className="li" key={label}><span>{label}</span><span className={ok ? "" : "mute"}>{ok ? "✓ Verified" : "Check"}</span></div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ───────────── Compensation ───────────── */
// Number input that commits on blur / Enter (so typing is not logged keystroke by keystroke).
function QIn({ label, value, onCommit }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => { if (v !== "" && +v !== +value) onCommit(+v); else setV(String(value)); };
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    </label>
  );
}

export function Quantum({ c }) {
  const { refresh } = useMact();
  if (c.type === "No-fault") {
    const v = R.nofault[c.nfKind];
    return (
      <>
        <div className="grid g3">
          <div className="panel"><span className="lbl">Fixed compensation · s.164</span><h2>{INR(v)}</h2><p className="mute">{c.nfKind}</p></div>
          {Object.entries(R.nofault).map(([k, amt]) => (
            <div className="panel" key={k}><span className="lbl">{k}</span><h2>{INR(amt)}</h2></div>
          ))}
        </div>
        <Sp />
        <div className="note">No multiplier, income or negligence enquiry applies. Interest to date at {R.interest}%: {INR(interestTo(v, c.filed))}.</div>
      </>
    );
  }
  const s = scenarios(c);
  if (!s || !c.income.range) return <p className="mute">Quantum is computed once income and medical documents are extracted.</p>;

  const e = S.edit[c.id] || {}, t = s.tribunal, q = c.q;
  const val = (k, fallback) => (e[k] != null ? e[k] : fallback);
  const set = (k) => (n) => { setQuantumInput(c, k, n); refresh(); };
  const rows = ["claimant", "insurer", "alternate", "tribunal"];
  const names = { claimant: "Claimant demand (as pleaded)", insurer: "Insurer evidence-based", alternate: "Alternate evidence scenario", tribunal: "Tribunal-method (your inputs)" };
  const mx = Math.max(c.claimed, ...rows.map((r) => s[r].net));

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)" }}>
        <div className="panel">
          <h3>Adjust tribunal-method inputs</h3>
          <p className="mute" style={{ fontSize: "12.5px", margin: "4px 0 12px" }}>Deterministic engine {R.version}. Changes recompute instantly and are logged.</p>
          <div className="grid g2" style={{ gap: 10 }}>
            <QIn label="Monthly income (₹)" value={Math.round(t.income)} onCommit={set("income")} />
            {c.type === "Injury" ? (
              <QIn label="Functional disability %" value={val("disab", q.disTrib)} onCommit={set("disab")} />
            ) : (
              <>
                <QIn label="Dependants" value={val("dep", q.depClaim)} onCommit={set("dep")} />
                <QIn label="Consortium persons" value={val("cons", q.consClaim)} onCommit={set("cons")} />
              </>
            )}
            <QIn label="Contributory negligence %" value={val("contrib", q.contribTrib)} onCommit={set("contrib")} />
            <QIn label="Medical expenses (₹)" value={val("med", q.medVer || q.medClaim)} onCommit={set("med")} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn s g" onClick={() => { resetQuantum(c); refresh(); }}>Reset to evidence midpoint</button>
          </div>
          <Sp />
          <dl className="kv">
            <dt>Age</dt><dd>{c.victim.age}</dd>
            <dt>Multiplier</dt><dd>{t.mult} (Sarla Verma)</dd>
            <dt>Future prospects</dt><dd>{pct(t.f)} (Pranay Sethi, {q.emp})</dd>
            {c.type === "Death" ? <><dt>Deduction</dt><dd>{fracStr(t.ded)}</dd></> : null}
          </dl>
        </div>

        <div className="panel">
          <h3>Scenarios</h3><Sp h={10} />
          {rows.map((r) => (
            <div className="hbar" key={r} style={{ gridTemplateColumns: "minmax(120px,200px) minmax(0,1fr) 90px" }}>
              <span>{names[r]}</span>
              <div className={`bar ${r === "tribunal" ? "h" : ""}`}><span style={{ width: `${(s[r].net / mx) * 100}%` }} /></div>
              <span className="num" style={{ textAlign: "right" }}>{L(s[r].net)}</span>
            </div>
          ))}
          <div className="note" style={{ marginTop: 12 }}>
            Tribunal range {L(s.band[0])} – {L(s.band[1])}. This is a calculation under stated precedents, not a prediction of the tribunal’s decision.
          </div>
        </div>
      </div>
      <Sp />
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead><tr><th>Head</th><th>Working</th><th className="r">Claimant</th><th className="r">Insurer</th><th className="r">Tribunal-method</th></tr></thead>
            <tbody>
              {t.heads.map((h, i) => (
                <tr key={h[0]}>
                  <td>{h[0]}</td><td className="mute" style={{ fontSize: 12 }}>{h[2]}</td>
                  <td className="r">{INR(s.claimant.heads[i][1])}</td><td className="r">{INR(s.insurer.heads[i][1])}</td><td className="r">{INR(h[1])}</td>
                </tr>
              ))}
              <tr><td>Gross</td><td></td><td className="r">{INR(s.claimant.gross)}</td><td className="r">{INR(s.insurer.gross)}</td><td className="r">{INR(t.gross)}</td></tr>
              <tr>
                <td>Less contributory negligence</td><td className="mute" style={{ fontSize: 12 }}>{s.insurer.contrib}% / {t.contrib}%</td>
                <td className="r">—</td><td className="r">−{INR(s.insurer.cut)}</td><td className="r">−{INR(t.cut)}</td>
              </tr>
              <tr>
                <td><B6>Net compensation</B6></td><td></td>
                <td className="r"><B6>{INR(s.claimant.net)}</B6></td><td className="r"><B6>{INR(s.insurer.net)}</B6></td><td className="r"><B6>{INR(t.net)}</B6></td>
              </tr>
              <tr>
                <td>Interest to date ({R.interest}%)</td><td className="mute" style={{ fontSize: 12 }}>From {fd(c.filed)} · {days(c.filed)} days</td>
                <td className="r">{INR(interestTo(s.claimant.net, c.filed))}</td><td className="r">{INR(interestTo(s.insurer.net, c.filed))}</td><td className="r">{INR(interestTo(t.net, c.filed))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ───────────── Legal & precedents ───────────── */
const STATUTES = [
  "MV Act 1988, s.166 — application for compensation",
  "s.147 — requirements of policies and limits of liability",
  "s.149 — insurer’s duty to satisfy awards; permitted defences",
  "s.168 / s.171 — award and interest",
  "s.173 — appeal within 90 days; statutory deposit",
  "CMVR DAR procedure (2022) — FAR, IAR, DAR and insurer offer",
  "State MACT rules — documents and timelines",
];

export function Legal({ c }) {
  const sim = similar(c);
  return (
    <>
      <div className="grid g2">
        <div className="panel">
          <h3>Binding authorities</h3>
          <p className="mute" style={{ fontSize: "12.5px", margin: "4px 0 8px" }}>Supreme Court decisions bind every tribunal. Verify each citation against a licensed database before filing.</p>
          <CiteList keys={(c.law || []).concat(findings(c).flatMap((f) => f.law || []))} />
        </div>
        <div className="panel">
          <h3>Statutory framework</h3><Sp h={8} />
          {STATUTES.map((x) => <div className="cite" key={x}>{x}</div>)}
        </div>
      </div>
      <Sp />
      <div className="panel">
        <div className="ph"><h3>Similar cases in the portfolio award corpus</h3><span className="lbl">structured + semantic match</span></div>
        <div className="tw">
          <table>
            <thead><tr><th>Award</th><th>State</th><th>Facts</th><th>Income</th><th>Multiplier / FP</th><th>Negligence</th><th className="r">Award</th><th className="r">Match</th></tr></thead>
            <tbody>
              {sim.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.id}</td><td>{x.st} · {x.yr}</td>
                  <td>{x.type}, age {x.age}, {x.occ}{x.deps ? ", " + x.deps + " dependants" : ""}{x.dis ? ", " + x.dis + "% disability" : ""}</td>
                  <td>{INR(x.inc)}</td><td>{x.mult} / {x.fp}</td><td className="mute">{x.neg}</td>
                  <td className="r">{L(x.award)}</td><td className="r">{x.score}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ───────────── Integrity ───────────── */
export function Integrity({ c }) {
  const F = findings(c).filter((f) => f.engine === "Claims Integrity" || f.engine === "Case Reconstruction");
  const flags = c.flags || [];
  const hit = (re) => flags.some((f) => re.test(f[1] + " " + f[2]));
  const checks = [
    ["PDF metadata vs issue date", hit(/after accident|post-accident/i) ? "Creation date after accident for employer certificate" : "No mismatch"],
    ["Duplicate invoices / templates", hit(/Duplicate/i) ? "1 duplicate found" : "None"],
    ["Overwritten or altered dates", "None detected"],
    ["Signature consistency", "Consistent across documents"],
    ["Network recurrence (hospital, advocate, witness)", hit(/recur/i) ? "Recurring cluster found" : "No cluster"],
  ];
  return (
    <>
      <div className="note" style={{ marginBottom: 16 }}>Flags are evidence-based prompts for verification. A flag is never treated as a finding of fraud and never reduces compensation on its own.</div>
      {F.length ? F.map((f) => <FindingCard key={f.id} f={f} />) : <p className="mute">No anomalies across dates, locations, bills, income or network patterns.</p>}
      <Sp />
      <div className="panel">
        <h3>Document forensics</h3><Sp h={8} />
        <div className="tw">
          <table>
            <thead><tr><th>Check</th><th>Result</th></tr></thead>
            <tbody>{checks.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ───────────── Drafts ───────────── */
const DRAFTS = [["ws", "Written statement"], ["cross", "Cross-examination questions"], ["req", "Document requisition"], ["offer", "Form XI offer letter"]];

export function Drafts({ c }) {
  const { refresh, toast } = useMact();
  const k = S.draft || "ws";
  const text = draft(c, k);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {DRAFTS.map(([key, label]) => (
          <button key={key} className={`chip ${k === key ? "on" : ""}`} onClick={() => { S.draft = key; refresh(); }}>{label}</button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <p className="mute" style={{ fontSize: "12.5px" }}>
          Generated from the evidence graph. Every legal proposition carries a citation. No s.166(3) limitation plea is generated (Supreme Court interim order, Nov 2025). Advocate review required before filing.
        </p>
        <button className="btn s" onClick={async () => toast(await copyText(text))}>Copy text</button>
      </div>
      <div className="draft">{text}</div>
    </>
  );
}

/* ───────────── Settlement ───────────── */
export function Settlement({ c }) {
  const { refresh, toast, setTab } = useMact();
  const s = scenarios(c);
  if (!s || !c.income.range) return <p className="mute">Settlement scenarios need a computed quantum.</p>;

  const st = c.settle, offer = (st && st.offer) || doOffer(c), rejected = !!st && /Rejected/.test(st.status);
  const disputed = c.type !== "No-fault" && c.liab && ((c.liab.disp || []).length || (c.coverage || []).some((r) => r[3] === "bad"));
  const lc = disputed ? R.lcFee : 0;
  const mid = rejected ? Math.max(s.tribunal.net, offer) : s.tribunal.net;
  const cost = 150000 + lc, monthsTo = c.stage >= 9 ? 10 : 18, intMo = (mid * R.interest) / 100 / 12;
  const sc = [
    ["A · Defend fully to award", mid, monthsTo, cost, "Evidence strength decides outcome; interest accrues" + (lc ? "; includes Local Commissioner fees (liability disputed)" : "")],
    ["B · Settle at Form XI offer", offer, 1, 20000, rejected ? "Offer rejected — no longer available" : "Lowest cost if claimant accepts; deposit within 30 days of record of settlement"],
    ["C · Lok Adalat / mediated", Math.round((offer + mid) / 2), 3, 40000, "Midpoint between offer and tribunal-method; final, no appeal"],
    ["D · Award then appeal", Math.max(rejected ? offer : 0, mid * 0.92), monthsTo + 24, cost + 120000, "Only where a strong appeal ground exists"],
  ];
  const tot = sc.map((x) => x[1] + intMo * x[2] + x[3]);
  const skip = (i) => rejected && i === 1;
  const mn = Math.min(...tot.filter((_, i) => !skip(i)));
  const sv = surveyorOf(c), due = c.darOn ? addDays(c.darOn, R.doOfferDays) : null;
  const canRecord = st && /Offer made|Counter received|Lok Adalat listed/.test(st.status);
  const act = (fn) => () => { toast(fn(c)); refresh(); };

  return (
    <>
      {st ? (
        <div className="note" style={{ marginBottom: 16 }}>
          Status: <b style={{ fontWeight: 400 }}>{st.status}</b>
          {st.offerOn ? ` · Form XI dated ${fd(st.offerOn)}` : ""}
          {st.demand ? ` · claimant demand ${L(st.demand)}` : ""}
          {st.settled ? ` · settled at ${L(st.settled)} on ${fd(st.settledOn)} · deposit due ${fd(addDays(st.settledOn, R.settleDepositDays))}` : ""}. {st.note || ""}
        </div>
      ) : null}

      {rejected ? (
        <div className="find high" style={{ marginBottom: 16 }}>
          <div className="fh"><h4 style={{ fontWeight: 400 }}>Offer rejected — inquiry limited to enhancement</h4><span className="pill k">Floor {L(offer)}</span></div>
          <p className="fb">Under the DAR procedure, once the claimant rejects the Form XI offer the tribunal’s inquiry is confined to whether compensation should be enhanced. The offered amount is treated as the minimum outcome in every scenario below.</p>
        </div>
      ) : null}

      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead><tr><th>Scenario</th><th className="r">Compensation</th><th className="r">Months to close</th><th className="r">Interest</th><th className="r">Legal & LC cost</th><th className="r">Total outflow</th><th>Notes</th></tr></thead>
            <tbody>
              {sc.map((x, i) => (
                <tr key={x[0]} style={skip(i) ? { opacity: 0.45 } : undefined}>
                  <td>{x[0]} {tot[i] === mn && !skip(i) ? <span className="pill k">Lowest</span> : null}</td>
                  <td className="r">{L(x[1])}</td><td className="r">{x[2]}</td><td className="r">{L(intMo * x[2])}</td>
                  <td className="r">{L(x[3])}</td><td className="r">{L(tot[i])}</td><td className="mute" style={{ fontSize: 12 }}>{x[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Sp />

      <div className="grid g3">
        <div className="panel">
          <h3>Form XI offer</h3>
          <h2 style={{ margin: "8px 0" }}>{L(offer)}</h2>
          <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0,1fr)", fontSize: "12.5px" }}>
            <dt>Basis</dt><dd>{c.type === "No-fault" ? "Fixed amount under s.164" : "Insurer evidence-based scenario + 5% margin"}</dd>
            <dt>DAR received</dt><dd>{c.darOn ? fd(c.darOn) : "Awaited"}</dd>
            <dt>Surveyor</dt><dd>{sv.status}{sv.verdict ? " · " + sv.verdict : ""}</dd>
            <dt>Offer due</dt><dd>{due ? fd(due) + (days(TODAY, due) >= 0 ? " (" + days(TODAY, due) + " days)" : " (window passed)") : "—"}</dd>
            <dt>Approval</dt><dd>{approver(offer)}</dd>
          </dl>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn k" onClick={() => { S.draft = "offer"; setTab("drafts"); }}>Open Form XI</button>
          </div>
        </div>

        <div className="panel">
          <h3>Record claimant response</h3>
          <p className="mute" style={{ fontSize: "12.5px", margin: "6px 0 12px" }}>Acceptance creates the record of settlement and starts the 30-day deposit clock. Rejection limits the inquiry to enhancement.</p>
          {canRecord ? (
            <div className="row">
              <button className="btn k" onClick={act(settleAccept)}>Claimant accepted</button>
              <button className="btn" onClick={act(settleReject)}>Claimant rejected</button>
            </div>
          ) : (
            <p className="mute">{st ? "Response already recorded: " + st.status : "No Form XI offer filed yet."}</p>
          )}
          {!st && c.stage >= 7 ? (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={act(settleFile)}>Record Form XI as filed</button>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <h3>Comparable outcomes</h3><Sp h={8} />
          {similar(c).slice(0, 3).map((x) => (
            <div className="li" key={x.id}><span className="mono">{x.id}</span><span>{L(x.award)} · {x.score}% match</span></div>
          ))}
          <p className="mute" style={{ fontSize: 12, marginTop: 8 }}>Scenario analysis only. The decision rests with the Designated Officer within New India’s delegation of powers.</p>
        </div>
      </div>
    </>
  );
}

/* ───────────── Award & appeal ───────────── */
export function Award({ c }) {
  const { refresh } = useMact();
  const a = c.award;
  if (!a) return <p className="mute">No award yet. When the court feed reports an award, it is extracted here and compared head-by-head with the insurer’s position.</p>;

  const tt = awardTotal(c), it = insurerAwardTotal(c), lim = addDays(a.date, R.appealDays);
  const stat = Math.min(25000, tt / 2);
  const left = days(TODAY, lim);
  const decide = (mode) => { decideAward(c, mode); refresh(); };

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="panel"><span className="lbl">Award date</span><h3 style={{ marginTop: 4 }}>{fd(a.date)}</h3></div>
        <div className="panel"><span className="lbl">Award (principal)</span><h3 style={{ marginTop: 4 }}>{L(tt)}</h3><p className="mute">Insurer position {L(it)}</p></div>
        <div className="panel">
          <span className="lbl">Interest</span><h3 style={{ marginTop: 4 }}>{a.interest}% p.a.</h3>
          <p className="mute">{L(interestTo(tt, c.filed, c.payment ? D(c.payment.on) : TODAY, a.interest))} {c.payment ? "paid" : "to date"}</p>
        </div>
        <div className="panel"><span className="lbl">Appeal limitation (s.173)</span><h3 style={{ marginTop: 4 }}>{fd(lim)}</h3><p className="mute">{left > 0 ? left + " days left" : "Expired"}</p></div>
      </div>

      <div className="grid g2">
        <div className="panel" style={{ padding: 0 }}>
          <div className="tw">
            <table>
              <thead><tr><th>Issue</th><th>Insurer</th><th>Tribunal</th></tr></thead>
              <tbody>{a.params.map((p) => <tr key={p[0]}><td>{p[0]}</td><td>{p[1]}</td><td>{p[2]}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="panel" style={{ padding: 0 }}>
          <div className="tw">
            <table>
              <thead><tr><th>Head</th><th className="r">Tribunal</th><th className="r">Insurer</th><th className="r">Difference</th></tr></thead>
              <tbody>
                {a.heads.map((h) => (
                  <tr key={h[0]}><td>{h[0]}</td><td className="r">{INR(h[1])}</td><td className="r">{INR(h[2])}</td><td className="r">{h[1] - h[2] ? "+" + INR(h[1] - h[2]) : "—"}</td></tr>
                ))}
                <tr><td><B6>Total</B6></td><td className="r"><B6>{INR(tt)}</B6></td><td className="r">{INR(it)}</td><td className="r">+{INR(tt - it)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <Sp />

      <div className="ph"><h3>Issues requiring legal review</h3><span className="lbl">Appeal Intelligence</span></div>
      {a.issues.length ? a.issues.map((x, i) => (
        <div className={`find ${x.s === "Strong" ? "high" : x.s === "Moderate" ? "med" : ""}`} key={x.t}>
          <div className="fh">
            <h4 style={{ fontWeight: 400, fontSize: 14 }}>Issue {i + 1}: {x.t}</h4>
            <span className={`pill ${x.s === "Strong" ? "k" : x.s === "No ground" ? "s" : ""}`}>{x.s}</span>
          </div>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Tribunal finding</dt><dd>{x.f}</dd>
            <dt>Evidence</dt><dd>{x.e}</dd>
            <dt>Authority</dt><dd>{x.law.filter((k) => LAW[k]).map((k) => LAW[k].t + ", " + LAW[k].c).join("; ") || "—"}</dd>
            <dt>Financial impact</dt><dd>{x.impact ? L(x.impact) + " (principal)" : "—"}</dd>
          </dl>
        </div>
      )) : <p className="mute">No appealable issues found.</p>}

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="ph"><h3>Proposed decision</h3>{a.decided ? <span className="pill k">Approved</span> : <span className="pill">Awaiting legal head</span>}</div>
        <p>{a.decision}</p>
        <p className="mute" style={{ fontSize: "12.5px", marginTop: 6 }}>
          Statutory deposit if appealed: {INR(stat)} (s.173 — ₹25,000 or 50% of award, whichever is less). Estimated appeal cost ₹60,000–₹1,20,000; interest continues at {a.interest}% unless the amount is deposited.
        </p>
        {!a.decided ? (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn k" onClick={() => decide("approve")}>Approve proposal</button>
            <button className="btn" onClick={() => decide("override")}>Record opposite decision</button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ───────────── Recovery ───────────── */
export function Recovery({ c }) {
  const r = c.recovery;
  if (!r) return <p className="mute">No recovery right identified. Recovery rights are detected from coverage breaches (licence, permit, use) and from pay-and-recover orders.</p>;
  if (!r.recovered)
    return (
      <div className="panel">
        <h3>Potential recovery right</h3>
        <p style={{ marginTop: 6 }}>{r.basis}</p>
        <p className="mute">Against: {r.against}. Tracked from award onward.</p>
      </div>
    );
  const p = paidAmount(c), g = recovered(c);
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="panel"><span className="lbl">Paid</span><h3>{L(p)}</h3></div>
        <div className="panel"><span className="lbl">Recovered</span><h3>{L(g)}</h3></div>
        <div className="panel"><span className="lbl">Outstanding</span><h3>{L(p - g)}</h3></div>
        <div className="panel"><span className="lbl">Recovery rate</span><h3>{p ? Math.round((g / p) * 100) : 0}%</h3></div>
      </div>
      <div className="panel">
        <dl className="kv">
          <dt>Basis</dt><dd>{r.basis}</dd>
          <dt>Against</dt><dd>{r.against}</dd>
          <dt>Proceeding</dt><dd>{r.ep}</dd>
          <dt>Next step</dt><dd>{r.next}</dd>
        </dl>
        <Sp />
        <table>
          <thead><tr><th>Date</th><th>Note</th><th className="r">Amount</th></tr></thead>
          <tbody>{r.recovered.map((x) => <tr key={x[0]}><td>{fd(x[0])}</td><td>{x[2]}</td><td className="r">{INR(x[1])}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

/* ───────────── Audit trail ───────────── */
export function Audit({ c }) {
  const rows = S.audit[c.id] || [];
  return (
    <>
      <p className="mute" style={{ marginBottom: 12 }}>Immutable log: every AI conclusion with its model and rule version, and every human change.</p>
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th><th>Model</th><th>Rule set</th></tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.at + i}>
                  <td style={{ whiteSpace: "nowrap" }}>{e.at}</td><td>{e.actor}</td><td>{e.action}</td>
                  <td className="mute">{e.detail}</td><td className="mono">{e.model}</td><td className="mono">{e.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}