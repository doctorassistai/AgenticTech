import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import "./mact.css";
import { NAV } from "./data/masters";
import { S, open, byId } from "./store";
import { initMact, SYNCQ } from "./lib/engine";
import { loadCasesFromDb } from "./lib/actions";
import { MactCtx } from "./ctx";
import { VIEWS } from "./views";
import Placeholder from "./views/Placeholder";
import { FindingReplay, CaseReplay } from "./views/parts/Replay";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const ALLOWED_ROLE = "mact_adjudicator";

export default function MactConsole() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState({ state: "checking", user: null });
  const [, force] = useState(0);
  const [toastMsg, setToastMsg] = useState("");
const toastTimer = useRef(null);
const [modal, setModal] = useState(null);

  // Re-render after any mutation of the shared state object S.
  const refresh = useCallback(() => force((n) => n + 1), []);

  const toast = useCallback((m) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  const go = useCallback((v, extra) => {
    Object.assign(S, { view: v }, extra || {});
    refresh();
    window.scrollTo(0, 0);
  }, [refresh]);

const setTab = useCallback((t) => { S.tab = t; refresh(); }, [refresh]);
const closeModal = useCallback(() => setModal(null), []);
const showModal = useCallback((node) => setModal(node), []);
const showReplay = useCallback((f) => {
  const c = byId(S.caseId);
  if (c) setModal(<FindingReplay c={c} f={f} />);
}, []);
const showCaseReplay = useCallback(() => {
  const c = byId(S.caseId);
  if (c) setModal(<CaseReplay c={c} />);
}, []);

const ctx = useMemo(
  () => ({ go, refresh, toast, setTab, showReplay, showCaseReplay, showModal }),
  [go, refresh, toast, setTab, showReplay, showCaseReplay, showModal]);

useEffect(() => {
  const onKey = (e) => { if (e.key === "Escape") setModal(null); };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ── Session guard: cookie is httpOnly, so ask the backend ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/auth/verify`, { credentials: "include" });
        if (!res.ok) throw new Error("not authenticated");
        const data = await res.json();
        if (data?.user?.role !== ALLOWED_ROLE) throw new Error("wrong role");
        if (!cancelled) {
          initMact();
          try { await loadCasesFromDb(); } catch (e) { console.error("Could not load cases", e); }
          if (!cancelled) setAuth({ state: "ok", user: data.user });
        }
      } catch {
        if (!cancelled) navigate("/login", { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}hms/users/auth/logout`, { method: "POST", credentials: "include" });
    } catch { /* still clear the local session */ }
    ["user_id", "role", "theme", "access_token"].forEach((k) => localStorage.removeItem(k));
    navigate("/login", { replace: true });
  };

  if (auth.state !== "ok") {
    return (
      <div className="mact-root">
        <div className="mact-center">Verifying session…</div>
      </div>
    );
  }

const counts = {
    lokadalat: Object.values(S.la).filter((x) => !x.outcome && !x.returned).length,
        cases: S.cases.filter(open).length,
    settle: S.cases.filter((c) => c.stage >= 6 && c.stage <= 10).length,
    awards: S.cases.filter((c) => c.award && !c.award.decided).length,
    integrity: S.cases.reduce((s, c) => s + (c.flags || []).length, 0),
    sync: SYNCQ.length - S.syncIdx,
  };

  const View = VIEWS[S.view] || Placeholder;

  return (
    <MactCtx.Provider value={ctx}>
      <div className="mact-root">
        <div className="app">
          <aside className="rail" aria-label="Modules">
            <div className="brand">
              <b>MACT·AI</b>
              <span>Third-party claims adjudication</span>
            </div>
            <div className="navwrap">
              {NAV.map(([group, items]) => (
                <div className="navg" key={group}>
                  <span className="lbl">{group}</span>
                  {items.map(([k, t]) => (
                    <button
                      key={k}
                      className={`nav ${S.view === k || (S.view === "case" && k === "cases") ? "on" : ""}`}
                      onClick={() => go(k)}
                    >
                      {t}
                      {counts[k] ? <i>{counts[k]}</i> : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="userbox">
              <span>Signed in</span>
              <b>{auth.user.username}</b>
              <button className="btn g" onClick={handleLogout}>Sign out</button>
            </div>
          </aside>

          <main className="main">
            <View />
          </main>
        </div>
{modal ? (
  <div className="modal" onClick={closeModal}>
    <div className="mbox" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
      {modal}
      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn k" onClick={closeModal}>Close</button>
      </div>
    </div>
  </div>
) : null}
{toastMsg ? <div className="toast" role="status">{toastMsg}</div> : null}
      </div>
    </MactCtx.Provider>
  );
}