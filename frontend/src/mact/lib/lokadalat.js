import { R, isDeath } from "../data/rules.js";
import { LAW, approver, hubOf } from "../data/masters.js";
import { SITTINGS, ADV_SETTLE, LA_RULES, LA_SEED, sitting } from "../data/lokadalat.js";
import { INR, L, fd, days } from "./helpers.js";
import { S, byId } from "../store.js";
import { scenarios, doOffer, interestTo, docStats } from "./engine.js";

/* ---- fitness score (deterministic, explainable) ---- */
export function laScore(c) {
  const la = S.la[c.id], F = [], cond = [];
  if (c.stage === 16) return { score: 0, bucket: "Closed", factors: [], cond };
  if (la && la.stage >= 5) return { score: 100, bucket: "Settled", factors: [], cond };
  if (c.award) return { score: 0, bucket: "Not suitable — award passed", factors: [["Award already pronounced; Lok Adalat not available at tribunal stage", 0]], cond: ["Consider High Court Lok Adalat only if an appeal is filed"] };
  if (c.type !== "No-fault" && !(c.income && c.income.range)) return { score: 0, bucket: "Awaiting evidence", factors: [["Income / medical evidence not yet extracted — no quantum to negotiate on", 0]], cond };
  const hold = (c.flags || []).find((f) => f[0] === "high" && LA_RULES.holdPattern.test(f[1]));
  if (c.darDispute || hold)
    return { score: 15, bucket: "Hold — verify first", factors: [[c.darDispute ? "DAR disputed by surveyor" : "High integrity flag: " + hold[1], -40]], cond: ["Settle only after the integrity flag is verified and cleared"] };

  let sc = 25;
  const add = (t, p) => { F.push([t, p]); sc += p; };
  if (c.type === "No-fault") {
    add("No-fault claim: fixed s.164 amount, nothing to dispute", 45);
    add("Policy in force; DAR verified", 15);
  } else {
    const cov = c.coverage || [], breach = cov.some((r) => r[3] === "bad"), disp = c.liab && c.liab.disp.length;
    if (!breach && !disp) add("Liability clear: no coverage breach, no disputed facts", 20);
    else if (breach) { add("Coverage breach — insurer pays and recovers", 10); cond.push("Reserve recovery rights against owner in the joint memo (s.149)"); }
    else add("Some facts on negligence disputed", 8);
    const s = scenarios(c);
    const dem = (la && la.rounds.length ? la.rounds[la.rounds.length - 1].demand : null) || (c.settle && c.settle.demand) || c.claimed;
    const ratio = dem / s.tribunal.net;
    add(`Latest demand is ${ratio.toFixed(1)}× the tribunal-method estimate`, ratio <= 1.3 ? 18 : ratio <= 1.8 ? 11 : ratio <= 2.5 ? 5 : 1);
    const m = days(c.filed) / 30.4;
    if (m >= 12) add(`Pending ${Math.round(m)} months — interest accruing`, 10);
    else if (m >= 6) add(`Pending ${Math.round(m)} months`, 6);
    const im = (s.tribunal.net * R.interest) / 100 / 12;
    if (im >= 25000) add(`Interest accrues about ${L(im)} a month if contested`, 5);
    if (c.accType === "Multi-vehicle") {
      add("Composite negligence with another insurer", -5);
      cond.push("Settle the insurer’s share only, or with a right of contribution against the co-tortfeasor’s insurer");
    }
    if ((c.flags || []).some((f) => f[0] === "high")) {
      add("High flag verified — settle on evidence-supported figures only", -5);
      cond.push("Settle on functional disability / verified income only");
    }
  }
  if (docStats(c).p >= 0.8) add("Documents at least 80% complete", 8);
  const ar = ADV_SETTLE[c.cAdv];
  if (ar != null) add(`Claimant advocate settles ${Math.round(ar * 100)}% of listed matters (portfolio history)`, Math.round((ar - 0.5) * 20));
  if (c.victim.age < 18 || (c.deps || []).some((d) => d[1] < 18 && d[2] !== "No — earning"))
    cond.push("Minor’s share to be deposited in fixed deposit until majority (Lok Adalat direction)");
  sc = Math.max(0, Math.min(99, sc));
  const bucket = sc >= LA_RULES.listScore ? (cond.length ? "Fit — with conditions" : "Fit — list") : sc >= LA_RULES.considerScore ? "Consider" : "Low propensity";
  return { score: sc, bucket, factors: F, cond };
}

