import React from "react";
import { S } from "../store";
import { CONNECTORS, EVENTMAP } from "../data/masters";
import { PageHead } from "../components/ui";
import { useMact } from "../ctx";
import { syncNow, registerCase } from "../lib/actions";

export default function Sync() {
  const { go, refresh, toast } = useMact();

  const runSync = () => { toast(syncNow().msg); refresh(); };

  const onSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k) => String(fd.get(k) ?? "").trim();

    const payload = {
      cnr: g("cnr"), mvc: g("mvc"), court: g("court"), type: g("type"),
      victim: g("victim"),
      age: g("age") ? Number(g("age")) : null,
      claim: g("claim") ? Number(g("claim")) : null,
      acc: g("acc"), pol: g("pol"),
    };

    try {
      const c = await registerCase(payload);
      toast("Case " + c.id + " registered");
      go("case", { caseId: c.id, tab: "overview" });
    } catch (err) {
      if (err.status === 409) toast("Already registered: " + (err.data?.existing_case_id || "duplicate"));
      else if (err.status === 422) toast("Check the form: " + err.message);
      else if (err.status === 401) toast("Session expired, please log in again");
      else toast("Could not register (" + (err.status || "network error") + ")");
    }
  };
  return (
    <>
      <PageHead
        title="Court & connector sync"
        sub="Court orders, new petitions and documents arrive through connectors and update case status automatically. Each event is logged against the case."
        actions={<button className="btn k" onClick={runSync}>Sync now</button>}
      />

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        <div className="panel feed">
          <div className="ph"><h3>Event log</h3><span className="lbl">{S.activity.length} events</span></div>
          <div className="list">
            {S.activity.map((e, i) => (
              <div className="li" key={e.at + e.caseId + i}>
                <div>
                  <span className="src">{e.src || "Workflow"}</span>{" "}
                  <span className="mute" style={{ fontSize: "11.5px" }}>{e.at}</span>
                  <div style={{ marginTop: 3 }}>{e.text}</div>
                </div>
                <button className="btn s g" onClick={() => go("case", { caseId: e.caseId, tab: "overview" })}>Open</button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="panel">
            <h3>Connectors</h3>
            {CONNECTORS.map((k) => (
              <div className="li" key={k[0]}>
                <div><b style={{ fontWeight: 400 }}>{k[0]}</b><br /><span className="mute" style={{ fontSize: 12 }}>{k[1]}</span></div>
                <span className={`pill ${k[2] === "Live" ? "k" : k[2] === "Consent" ? "" : "s"}`}>{k[2]}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>Status mapping</h3>
            <p className="mute" style={{ marginBottom: 8, fontSize: "12.5px" }}>How a court or connector event moves a case.</p>
            {EVENTMAP.slice(0, 6).map((m) => (
              <div className="li" key={m[0]}><span>{m[0]}</span><span className="mute" style={{ textAlign: "right" }}>{m[1]}</span></div>
            ))}
            <div className="sp" />
            <button className="btn s g" onClick={() => go("workflow")}>Full mapping in workflow designer</button>
          </div>

          <div className="panel">
            <h3>Register a petition manually</h3>
            <p className="mute" style={{ fontSize: "12.5px", marginBottom: 10 }}>For notices served by hand before the court feed lists them.</p>
            <form className="grid g2" style={{ gap: 10 }} onSubmit={onSubmit}>
              <label className="field"><span className="lbl">CNR</span><input name="cnr" required defaultValue="KABC0A0019902026" /></label>
              <label className="field"><span className="lbl">Petition no.</span><input name="mvc" required defaultValue="MVC 1990/2026" /></label>
              <label className="field" style={{ gridColumn: "1/-1" }}><span className="lbl">Tribunal</span><input name="court" required defaultValue="MACT (SCCH-9), Bengaluru" /></label>
              <label className="field"><span className="lbl">Claim type</span>
                <select name="type" defaultValue="Death"><option>Death</option><option>Injury</option><option value="No-fault">No-fault (s.164)</option></select>
              </label>
              <label className="field"><span className="lbl">Victim</span><input name="victim" required defaultValue="Harish B." /></label>
              <label className="field"><span className="lbl">Age</span><input name="age" type="number" min="1" max="99" defaultValue="36" /></label>
              <label className="field"><span className="lbl">Amount claimed (₹)</span><input name="claim" type="number" defaultValue="4500000" /></label>
              <label className="field"><span className="lbl">Accident date</span><input name="acc" type="date" defaultValue="2026-07-12" /></label>
              <label className="field"><span className="lbl">Policy no.</span><input name="pol" defaultValue="PC-2604-KA-0101990" /></label>
              <p className="mute" style={{ gridColumn: "1/-1", fontSize: 12 }}>Petitions filed more than six months after the accident are registered normally: no s.166(3) time-bar objection is raised while the Supreme Court’s interim order (Nov 2025) stands.</p>
              <div style={{ gridColumn: "1/-1" }}><button className="btn k" type="submit">Create case &amp; request documents</button></div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}