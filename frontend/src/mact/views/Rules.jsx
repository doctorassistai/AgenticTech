import React from "react";
import { R, CONV, dedRate, fracStr } from "../data/rules";
import { HUBS, NODAL, DELEGATION, ROLES, GUARDRAILS } from "../data/masters";
import { INR, L } from "../lib/helpers";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";
import { applyConv } from "../lib/actions";

const multLabel = (i) =>
  i === 0 ? `Up to ${R.mult[0][0]}`
  : i === R.mult.length - 1 ? `Above ${R.mult[i - 1][0]}`
  : `${R.mult[i - 1][0] + 1}–${R.mult[i][0]}`;

const bandLabel = (rows, i) =>
  i === 0 ? `Below ${rows[0][0]}`
  : i === rows.length - 1 ? `${rows[i - 1][0]} and above`
  : `${rows[i - 1][0]}–${rows[i][0] - 1}`;

// Group consecutive dependant counts that share a deduction rate, by probing the rule itself.
function deductionRows() {
  const out = [];
  for (let n = 0; n <= 12; n++) {
    const d = dedRate(true, n), last = out[out.length - 1];
    if (last && last.d === d) last.to = n; else out.push({ d, from: n, to: n });
  }
  return out.map((g, i) => ({
    label: "Married, " + (i === out.length - 1 ? `${g.from} or more` : g.from === g.to ? `${g.from}` : `${g.from}–${g.to}`) + " dependants",
    rate: fracStr(g.d),
  }));
}

export default function Rules() {
  const { refresh, toast } = useMact();
  const fpKeys = Object.keys(R.fp);
  const fpBands = R.fp[fpKeys[0]];
  const cfg = [
    ["Loss of estate", INR(R.estate)],
    ["Funeral", INR(R.funeral)],
    ["Consortium / person", INR(R.consortium)],
    ["Default interest", `${R.interest}% p.a.`],
    ["Form XI offer window", `${R.doOfferDays} days from DAR`],
    ["WS window", `${R.wsDays} days from notice`],
    ["Appeal limitation", `${R.appealDays} days`],
    ["Surveyor window", `${R.surveyDays} days from DAR`],
    ["Deposit after settlement", `${R.settleDepositDays} days from record`],
    ["s.164 no-fault", Object.entries(R.nofault).map(([k, v]) => `${INR(v)} ${k.toLowerCase()}`).join(" · ")],
    ["Local Commissioner fee", `${INR(R.lcFee)} per case (provision, configurable)`],
  ];
  const ded = [{ label: "Unmarried", rate: fracStr(dedRate(false, 0)) }, ...deductionRows()];
  const hd = { padding: "14px 16px 0" };

  return (
    <>
      <PageHead
        title="Rules & masters"
        sub={`Versioned rule set ${R.version}. Every calculation stores the rule version it used; changes need legal-head approval.`}
      />
      <div className="grid g3">
        <div className="panel" style={{ padding: 0 }}>
          <div className="ph" style={hd}><h4>Multiplier (Sarla Verma)</h4></div>
          <table>
            <thead><tr><th>Age up to</th><th className="r">Multiplier</th></tr></thead>
            <tbody>{R.mult.map((m, i) => <tr key={i}><td>{multLabel(i)}</td><td className="r">{m[1]}</td></tr>)}</tbody>
          </table>
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="panel" style={{ padding: 0 }}>
            <div className="ph" style={hd}><h4>Future prospects (Pranay Sethi)</h4></div>
            <table>
              <thead><tr><th>Age</th>{fpKeys.map((k) => <th key={k} className="r" style={{ textTransform: "capitalize" }}>{k}</th>)}</tr></thead>
              <tbody>
                {fpBands.map((_, i) => (
                  <tr key={i}>
                    <td>{bandLabel(fpBands, i)}</td>
                    {fpKeys.map((k) => <td key={k} className="r">{Math.round(R.fp[k][i][1] * 100)}%</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div className="ph" style={hd}><h4>Personal deduction</h4></div>
            <table><tbody>{ded.map((d) => <tr key={d.label}><td>{d.label}</td><td className="r">{d.rate}</td></tr>)}</tbody></table>
          </div>
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="panel">
            <h4>Conventional heads</h4>
            <div className="sp" style={{ height: 8 }} />
            <dl className="kv" style={{ gridTemplateColumns: "130px minmax(0,1fr)" }}>
              {cfg.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
            </dl>
            <p className="mute" style={{ fontSize: 12, marginTop: 10 }}>{R.convNote}</p>
            <div className="row" style={{ marginTop: 10 }}>
              {Object.keys(CONV).map((k) => (
                <button key={k} className={`chip ${R.convStep === k ? "on" : ""}`} onClick={() => { toast(applyConv(k)); refresh(); }}>{CONV[k].label}</button>
              ))}
            </div>
            <p style={{ marginTop: 8 }}><span className="pill d">Pending legal confirmation</span></p>
          </div>
          <div className="panel">
            <h4>Roles &amp; access</h4>
            <div className="sp" style={{ height: 8 }} />
            {ROLES.map((r) => (
              <div className="li" key={r[0]}><span>{r[0]}</span><span className="mute" style={{ textAlign: "right", fontSize: 12 }}>{r[1]}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="sp" />
      <div className="grid g2">
        <div className="panel">
          <h3>Legal guardrails</h3>
          <div className="sp" style={{ height: 8 }} />
          {GUARDRAILS.map((r) => (
            <div className="li" key={r[0]}>
              <div><b style={{ fontWeight: 400 }}>{r[0]}</b><br /><span className="mute" style={{ fontSize: 12 }}>{r[1]}</span></div>
              <span className="pill k">On</span>
            </div>
          ))}
        </div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="panel" style={{ padding: 0 }}>
            <div className="ph" style={hd}><h4>Delegation of powers (sample — replace with New India’s)</h4></div>
            <table>
              <thead><tr><th>Offer / settlement up to</th><th>Approver</th></tr></thead>
              <tbody>
                {DELEGATION.map((d, i) => (
                  <tr key={i}><td>{d[0] === Infinity ? "Above " + L(DELEGATION[i - 1][0]) : L(d[0])}</td><td>{d[1]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div className="ph" style={hd}><h4>TP hubs &amp; nodal officers (sample — replace with published lists)</h4></div>
            <div className="tw">
              <table>
                <thead><tr><th>District</th><th>TP hub</th><th>Type</th><th>Region</th><th>Nodal Officer (Rule 24)</th></tr></thead>
                <tbody>
                  {Object.entries(HUBS).map(([d, h]) => (
                    <tr key={d}><td>{d}</td><td>{h[0]}</td><td>{h[1]}</td><td>{h[2]}</td><td className="mute" style={{ fontSize: 12 }}>{(NODAL[h[2]] || "").split(",")[0]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}