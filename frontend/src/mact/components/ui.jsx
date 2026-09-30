import React from "react";

export function PageHead({ title, sub, actions }) {
  return (
    <div className="top">
      <div>
        <span className="lbl">MACT·AI · Third-party (MACT) · TP hub configuration</span>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      <div className="row">{actions}</div>
    </div>
  );
}

export const SevPill = ({ s }) =>
  s === "high" ? <span className="pill k">High</span>
  : s === "med" ? <span className="pill">Medium</span>
  : <span className="pill s">Low</span>;

export const TypePill = ({ c }) =>
  c.type === "Death" ? <span className="pill k">Death</span>
  : c.type === "Injury" ? <span className="pill">Injury</span>
  : <span className="pill d">No-fault s.164</span>;

// Spread onto a <tr> to make it a keyboard-accessible link to a case.
export const caseRow = (go, id, tab) => ({
  "data-a": "case",
  tabIndex: 0,
  onClick: () => go("case", { caseId: id, tab: tab || "overview" }),
  onKeyDown: (e) => { if (e.key === "Enter") go("case", { caseId: id, tab: tab || "overview" }); },
});