/* ---- negotiation band ---- */
export function laBand(c) {
  if (c.type === "No-fault") {
    const v = R.nofault[c.nfKind];
    return { opening: v, target: v, ceiling: v, tribunal: v, defend: v + interestTo(v, c.filed) + 40000, months: 0 };
  }
  const s = scenarios(c);
  if (!s || !c.income.range) return null;
  const opening = (c.settle && c.settle.offer) || doOffer(c), tribunal = s.tribunal.net;
  const disputed = c.liab && ((c.liab.disp || []).length || (c.coverage || []).some((r) => r[3] === "bad"));
  const months = c.stage >= 9 ? 10 : 18;
  const defend = tribunal + ((tribunal * R.interest) / 100 / 12) * months + 150000 + (disputed ? R.lcFee : 0);
  const r1k = (v) => Math.round(v / 1000) * 1000;
  const target = r1k(Math.max(opening, (opening + tribunal) / 2));
  const ceiling = r1k(Math.max(target, Math.min(s.band[1], defend * 0.95)));
  return { opening: r1k(opening), target, ceiling, tribunal, defend, months };
}

/* ---- AI advice for the next round ---- */
export function laSuggest(c) {
  const b = laBand(c), la = S.la[c.id];
  if (!b || !la) return null;
  const last = la.rounds[la.rounds.length - 1];
  if (!last) return { offer: b.opening, text: `Open at the Form XI figure ${L(b.opening)}.` };
  const d = last.demand, mand = la.mandate && la.mandate.status === "Approved" ? la.mandate.amt : 0;
  if (d <= b.target) return { offer: d, text: `Demand ${L(d)} is at or below target ${L(b.target)} — recommend accepting.`, accept: true };
  if (d <= b.ceiling)
    return {
      offer: d, accept: mand >= d,
      text: mand >= d
        ? `Demand ${L(d)} is within the approved mandate ${L(mand)} — can be accepted at the sitting.`
        : `Demand ${L(d)} is within the ceiling but above the current mandate — obtain mandate of ${L(b.ceiling)} (${approver(b.ceiling)}).`,
    };
  const nxt = Math.round(Math.min(b.ceiling, last.offer + (d - last.offer) * 0.4) / 1000) * 1000;
  return { offer: nxt, text: `Demand ${L(d)} is above the ceiling ${L(b.ceiling)}. Counter at ${L(nxt)} (40% of the gap, capped at ceiling). Settling above ${L(b.ceiling)} costs more than defending.` };
}

/* ---- apportionment among claimants ---- */
export function laApportion(c, amt) {
  const rows = [];
  if (isDeath(c)) {
    const cl = (c.deps || []).filter((d) => d[2] === "Yes");
    const sp = cl.filter((d) => /Wife|Husband/.test(d[0])), ch = cl.filter((d) => /Son|Daughter/.test(d[0])), pa = cl.filter((d) => /Father|Mother/.test(d[0]));
    const ot = cl.filter((d) => !sp.includes(d) && !ch.includes(d) && !pa.includes(d));
    const w = { sp: sp.length ? 0.4 : 0, ch: ch.length ? 0.4 : 0, pa: pa.length ? 0.2 : 0, ot: ot.length ? 0.1 : 0 };
    const tot = w.sp + w.ch + w.pa + w.ot || 1;
    const push = (g, k) => g.forEach((d) => rows.push([d[0] + " (" + d[1] + ")", (amt * w[k]) / tot / g.length, d[1] < 18 ? "Fixed deposit until majority; interest to guardian quarterly" : "Bank transfer to claimant account"]));
    push(sp, "sp"); push(ch, "ch"); push(pa, "pa"); push(ot, "ot");
    if (!rows.length) rows.push(["Legal representatives", amt, "Bank transfer"]);
  } else {
    rows.push([c.victim.name + (c.victim.age < 18 ? " (minor, through guardian)" : ""), amt, c.victim.age < 18 ? "Fixed deposit until majority; interest to guardian" : "Bank transfer to claimant account"]);
  }
  return rows.map((r) => [r[0], Math.round(r[1] / 100) * 100, r[2]]);
}

