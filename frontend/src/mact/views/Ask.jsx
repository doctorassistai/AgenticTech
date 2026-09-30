import React, { useState } from "react";
import { S } from "../store";
import { QA, matchQuestion } from "../lib/qa";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";

export default function Ask() {
  const { refresh, toast } = useMact();
  const [text, setText] = useState("");
  const res = S.qa != null ? QA[S.qa] : null;

  const submit = (e) => {
    e.preventDefault();
    const i = matchQuestion(text);
    if (i < 0) { toast("No matching question — pick one below"); return; }
    S.qa = i;
    refresh();
  };

  return (
    <>
      <PageHead
        title="Ask the portfolio"
        sub="Ask in plain words or pick a question. Answers are computed from case records, so each row links back to evidence."
      />
      <form className="row" style={{ marginBottom: 14 }} onSubmit={submit}>
        <input className="in" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. which districts have the highest exposure?" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn k" type="submit">Ask</button>
      </form>
      <div className="row" style={{ marginBottom: 18 }}>
        {QA.map((q, j) => (
          <button key={q.q} className={`chip ${S.qa === j ? "on" : ""}`} onClick={() => { S.qa = j; refresh(); }}>{q.q}</button>
        ))}
      </div>
      {res ? (
        <div className="panel" style={{ padding: 0 }}>
          <div className="ph" style={{ padding: "14px 16px 0" }}><h3>{res.q}</h3></div>
          <div className="tw">
            <table>
              <thead><tr>{res.cols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
              <tbody>
                {res.f().map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j}>{x}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </div>
      ) : <p className="mute">Pick a question above.</p>}
    </>
  );
}