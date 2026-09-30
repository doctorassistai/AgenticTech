import React from "react";
import { S } from "../store";
import { NAV } from "../data/masters";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";

// Shown for views that have not been ported yet.
export default function Placeholder() {
  const { go } = useMact();
  const isCase = S.view === "case";
  const title = isCase
    ? (S.cases.find((c) => c.id === S.caseId)?.victim.name || "Case")
    : NAV.flatMap(([, items]) => items).find(([k]) => k === S.view)?.[1] || "Console";
  return (
    <>
      <PageHead title={title} sub={isCase ? `Case ${S.caseId} — the case workspace is ported in the next batch.` : "This module is ported in an upcoming batch."} />
      <div className="panel">
        <p className="mute" style={{ marginBottom: 12 }}>Nothing to show here yet.</p>
        <button className="btn" onClick={() => go(isCase ? "cases" : "dashboard")}>{isCase ? "Back to case register" : "Back to command centre"}</button>
      </div>
    </>
  );
}