/* ---- joint memo of compromise ---- */
export function laMemo(c) {
  const la = S.la[c.id], b = laBand(c);
  if (!la || !b) return "Joint memo is available once the case is listed and quantum is computed.";
  const amt = la.outcome ? la.outcome.amt : la.rounds.length ? la.rounds[la.rounds.length - 1].offer : b.opening;
  const st = sitting(la.sitting) || {};
  const ap = laApportion(c, amt);
  const rec = !!c.recovery || (c.coverage || []).some((r) => r[3] === "bad");
  return [
    "BEFORE THE LOK ADALAT",
    "(constituted under section 19 of the Legal Services Authorities Act, 1987)",
    `${st.name || ""} — ${st.auth || ""} — sitting of ${st.date ? fd(st.date) : "—"}`,
    "",
    `In ${c.mvc}, pending before ${c.court}`,
    `(referred under section 20 — ${la.ref})`,
    "",
    `${c.victim.name}${isDeath(c) ? " (deceased), through legal representatives" : ""} … Claimant(s)`,
    "versus",
    `${c.driver.name !== "—" ? c.driver.name + " (driver), " : ""}owner of ${c.vehicle.reg}, and The New India Assurance Co. Ltd. … Respondents`,
    "",
    "JOINT MEMO OF COMPROMISE",
    "",
    `1. The claimant(s) and the Respondent insurer have settled the claim for a lump sum of ${INR(amt)} (${L(amt)}), in full and final settlement of all claims arising from the accident on ${fd(c.accident)}, inclusive of interest and costs.`,
    "",
    `2. The Respondent insurer shall deposit the amount before the Tribunal / transfer it to the claimants’ accounts within ${R.settleDepositDays} days of the Lok Adalat award. If not paid within that time, interest at ${R.interest}% p.a. shall be payable from the date of the award until payment.`,
    "",
    "3. The amount shall be apportioned as follows:",
    ...ap.map((r, i) => `   (${String.fromCharCode(97 + i)}) ${r[0]}: ${INR(r[1])} — ${r[2]}`),
    "",
    `4. ${rec
      ? `The Respondent insurer pays under the policy without prejudice to its right to recover the amount from the owner of the vehicle, which right is expressly reserved (section 149, Motor Vehicles Act, 1988; ${LAW.swaran.t}, ${LAW.swaran.c}).`
      : "The settlement is without admission of any fact beyond what is recorded here."}`,
    "",
    "5. The claimants declare that no other claim for this accident is pending before any forum and that they shall make no further claim against the Respondents.",
    "",
    `6. The parties request the Lok Adalat to pass an award in these terms. The parties understand that the award is final and binding and that no appeal lies against it (section 21; ${LAW.ptthomas.t}, ${LAW.ptthomas.c}).`,
    "",
    `Claimant(s): ${ap.map((r) => r[0]).join(", ")}`,
    `Advocate for claimants: ${c.cAdv}`,
    "",
    `For The New India Assurance Co. Ltd.: ${c.officer}, Designated Officer, ${hubOf(c).name}`,
    `Advocate for insurer: ${c.advocate}`,
    `Mandate: ${la.mandate && la.mandate.status === "Approved" ? L(la.mandate.amt) + " approved by " + la.mandate.level + " on " + fd(la.mandate.on) : "—"}`,
  ].join("\n");
}

/* ---- per-sitting totals ---- */
export function sitStats(s) {
  const L2 = Object.values(S.la).filter((x) => x.sitting === s.id), cs = L2.map((x) => byId(x.caseId));
  const set = L2.filter((x) => x.outcome);
  const setAmt = set.reduce((a, x) => a + x.outcome.amt, 0);
  const claimedSet = set.reduce((a, x) => a + byId(x.caseId).claimed, 0);
  const sav = set.reduce((a, x) => { const b = laBand(byId(x.caseId)); return a + (b ? b.defend - x.outcome.amt : 0); }, 0);
  return {
    listed: L2.length, settled: set.length, setAmt, claimedSet, sav,
    mand: L2.reduce((a, x) => a + (x.mandate && x.mandate.status === "Approved" ? x.mandate.amt : 0), 0),
    claimed: cs.reduce((a, c) => a + c.claimed, 0), returned: L2.filter((x) => x.returned).length,
  };
}

/* ---- seed (data comes from LA_SEED) ---- */
export function seedLA() {
  S.la = {};
  LA_SEED.forEach((s) => {
    const c = byId(s.id);
    if (!c) return;
    S.la[s.id] = { caseId: s.id, sitting: s.sitting, stage: s.stage, ref: s.ref, rounds: [], mandate: null, outcome: s.outcome || null, returned: false };
    if (s.settleStatus && c.settle) c.settle.status = s.settleStatus;
  });
  LA_SEED.forEach((s) => {
    const c = byId(s.id), la = S.la[s.id], b = c && laBand(c);
    if (!la || !b) return;
    la.rounds = (s.rounds || []).map(([date, where, demand, offer, note]) => ({
      date, where, demand, offer: offer === "open" ? b.opening : offer === "target" ? b.target : offer, note,
    }));
    if (s.mandate) {
      const amt = s.mandate.amt === "ceiling" ? b.ceiling : s.mandate.amt;
      la.mandate = { amt, level: approver(amt), status: s.mandate.status, on: s.mandate.on };
    }
  });
}