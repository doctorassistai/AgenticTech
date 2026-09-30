import React from "react";
import { S, isReal } from "../../store";
import { R } from "../../data/rules";
import { LAW } from "../../data/masters";
import { scenarios, findings, docsFor, docStats, actionQueue, pending } from "../../lib/engine";
import { graphSVG } from "../../lib/Caselogic";
import { INR, L, fd } from "../../lib/helpers";
import { dedRate, fracStr } from "../../data/rules";
import { SevPill } from "../../components/ui";
import { useMact } from "../../ctx";
import { requestAllMissing } from "../../lib/actions";
import { RealDocuments } from "./DocumentsReal";
import { CiteList, FindingCard, Meters, Sp } from "../parts/Parts";

const statePill = (st) =>
  st === "ok" ? <span className="pill s">Clear</span>
  : st === "bad" ? <span className="pill k">Breach</span>
  : st === "warn" ? <span className="pill">Review</span>
  : <span className="pill s d">No data</span>;

export function Overview({ c }) {
  const { setTab } = useMact();
  const F = findings(c), d = docsFor(c), s = scenarios(c);
  const nba = actionQueue().filter((a) => a.c.id === c.id).slice(0, 3);
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", marginBottom: 18 }}>
        <div className="panel">
          <div className="ph"><h3>Case strength</h3><span className="lbl">evidence-weighted</span></div>
          <Meters c={c} />
        </div>
        <div className="panel">
          <div className="ph"><h3>Next actions</h3><span className="lbl">Litigation Intelligence</span></div>
          {nba.length ? nba.map((a, i) => (
            <div className="li" key={i}>
              <div>{a.act}<br /><span className="mute" style={{ fontSize: 12 }}>{a.why}</span></div>
              <span className="num">{L(a.amt)}</span>
            </div>
          )) : <p className="mute">No time-critical action.</p>}
          {s && c.income.range ? (
            <div className="note" style={{ marginTop: 12 }}>
              Tribunal-method range <b style={{ fontWeight: 400 }}>{L(s.band[0])} – {L(s.band[1])}</b> against a claim of {L(c.claimed)}. Insurer evidence-based position {L(s.insurer.net)}. Method: {c.type === "Death" ? "Sarla Verma multiplier & deduction, Pranay Sethi future prospects" : "Raj Kumar functional disability, Pranay Sethi future prospects"}; band ±7% from portfolio award dispersion.
            </div>
          ) : (
            <div className="note" style={{ marginTop: 12 }}>Quantum not computed yet: income and medical documents still being collected.</div>
          )}
        </div>
      </div>

      <div className="ws">
        <div className="panel">
          <div className="ph"><h4>Documents</h4><span className="mute" style={{ fontSize: 12 }}>{docStats(c).r}/{docStats(c).t}</span></div>
          <div className="list">
            {d.filter((x) => x.st !== "Not due").map((x, i) => (
              <div className="li" key={x.name + i}>
                <span>{x.name}</span>
                <span className="mute" style={{ fontSize: "11.5px", textAlign: "right" }}>{x.st === "Received" ? "✓" : x.st}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="ph"><h4>Reconstruction</h4><button className="btn s g" onClick={() => setTab("timeline")}>Full view</button></div>
          <div className="tl">
            {(c.timeline || []).map((t, i) => (
              <div className="tli" key={i}>
                <div className="t">{t[0]}</div><div>{t[1]}</div>
                <div className="mute" style={{ fontSize: "11.5px" }}>{t[2]}</div>
              </div>
            ))}
          </div>
          {(c.conflicts || []).length ? (
            <>
              <h4 style={{ margin: "6px 0 8px" }}>Conflicts</h4>
              {c.conflicts.map((x, i) => (
                <div className="note" style={{ marginBottom: 8 }} key={i}>{x[0]}<br />↔ {x[1]}</div>
              ))}
            </>
          ) : null}
        </div>

        <div className="panel" style={{ padding: 14 }}>
          <div className="ph"><h4>AI findings</h4><span className="mute" style={{ fontSize: 12 }}>{pending(c)} pending review</span></div>
          {F.length ? F.map((f) => <FindingCard key={f.id} f={f} />) : <p className="mute">Findings appear after documents are extracted.</p>}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="ph"><h4>Legal basis cited in this case</h4><button className="btn s g" onClick={() => setTab("legal")}>Research</button></div>
        <CiteList keys={c.law} />
      </div>
    </>
  );
}

export function Documents({ c }) {
  return isReal(c) ? <RealDocuments c={c} /> : <SampleDocuments c={c} />;
}

function SampleDocuments({ c }) {
  const { refresh, toast } = useMact();
  const d = docsFor(c), ds = docStats(c);
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="panel"><span className="lbl">Collected</span><h2>{ds.r} / {ds.t}</h2></div>
        <div className="panel"><span className="lbl">Via API</span><h2>{d.filter((x) => x.st === "Received" && (x.ch === "API" || x.ch === "Internal")).length}</h2></div>
        <div className="panel"><span className="lbl">Awaiting</span><h2>{d.filter((x) => !["Received", "Not due"].includes(x.st)).length}</h2></div>
        <div className="panel"><span className="lbl">Pages indexed</span><h2>{d.reduce((s, x) => s + x.pages, 0)}</h2></div>
      </div>
      <div className="row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <p className="mute">Documents are pulled from connectors when the case is assigned; missing items are requested automatically and retried daily.</p>
        <div className="row">
          <button className="btn" onClick={() => { toast(requestAllMissing(c)); refresh(); }}>Request all missing</button>
          <label className="btn k" htmlFor={`up-${c.id}`}>
            Upload documents
            <input type="file" id={`up-${c.id}`} multiple hidden
              onChange={(e) => { toast(uploadDocs(c, e.target.files)); e.target.value = ""; refresh(); }} />
          </label>
        </div>
      </div>
      <div className="tw panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Document</th><th>Source</th><th>Channel</th><th>Status</th><th>Received</th><th className="r">Pages</th><th className="r">OCR / parse</th><th className="r">Fields</th></tr></thead>
          <tbody>
            {d.map((x, i) => (
              <tr key={x.name + i}>
                <td>{x.name}</td>
                <td className="mute">{x.src}</td>
                <td><span className="src">{x.ch}</span></td>
                <td>{x.st === "Received" ? <span className="pill k">Received</span> : x.st === "Not due" ? <span className="pill s">Not due</span> : <span className="pill d">{x.st}</span>}</td>
                <td>{x.recv}</td>
                <td className="r">{x.pages || "—"}</td>
                <td className="r">{x.conf ? x.conf + "%" : "—"}</td>
                <td className="r">{x.fields || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Twin({ c }) {
  return (
    <>
      <p className="mute" style={{ marginBottom: 12 }}>Every document attaches to an entity and every finding attaches to evidence. Filled marks are verified, half marks need review, open marks are missing.</p>
      {/* graphSVG builds escaped SVG markup from static case data */}
      <div className="graph" dangerouslySetInnerHTML={{ __html: graphSVG(c) }} />
    </>
  );
}

export function Timeline({ c }) {
  return (
    <div className="cols2">
      <div className="panel">
        <h3>Accident &amp; treatment timeline</h3>
        <div className="sp" />
        <div className="tl">
          {(c.timeline || []).map((t, i) => (
            <div className="tli x" key={"t" + i}>
              <div className="t">{t[0]}</div><div>{t[1]}</div>
              <div className="mute" style={{ fontSize: "11.5px" }}>Source: {t[2]}</div>
            </div>
          ))}
          {c.med ? c.med.path.map((p, i) => (
            <div className="tli" key={"m" + i}>
              <div className="t">{p[0]}</div><div>{p[1]}</div>
              <div className="mute" style={{ fontSize: "11.5px" }}>Medical record</div>
            </div>
          )) : null}
        </div>
      </div>
      <div className="panel">
        <h3>Evidence conflicts</h3>
        <div className="sp" />
        {(c.conflicts || []).length ? c.conflicts.map((x, i) => (
          <div className={`find ${x[2]}`} key={i}>
            <div className="fh"><span className="lbl">Conflict</span><SevPill s={x[2]} /></div>
            <p className="fb">{x[0]}</p>
            <p className="fb">↔ {x[1]}</p>
          </div>
        )) : <p className="mute">No conflicts detected across FIR, DAR, site plan, MLC and petition.</p>}
        <div className="sp" />
        <h4 style={{ marginBottom: 8 }}>Scene facts extracted</h4>
        <dl className="kv">
          <dt>Place</dt><dd>{c.place}</dd>
          <dt>Collision type</dt><dd>{c.accType}</dd>
          <dt>Insured vehicle</dt><dd>{c.vehicle.reg} · {c.vehicle.cls}</dd>
          <dt>GVW</dt><dd>{c.vehicle.gvw}</dd>
          <dt>Treating hospital</dt><dd>{c.hospital}</dd>
        </dl>
      </div>
    </div>
  );
}

export function Coverage({ c }) {
  return (
    <>
      <div className="panel" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead><tr><th>Question</th><th>Finding</th><th>Evidence</th><th>Status</th><th>Authority</th></tr></thead>
            <tbody>
              {(c.coverage || []).length ? c.coverage.map((r, i) => (
                <tr key={i}>
                  <td>{r[0]}</td><td>{r[1]}</td><td className="mute">{r[2]}</td>
                  <td>{statePill(r[3])}</td>
                  <td className="mute" style={{ fontSize: 12 }}>{(r[4] || []).map((k) => LAW[k].t.split(" v.")[0]).join("; ") || "—"}</td>
                </tr>
              )) : <tr><td colSpan="5" className="mute">Coverage matrix is built once policy, RC, DL and permit are received.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sp" />
      <div className="grid g3">
        <div className="panel"><span className="lbl">Policy</span><h3 style={{ marginTop: 4 }}>{c.policy.no}</h3><p className="mute">{c.policy.kind} · {fd(c.policy.from)} to {fd(c.policy.to)}</p></div>
        <div className="panel"><span className="lbl">Vehicle</span><h3 style={{ marginTop: 4 }}>{c.vehicle.reg}</h3><p className="mute">{c.vehicle.cls} · GVW {c.vehicle.gvw}</p></div>
        <div className="panel"><span className="lbl">Driver</span><h3 style={{ marginTop: 4 }}>{c.driver.name}</h3><p className="mute">DL {c.driver.dl} · {c.driver.cls} · valid {c.driver.valid}</p></div>
      </div>
    </>
  );
}

function Col({ t, a }) {
  return (
    <div className="panel">
      <h4>{t}</h4>
      <div className="sp" style={{ height: 8 }} />
      {a.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{a.map((x, i) => <li style={{ marginBottom: 6 }} key={i}>{x}</li>)}</ul> : <p className="mute">None.</p>}
    </div>
  );
}

export function Liability({ c }) {
  const l = c.liab;
  if (!l) return <p className="mute">Liability analysis starts after the DAR and police documents are extracted.</p>;
  return (
    <>
      <div className="grid g3">
        <Col t="Established facts" a={l.est} />
        <Col t="Disputed facts" a={l.disp} />
        <Col t="Missing evidence" a={l.miss} />
        <Col t="Arguments supporting insurer" a={l.pro} />
        <Col t="Arguments against insurer" a={l.con} />
        <div className="panel">
          <h4>Negligence split</h4>
          <div className="sp" style={{ height: 8 }} />
          <dl className="kv">
            <dt>Insurer position</dt><dd>{l.contrib[0]}% on victim / other vehicle</dd>
            <dt>Probable finding</dt><dd>{l.contrib[1]}%</dd>
            <dt>Recovery right</dt><dd>{c.recovery ? c.recovery.basis : "None identified"}</dd>
          </dl>
        </div>
      </div>
      <div className="sp" />
      <div className="note">The engine lists facts and arguments with their sources. The legal conclusion on negligence is recorded only by the officer or advocate.</div>
    </>
  );
}

export function Medical({ c }) {
  const m = c.med;
  if (!m) {
    return (
      <div className="panel">
        <h3>Cause of death</h3>
        <p className="mute" style={{ marginTop: 6 }}>
          {c.type === "Death" ? "Post-mortem and death summary linked in the evidence graph. Medical expenses verified: " + INR(c.q.medVer) : "Medical records awaited."}
        </p>
      </div>
    );
  }
  return (
    <div className="grid g2">
      <div className="panel">
        <h3>Injuries</h3>
        <div className="sp" style={{ height: 8 }} />
        {m.inj.map((i) => <div className="li" key={i}><span>{i}</span></div>)}
        <div className="sp" />
        <h3>Treatment path</h3>
        <div className="sp" style={{ height: 8 }} />
        <div className="tl">
          {m.path.map((p, i) => <div className="tli" key={i}><div className="t">{p[0]}</div><div>{p[1]}</div></div>)}
        </div>
      </div>
      <div className="panel">
        <h3>Disability &amp; bills</h3>
        <div className="sp" style={{ height: 8 }} />
        <div className="hbar"><span>Claimed</span><div className="bar"><span style={{ width: `${m.disClaim}%` }} /></div><span>{m.disClaim}%</span></div>
        <div className="hbar"><span>Certificate</span><div className="bar"><span style={{ width: `${m.disCert || 0}%` }} /></div><span>{m.disCert != null ? m.disCert + "%" : "—"}</span></div>
        <div className="hbar"><span>AI functional</span><div className="bar h"><span style={{ width: `${m.disAI}%` }} /></div><span>{m.disAI}%</span></div>
        <div className="sp" />
        <dl className="kv"><dt>Bills claimed</dt><dd>{INR(m.billsClaim)}</dd><dt>Bills verified</dt><dd>{INR(m.billsVer)}</dd><dt>Unsupported</dt><dd>{INR(m.billsClaim - m.billsVer)}</dd></dl>
        <div className="sp" />
        <h4 style={{ marginBottom: 6 }}>Consistency check</h4>
        <p className="mute" style={{ fontSize: "12.5px" }}>FIR ↔ MLC ↔ hospital ↔ discharge summary ↔ disability certificate ↔ petition</p>
        <div className="sp" style={{ height: 8 }} />
        {m.notes.map((n) => <div className="note" style={{ marginBottom: 6 }} key={n}>{n}</div>)}
      </div>
    </div>
  );
}

export function Income({ c }) {
  if (c.type === "No-fault") return <div className="note">Not required. A claim under s.164 is paid at the fixed statutory amount without proof of income or fault.</div>;
  const i = c.income;
  if (!i || !i.range) return <p className="mute">Income evidence not yet received. Consent requests sent to account aggregator and income-tax records.</p>;
  const vals = i.sources.filter((s) => s[1]).map((s) => s[1]).concat(i.claimed ? [i.claimed] : []);
  const mx = Math.max(...vals);
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
      <div className="panel">
        <h3>Declared vs evidence</h3>
        <div className="sp" style={{ height: 10 }} />
        {i.claimed ? (
          <div className="hbar"><span>Claimed before tribunal</span><div className="bar h"><span style={{ width: `${(i.claimed / mx) * 100}%` }} /></div><span className="num">{INR(i.claimed)}</span></div>
        ) : null}
        {i.sources.map((s) => (
          <div className="hbar" key={s[0]}><span>{s[0]}</span><div className="bar"><span style={{ width: `${s[1] ? (s[1] / mx) * 100 : 0}%` }} /></div><span className="num">{s[1] ? INR(s[1]) : "—"}</span></div>
        ))}
        <div className="sp" />
        <div className="note">
          Evidence-supported range <b style={{ fontWeight: 400 }}>{INR(i.range[0])} – {INR(i.range[1])}</b> per month. Basis for future prospects: {c.q.emp === "permanent" ? "permanent employment" : c.q.emp === "notional" ? "notional income" : c.q.emp === "fixed" ? "fixed salary" : "self-employed"}.
        </div>
      </div>
      <div className="panel">
        <h3>Source quality</h3>
        <div className="sp" style={{ height: 8 }} />
        {i.sources.map((s) => <div className="li" key={s[0]}><span>{s[0]}</span><span className="src">{s[2]}</span></div>)}
      </div>
    </div>
  );
}

export function Dependency({ c }) {
  const d = c.deps || [];
  if (!d.length) return <p className="mute">Dependants not yet extracted.</p>;
  const W = Math.max(560, d.length * 150), H = 200, cx = W / 2, q = c.q;
  return (
    <>
      <div className="graph">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Dependency tree">
          <rect x={cx - 90} y="16" width="180" height="40" fill="var(--ink)" />
          <text x={cx} y="41" textAnchor="middle" fontSize="13" style={{ fill: "var(--bg)" }}>{c.victim.name} ({c.victim.age})</text>
          {d.map((p, i) => {
            const x = ((i + 0.5) * W) / d.length;
            return (
              <g key={i}>
                <path d={`M${cx} 56 V86 H${x} V116`} fill="none" stroke="var(--line2)" />
                <rect x={x - 62} y="116" width="124" height="56" fill="var(--bg)" stroke="var(--ink)" strokeDasharray={p[2] === "?" ? "4 3" : undefined} />
                <text x={x} y="138" textAnchor="middle" fontSize="13">{p[0]} · {p[1]}</text>
                <text x={x} y="158" textAnchor="middle" fontSize="11.5" style={{ fill: "var(--mute)" }}>{p[2] === "?" ? "Unverified" : p[2]}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="sp" />
      <div className="grid g3">
        <div className="panel"><span className="lbl">Dependants (claimed / insurer)</span><h2>{q.depClaim} / {q.depIns}</h2></div>
        <div className="panel"><span className="lbl">Personal deduction</span><h2>{fracStr(dedRate(q.married, q.depClaim))}</h2><p className="mute">{q.married ? "Married" : "Unmarried"} · Sarla Verma</p></div>
        <div className="panel"><span className="lbl">Consortium (persons)</span><h2>{q.consClaim}</h2><p className="mute">Magma: spousal, parental, filial</p></div>
      </div>
    </>
  );
}