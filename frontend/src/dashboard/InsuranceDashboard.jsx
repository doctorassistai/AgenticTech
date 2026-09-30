import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  UploadCloud,
  Search,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
} from "lucide-react";

const API = import.meta.env.VITE_BACKEND_URL;

/* ─────────────────────────────────────────────────────────────────────
   NOTE ON SCOPE
   This ports the standalone "Al Koot Code Search" HTML tool's three
   tabs (Claim Browser / Search Matrix / Condition Dictionary) into
   React, plus keeps your existing Upload panel and "Ask about a
   condition" RAG feature as a 4th tab. Skipped on purpose:
   - the password lock screen (this app already sits behind hospital
     login, so a second gate is redundant)
   - the Condition Dictionary's free-text "search by symptom wording"
     refinement on top of the combo picker (the combo picker itself,
     sorted by approval rate and clickable, is intact — just not the
     extra keyword-highlight-in-notes layer)
   Everything else — filters, KPIs, grouped/flat views, combo-risk
   warnings, manual-approval flags, exact/all/any secondary-code
   matching, approved-combination mining, "strengthens your
   combination" superset highlighting — is ported.
   ───────────────────────────────────────────────────────────────── */

/* ---------------- shared helpers ---------------- */

const money = (n) =>
  (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(m) {
  if (!m) return "";
  const [y, mo] = m.split("-");
  return (MONTH_NAMES[+mo] || mo) + " " + y;
}

function cleanCode(v) {
  return (v || "").replace(/\s+—.*$/, "").trim().toUpperCase();
}

function rejRemark(t) {
  return !!t && /reject|denied|not payable|not approved|not covered/i.test(t);
}
function isManApproved(r) {
  return r.app > 0 && rejRemark(r.bot);
}

function withHay(rows) {
  return rows.map((r) => ({
    ...r,
    _hay: [r.mname, r.mid, r.inv, r.picd, r.picddesc, r.cpt, r.scode, r.sdesc, r.denial, r.bot, r.sym]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  }));
}

function groupByInvoice(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = (r.inv || "").trim() || `NOINV:${r.mid}:${r.dot}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return [...map.entries()];
}

/* Highlights occurrences of `q` inside `text`. Returns text unchanged
   when there's nothing to highlight. */
function Hi({ text, q }) {
  const s = text == null ? "" : String(text);
  if (!q || !q.trim()) return <>{s}</>;
  let re;
  try {
    re = new RegExp("(" + q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i");
  } catch (e) {
    return <>{s}</>;
  }
  const parts = s.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>
      )}
    </>
  );
}

function StatusBadge({ status }) {
  return status === "Rejected" ? (
    <span className="badge re">Rejected</span>
  ) : (
    <span className="badge ap">Approved</span>
  );
}

function ManFlag({ r }) {
  if (!isManApproved(r)) return null;
  return (
    <>
      <div className="manflag">⚑ Manually Approved</div>
      <span className="mannote">BOT rejected, reviewed Doctor notes to manually approve</span>
    </>
  );
}

function ComboFlag({ cpt, cptSet, comboByRej }) {
  const rules = comboByRej[cpt];
  if (!rules || !cptSet) return null;
  const hits = rules.filter((c) => cptSet.has(c.with));
  if (!hits.length) return null;
  return (
    <>
      {hits.map((c, i) => {
        const tip = `Rejected ${Math.round(c.rate * 100)}% of the time when billed with ${c.withName} (${c.with}), vs ${Math.round(c.base * 100)}% otherwise — from ${c.n} co-billed invoices. ${c.why}.`;
        return (
          <div className="combo" title={tip} key={i}>
            ⚠ Combo risk: usually rejected when billed with {c.withName} ({c.with})
          </div>
        );
      })}
    </>
  );
}

function RatePill({ rate }) {
  const c = rate >= 85 ? "hi" : rate >= 60 ? "mid" : "lo";
  return <span className={`rpill ${c}`}>{rate}%</span>;
}

function KpiBar({ items }) {
  return (
    <div className="kpis">
      {items.map(([l, v, c], i) => (
        <div className={`kpi ${c || ""}`} key={i}>
          <div className="v">{typeof v === "number" ? v.toLocaleString() : v}</div>
          <div className="l">{l}</div>
        </div>
      ))}
    </div>
  );
}

function LineRow({ r, cptSet, comboByRej, q }) {
  return (
    <tr className={r.status === "Rejected" ? "rowrej" : "rowok"}>
      <td>
        <div className="svc"><Hi text={r.sdesc} q={q} /></div>
        <div className="scode"><Hi text={r.scode} q={q} /></div>
        {cptSet && <ComboFlag cpt={r.cpt} cptSet={cptSet} comboByRej={comboByRej} />}
      </td>
      <td className="cpt"><Hi text={r.cpt} q={q} /></td>
      <td>
        <StatusBadge status={r.status} />
        {r.denial && <div className="denial">⚑ <Hi text={r.denial} q={q} /></div>}
        {r.bot && <div className="bot">🤖 <Hi text={r.bot} q={q} /></div>}
        <ManFlag r={r} />
      </td>
      <td className="num">{money(r.clm)}</td>
      <td className="num hideS">{money(r.app)}</td>
      <td className="num hideS" style={{ color: r.dis > 0 ? "var(--magenta)" : "inherit" }}>
        {money(r.dis)}
      </td>
    </tr>
  );
}

function ClaimCard({ invoice, lines, comboByRej, q }) {
  const h = lines[0];
  const hasRej = lines.some((l) => l.status === "Rejected");
  const cptSet = new Set(lines.map((l) => l.cpt));
  const secs = [...new Set(lines.flatMap((l) => l.secs || []))];
  return (
    <div className={`card ${hasRej ? "hasrej" : ""}`}>
      <div className="chead">
        <div className="crow1">
          <div>
            <div className="mname">{invoice ? `Invoice ${invoice}` : "No invoice #"}</div>
            <div className="cmeta">
              Member <b>{h.mid || "—"}</b> · {h.dot} · <b>{h.ben}</b> · Clin {h.clin}
              {h.pre ? ` · PreAuth ${h.pre}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="cmeta">
              {lines.length} line{lines.length > 1 ? "s" : ""}
              {hasRej ? (
                <>
                  {" "}
                  · <b style={{ color: "var(--magenta)" }}>has rejection</b>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="tags">
          {h.picd && <span className="tag picd">{h.picd} — {h.picddesc}</span>}
          {secs.map((s) => (
            <span className="tag sec" key={s}>{s}</span>
          ))}
        </div>
        {h.sym && (
          <div className="sym">
            <span className="lbl">Symptoms / clinical notes</span>
            {h.sym}
          </div>
        )}
      </div>
      <table className="lines">
        <thead>
          <tr>
            <th>Service (test)</th>
            <th>CPT</th>
            <th>Status / reason / BOT remark</th>
            <th className="num">Claimed</th>
            <th className="num hideS">Approved</th>
            <th className="num hideS">Disallowed</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <LineRow key={i} r={l} cptSet={cptSet} comboByRej={comboByRej} q={q} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Claim Browser tab ---------------- */

const BROWSER_PAGE_SIZE = 25;

function Pager({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, margin: "16px 0" }}>
      <button className="btn ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>
        ← Prev
      </button>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>
        Page {page + 1} of {totalPages}
      </span>
      <button className="btn ghost" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </div>
  );
}

function ClaimBrowserTab({ rows, meta, month }) {
  const [q, setQ] = useState("");
  const [ben, setBen] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState("grouped");
  const [rejOnly, setRejOnly] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [q, ben, status, rejOnly, view, month]);
  const comboByRej = useMemo(() => {
    const m = {};
    (meta.combos || []).forEach((c) => {
      (m[c.rej] = m[c.rej] || []).push(c);
    });
    return m;
  }, [meta.combos]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!month || r.m === month) &&
        (!status || r.status === status) &&
        (!ben || r.ben === ben) &&
        (!rejOnly || r.status === "Rejected") &&
        (!ql || ql.split(/\s+/).every((t) => r._hay.includes(t)))
    );
  }, [rows, month, status, ben, rejOnly, q]);

  const kpis = useMemo(() => {
    const ap = filtered.filter((r) => r.status === "Approved").length;
    const re = filtered.filter((r) => r.status === "Rejected").length;
    const clm = filtered.reduce((a, r) => a + r.clm, 0);
    const app = filtered.reduce((a, r) => a + r.app, 0);
    const dis = filtered.reduce((a, r) => a + r.dis, 0);
    const invs = new Set(filtered.map((r) => r.inv)).size;
    return [
      ["Invoices", invs, ""],
      ["Service lines", filtered.length, ""],
      ["Approved", ap, ""],
      ["Rejected", re, "rej"],
      ["Claimed (QAR)", money(clm), ""],
      ["Approved (QAR)", money(app), ""],
      ["Disallowed (QAR)", money(dis), "rej"],
    ];
  }, [filtered]);

  const grouped = useMemo(() => groupByInvoice(filtered), [filtered]);

  const groupedTotalPages = Math.max(1, Math.ceil(grouped.length / BROWSER_PAGE_SIZE));
  const groupedPage = useMemo(
    () => grouped.slice(page * BROWSER_PAGE_SIZE, (page + 1) * BROWSER_PAGE_SIZE),
    [grouped, page]
  );

  const flatTotalPages = Math.max(1, Math.ceil(filtered.length / BROWSER_PAGE_SIZE));
  const flatPage = useMemo(
    () => filtered.slice(page * BROWSER_PAGE_SIZE, (page + 1) * BROWSER_PAGE_SIZE),
    [filtered, page]
  );

  return (
    <div>
      <KpiBar items={kpis} />
      <div className="controls">
        <input
          type="text"
          placeholder="Search member, ID, invoice, ICD, CPT, service, denial reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={ben} onChange={(e) => setBen(e.target.value)}>
          <option value="">All benefit types</option>
          {meta.benefits.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <div className="seg">
          {["", "Approved", "Rejected"].map((s) => (
            <button key={s || "all"} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
              {s || "All"}
            </button>
          ))}
        </div>
        <div className="seg">
          {[["grouped", "Grouped"], ["flat", "Flat"]].map(([v, l]) => (
            <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <button
          className="btn ghost"
          style={rejOnly ? { background: "var(--navy)", color: "#fff" } : {}}
          onClick={() => setRejOnly((x) => !x)}
        >
          Rejected only
        </button>
        <span className="count">{filtered.length} lines</span>
      </div>

      {view === "grouped" ? (
        groupedPage.length ? (
          <>
            {groupedPage.map(([inv, ls]) => (
              <ClaimCard key={inv} invoice={ls[0].inv} lines={ls} comboByRej={comboByRej} q={q} />
            ))}
            <Pager page={page} totalPages={groupedTotalPages} onPage={setPage} />
          </>
        ) : (
          <div className="empty">No claims match.</div>
        )
      ) : (
        <>
          <table className="lines flat">
            <thead>
              <tr>
                <th>Service (test)</th>
                <th>CPT</th>
                <th>Status / reason / BOT remark</th>
                <th className="num">Claimed</th>
                <th className="num hideS">Approved</th>
                <th className="num hideS">Disallowed</th>
              </tr>
            </thead>
            <tbody>
              {flatPage.map((r, i) => (
                <LineRow key={i} r={r} cptSet={null} comboByRej={comboByRej} q={q} />
              ))}
            </tbody>
          </table>
          <Pager page={page} totalPages={flatTotalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/* ---------------- Search Matrix tab ---------------- */

function SearchMatrixTab({ rows, meta, month }) {
  const [primary, setPrimary] = useState("");
  const [secs, setSecs] = useState(["", "", "", "", ""]);
  const [secMode, setSecMode] = useState("exact");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [ben, setBen] = useState("");
  const [searched, setSearched] = useState(false);

  const comboByRej = useMemo(() => {
    const m = {};
    (meta.combos || []).forEach((c) => {
      (m[c.rej] = m[c.rej] || []).push(c);
    });
    return m;
  }, [meta.combos]);

  const icdOptions = useMemo(
    () => Object.entries(meta.icdDict || {}).map(([code, desc]) => `${code}${desc ? ` — ${desc}` : ""}`),
    [meta.icdDict]
  );

  const results = useMemo(() => {
    if (!searched) return [];
    const p = cleanCode(primary);
    const secList = secs.map(cleanCode).filter(Boolean);
    const t = text.trim().toLowerCase();

    let lines = rows.filter((r) => {
      if (month && r.m !== month) return false;
      if (ben && r.ben !== ben) return false;
      if (p && (r.picd || "").toUpperCase().trim() !== p) return false;
      if (secMode === "exact") {
        const ent = new Set(secList);
        const rs = (r.secs || []).map((s) => s.toUpperCase().trim()).filter(Boolean);
        for (const s of rs) if (!ent.has(s)) return false;
      } else if (secList.length) {
        const rs = (r.secs || []).map((s) => s.toUpperCase());
        if (secMode === "all") {
          if (!secList.every((s) => rs.includes(s))) return false;
        } else {
          if (!secList.some((s) => rs.includes(s))) return false;
        }
      }
      if (t) {
        if (!t.split(/\s+/).every((w) => r._hay.includes(w))) return false;
      }
      return true;
    });
    if (status) lines = lines.filter((r) => r.status === status);

    const map = new Map();
    lines.forEach((r) => {
      const anchor = (r.inv || "").trim() || `NOINV:${r.mid}:${r.dot}`;
      const k = anchor + "¦" + r.picd;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    const entries = [...map.entries()];
    entries.sort((A, B) => {
      const ha = /health\s*check/i.test(A[1][0].ben || "");
      const hb = /health\s*check/i.test(B[1][0].ben || "");
      return ha && !hb ? 1 : hb && !ha ? -1 : 0;
    });
    return entries;
  }, [searched, primary, secs, secMode, text, status, ben, rows, month]);

  const allLines = useMemo(() => results.flatMap((e) => e[1]), [results]);
  const kpis = useMemo(() => {
    const ap = allLines.filter((r) => r.status === "Approved").length;
    const re = allLines.filter((r) => r.status === "Rejected").length;
    const invCount = new Set(allLines.map((r) => r.inv)).size;
    return [
      ["Invoices", invCount, ""],
      ["Test lines", allLines.length, ""],
      ["Approved", ap, ""],
      ["Rejected", re, "rej"],
    ];
  }, [allLines]);

  const CAP = 150;
  const shown = results.slice(0, CAP);

  function clearAll() {
    setPrimary("");
    setSecs(["", "", "", "", ""]);
    setText("");
    setSecMode("exact");
    setStatus("");
    setBen("");
    setSearched(false);
  }

  return (
    <div>
      {searched && <KpiBar items={kpis} />}
      <div className="lk-form">
        <div className="lk-grid">
          <div>
            <label>Primary ICD</label>
            <input
              list="mxIcdList"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="e.g. N94.5 — Secondary dysmenorrhea"
            />
            <div className="hint">{primary ? meta.icdDict[cleanCode(primary)] || "" : ""}</div>
          </div>
          <div>
            <label>Benefit type</label>
            <select value={ben} onChange={(e) => setBen(e.target.value)}>
              <option value="">All benefit types</option>
              {meta.benefits.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>

        {secs.map((v, i) => (
          <div className="srch-field" key={i}>
            <label>{i === 0 ? "Secondary ICD 1" : `Secondary ICD ${i + 1} (optional)`}</label>
            <input
              list="mxIcdList"
              value={v}
              placeholder="type code or description"
              onChange={(e) => {
                const copy = [...secs];
                copy[i] = e.target.value;
                setSecs(copy);
              }}
            />
          </div>
        ))}

        <div className="srch-field">
          <label>Free text</label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="member, invoice, service, denial reason…"
          />
        </div>

        <div className="lk-controls">
          <div className="seg">
            {[["exact", "Exact"], ["all", "All"], ["any", "Any"]].map(([m, l]) => (
              <button key={m} className={secMode === m ? "on" : ""} onClick={() => setSecMode(m)}>{l}</button>
            ))}
          </div>
          <div className="seg">
            {["", "Approved", "Rejected"].map((s) => (
              <button key={s || "all"} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
                {s || "All"}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => setSearched(true)}>Search</button>
          <button className="btn ghost" onClick={clearAll}>Clear</button>
          <span className="count">
            {searched
              ? `${new Set(allLines.map((r) => r.inv)).size} invoice(s) · ${results.length} claim card(s) · ${allLines.length} lines`
              : ""}
          </span>
        </div>

        <datalist id="mxIcdList">
          {icdOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </div>

      {!searched ? (
        <div className="empty search">
          Enter a primary ICD (and up to five secondary codes) and hit <b>Search</b>. Each matching claim is
          shown in the claim-card format — diagnosis on top, then every test with CPT, status / denial
          reason / BOT remark and claimed · approved · disallowed amounts.
        </div>
      ) : results.length === 0 ? (
        <div className="empty search">No claims match that diagnosis combination in this batch.</div>
      ) : (
        <>
          {results.length > CAP && (
            <div className="empty search" style={{ padding: 14, textAlign: "left" }}>
              Showing the first <b>{CAP}</b> of <b>{results.length}</b> matching claims. Add a code,
              condition or status to narrow the search.
            </div>
          )}
          {shown.map(([key, ls]) => (
            <ClaimCard key={key} invoice={ls[0].inv} lines={ls} comboByRej={comboByRej} q={text} />
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- Condition Dictionary tab ---------------- */

function ConditionDictionaryTab({ rows, meta, month }) {
  const [primaryInput, setPrimaryInput] = useState("");
  const [primary, setPrimary] = useState("");
  const [secTags, setSecTags] = useState([]);
  const [secInput, setSecInput] = useState("");

  const icdDict = meta.icdDict || {};
  const descOf = (c) => icdDict[(c || "").toUpperCase()] || "";

  function loadPrimary() {
    const raw = cleanCode(primaryInput);
    setPrimary(raw);
    setSecTags([]);
    setSecInput("");
  }

  const hasData = primary && rows.some((r) => (r.picd || "").toUpperCase().trim() === primary);

  const approvedCombos = useMemo(() => {
    if (!primary) return [];
    const invMap = new Map();
    rows.forEach((r) => {
      if ((r.picd || "").toUpperCase().trim() === primary) {
        if (!invMap.has(r.inv)) invMap.set(r.inv, []);
        invMap.get(r.inv).push(r);
      }
    });
    const comboMap = new Map();
    invMap.forEach((ls) => {
      const invSecs = new Set(ls.flatMap((r) => (r.secs || []).map((x) => (x || "").toUpperCase()).filter(Boolean)));
      const key = [...invSecs].sort().join("|");
      if (!comboMap.has(key)) comboMap.set(key, { secs: invSecs, n: 0, ap: 0, re: 0, key });
      const c = comboMap.get(key);
      c.n++;
      ls.forEach((r) => (r.status === "Approved" ? c.ap++ : c.re++));
    });
    return [...comboMap.values()]
      .filter((c) => c.ap > 0)
      .sort((a, b) => {
        const ra = a.ap / (a.ap + a.re);
        const rb = b.ap / (b.ap + b.re);
        return rb - ra || b.ap - a.ap;
      });
  }, [primary, rows]);

  function pickCombo(secsArr) {
    setSecTags(secsArr);
  }
  function addTag(code) {
    if (!code) return;
    setSecTags((t) => (t.includes(code) ? t : [...t, code]));
  }
  function removeTag(code) {
    setSecTags((t) => t.filter((c) => c !== code));
  }

  const selSet = useMemo(() => new Set(secTags), [secTags]);

  const matchResult = useMemo(() => {
    if (!primary) return null;
    const invMap = new Map();
    rows.forEach((r) => {
      if ((!month || r.m === month) && (r.picd || "").toUpperCase().trim() === primary) {
        if (!invMap.has(r.inv)) invMap.set(r.inv, []);
        invMap.get(r.inv).push(r);
      }
    });
    let lines = [];
    invMap.forEach((ls) => {
      const invSecs = new Set(ls.flatMap((r) => (r.secs || []).map((x) => (x || "").toUpperCase()).filter(Boolean)));
      const match =
        selSet.size === 0
          ? invSecs.size === 0
          : invSecs.size === selSet.size && [...selSet].every((s) => invSecs.has(s));
      if (match) lines.push(...ls);
    });
    return { lines, invMap };
  }, [primary, rows, month, selSet]);

  const otherCombos = useMemo(() => {
    if (!primary || !matchResult) return [];
    const { invMap } = matchResult;
    const comboMap = new Map();
    invMap.forEach((ls) => {
      const invSecs = new Set(ls.flatMap((r) => (r.secs || []).map((x) => (x || "").toUpperCase()).filter(Boolean)));
      const key = [...invSecs].sort().join("|");
      if (!comboMap.has(key)) comboMap.set(key, { secs: invSecs, n: 0, ap: 0, re: 0 });
      const c = comboMap.get(key);
      c.n++;
      ls.forEach((r) => (r.status === "Approved" ? c.ap++ : c.re++));
    });
    return [...comboMap.values()]
      .filter((c) => {
        if (c.secs.size === selSet.size && [...selSet].every((s) => c.secs.has(s))) return false;
        if (c.ap === 0) return false;
        return true;
      })
      .sort((a, b) => {
        const aS = selSet.size > 0 && [...selSet].every((s) => a.secs.has(s));
        const bS = selSet.size > 0 && [...selSet].every((s) => b.secs.has(s));
        if (aS !== bS) return aS ? -1 : 1;
        return b.n - a.n;
      });
  }, [primary, matchResult, selSet]);

  const invGroups = useMemo(() => {
    if (!matchResult) return [];
    const m = new Map();
    matchResult.lines.forEach((r) => {
      if (!m.has(r.inv)) m.set(r.inv, []);
      m.get(r.inv).push(r);
    });
    return [...m.entries()];
  }, [matchResult]);

  const highlightedOtherCount = otherCombos.filter(
    (c) => selSet.size > 0 && [...selSet].every((s) => c.secs.has(s))
  ).length;

  return (
    <div>
      <div className="dict-intro">
        Look up a diagnosis to see which combinations of secondary conditions have historically been
        approved, and what supporting documentation could strengthen a weak claim.
      </div>

      <div className="lk-form">
        <div className="lk-grid">
          <div>
            <label>Primary ICD code</label>
            <input
              list="dictIcdList"
              value={primaryInput}
              onChange={(e) => setPrimaryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadPrimary();
              }}
              placeholder="e.g. N94.5 — Secondary dysmenorrhea"
            />
            <div className="hint">{primary ? descOf(primary) : ""}</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button className="btn" onClick={loadPrimary}>Load</button>
            <button
              className="btn ghost"
              onClick={() => {
                setPrimaryInput("");
                setPrimary("");
                setSecTags([]);
              }}
            >
              Clear
            </button>
          </div>
        </div>
        <datalist id="dictIcdList">
          {Object.entries(icdDict).map(([c, d]) => (
            <option key={c} value={`${c}${d ? ` — ${d}` : ""}`} />
          ))}
        </datalist>
      </div>

      {!primary ? (
        <div className="empty search">Enter a diagnosis code above to see its approval history.</div>
      ) : !hasData ? (
        <div className="empty search">No claims found for <b>{primary}</b>.</div>
      ) : (
        <>
          <div className="crit-title">Approved combinations seen with {primary}</div>
          {approvedCombos.length === 0 ? (
            <div className="dchint">No approved combinations found for this primary.</div>
          ) : (
            <div className="combo-cards">
              {approvedCombos.map((c) => {
                const secArr = [...c.secs].sort();
                const rate = Math.round((c.ap / (c.ap + c.re)) * 100);
                const isSelected = secArr.length === selSet.size && secArr.every((s) => selSet.has(s));
                return (
                  <div
                    key={c.key}
                    className={`combo-card${isSelected ? " selected" : ""}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => pickCombo(secArr)}
                  >
                    <div className="cc-codes">
                      {secArr.length ? (
                        secArr.map((code) => (
                          <span className="cc-code" key={code} title={descOf(code)}>
                            {code}
                            <span className="cc-pill-desc"> {descOf(code)}</span>
                          </span>
                        ))
                      ) : (
                        <span className="cc-code" style={{ background: "#f0f1f7", color: "#9a9db0" }}>
                          No secondaries
                        </span>
                      )}
                    </div>
                    <div className="cc-stats"><RatePill rate={rate} /></div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="crit-title">Refine the combination</div>
          <div className="dict-tag-wrap">
            <div className="dict-tags">
              {secTags.map((code) => (
                <span className="dict-tag" key={code}>
                  {code}
                  <span className="tag-desc"> {descOf(code)}</span>
                  <span className="tag-rm" onClick={() => removeTag(code)}>×</span>
                </span>
              ))}
            </div>
            <input
              id="dictSecInput"
              list="dictIcdList"
              value={secInput}
              placeholder="Add a secondary code to narrow further…"
              onChange={(e) => setSecInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = cleanCode(secInput);
                  if (v) {
                    addTag(v);
                    setSecInput("");
                  }
                }
              }}
            />
          </div>
          {secTags.length > 0 && (
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setSecTags([])}>
              Clear secondaries
            </button>
          )}

          <div className="crit-title">Matching invoices{month ? ` (${monthLabel(month)})` : ""}</div>
          {!matchResult || matchResult.lines.length === 0 ? (
            <div className="empty search">
              No exact-match claims found for <b>{primary}</b> with exactly those secondary codes
              {month ? " in the selected month" : ""}. Try adjusting the combination — add or remove a
              secondary code.
            </div>
          ) : (
            <>
              <div className="dcsum">
                <b>{primary}</b>{descOf(primary) ? ` — ${descOf(primary)}` : ""}
                {secTags.length ? (
                  <>
                    {" "}&nbsp;+&nbsp; <b>{secTags.length} secondary code{secTags.length > 1 ? "s" : ""} selected</b>
                  </>
                ) : (
                  <> &nbsp;<span style={{ color: "#9a9db0" }}>(no secondaries — showing all invoices with this primary)</span></>
                )}
                <br />
                <span style={{ color: "#6b6f86", fontSize: 12 }}>
                  {matchResult.lines.length} claim lines · {invGroups.length} invoices
                </span>
              </div>

              {invGroups.map(([inv, ilines]) => {
                const iap = ilines.filter((r) => r.status === "Approved").length;
                const ire = ilines.filter((r) => r.status === "Rejected").length;
                const pline = ilines.find((r) => (r.picd || "").toUpperCase().trim() === primary) || ilines[0];
                const secCodes = (pline.secs || []).filter(Boolean);
                return (
                  <div className="inv-section" key={inv}>
                    <div className="inv-section-h">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="inv-pill">{inv}</span>
                        <span style={{ fontWeight: 700, color: "var(--navy)" }}>{primary}</span>
                        <span style={{ color: "#5b5f77" }}>{pline.picddesc}</span>
                        <span style={{ color: "#9a9db0", fontSize: 11 }}>
                          {pline.dot} · {iap} approved
                          {ire ? <> · <span style={{ color: "var(--magenta)" }}>{ire} rejected</span></> : null}
                        </span>
                      </div>
                      {secCodes.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {secCodes.map((s) => (
                            <span className="inv-sec-tag" key={s} title={descOf(s)}>
                              {s} <span className="cc-pill-desc">{descOf(s)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {pline.sym && (
                        <div className="inv-note">
                          📋 {pline.sym.slice(0, 200)}
                          {pline.sym.length > 200 ? "…" : ""}
                        </div>
                      )}
                    </div>
                    <table className="lines flat">
                      <thead>
                        <tr>
                          <th>Test / service</th>
                          <th>CPT</th>
                          <th>Status</th>
                          <th className="num">Claimed</th>
                          <th className="num">Approved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ilines.map((r, i) => (
                          <tr key={i} className={r.status === "Rejected" ? "rowrej" : "rowok"}>
                            <td>
                              <div className="svc">{r.sdesc}</div>
                              <div className="scode">{r.scode}</div>
                            </td>
                            <td className="cpt">{r.cpt}</td>
                            <td>
                              <StatusBadge status={r.status} />{" "}
                              {r.status === "Approved" &&
                                (isManApproved(r) ? (
                                  <span className="ap-badge man">✍ Manual</span>
                                ) : (
                                  <span className="ap-badge bot">✓ BOT</span>
                                ))}
                            </td>
                            <td className="num">{money(r.clm)}</td>
                            <td className="num" style={{ color: "var(--green)" }}>{money(r.app)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}

              <div className="dchint">
                Each invoice shows exactly what was billed together for this code combination. ✍ Manual
                badges mean the BOT rejected but a reviewer approved — stronger documentation needed for
                those tests.
              </div>

              {otherCombos.length > 0 && (
                <div className="other-combos">
                  <div className="other-combos-h">
                    Approved combinations seen with {primary}
                    {highlightedOtherCount ? (
                      <>
                        {" "}— <b style={{ color: "var(--magenta)" }}>{highlightedOtherCount} highlighted</b> contain
                        your selected codes and may strengthen the claim.
                      </>
                    ) : null}
                  </div>
                  <div className="combo-cards">
                    {otherCombos.map((c, i) => {
                      const isSuper = selSet.size > 0 && [...selSet].every((s) => c.secs.has(s));
                      const secArr = [...c.secs].sort();
                      const rate = c.ap + c.re > 0 ? Math.round((c.ap / (c.ap + c.re)) * 100) : 0;
                      return (
                        <div
                          key={i}
                          className={`combo-card${isSuper ? " superset" : ""}`}
                          style={{ cursor: "pointer" }}
                          onClick={() => pickCombo(secArr)}
                          title="Click to load this combination"
                        >
                          {isSuper && <div className="cc-label">★ Strengthens your combination</div>}
                          <div className="cc-codes">
                            {secArr.length ? (
                              secArr.map((code) => (
                                <span className={`cc-code${selSet.has(code) ? " sel" : ""}`} key={code}>
                                  {code}
                                </span>
                              ))
                            ) : (
                              <span className="cc-code" style={{ background: "#f0f1f7", color: "#9a9db0" }}>
                                No secondaries
                              </span>
                            )}
                          </div>
                          <div className="cc-stats">
                            {c.n} invoice{c.n > 1 ? "s" : ""} · <RatePill rate={rate} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Upload tab (existing feature, restyled) ---------------- */

function UploadTab({ hospitalId, onUploaded, claimsCount, lastUpload }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const [condition, setCondition] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState(null);
  const [result, setResult] = useState(null);

  const handleFileSelect = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const valid = [];
    const invalidNames = [];
    for (const file of files) {
      const ext = file.name.toLowerCase().split(".").pop();
      if (ext === "xls" || ext === "xlsx") valid.push(file);
      else invalidNames.push(file.name);
    }
    setUploadError(invalidNames.length ? `Skipped (not .xls/.xlsx): ${invalidNames.join(", ")}` : null);
    setSelectedFiles((prev) => [...prev, ...valid]);
  };

  const removeSelectedFile = (index) => setSelectedFiles((prev) => prev.filter((_, i) => i !== index));

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const pollJobStatus = async (taskId, { intervalMs = 2000, maxAttempts = 150 } = {}) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await fetch(`${API}insurance/web/claims-rag/upload-status/${taskId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" || data.status === "failed") return data;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { status: "failed", error: "Timed out waiting for processing to finish" };
  };

  const handleUpload = async () => {
    if (!selectedFiles.length || !hospitalId) return;
    setUploading(true);
    setUploadError(null);
    setUploadStatus(null);
    setUploadProgress({ done: 0, total: selectedFiles.length });

    let jobs = [];
    try {
      const formData = new FormData();
      formData.append("hospital_id", hospitalId);
      selectedFiles.forEach((file) => formData.append("files", file));
      const res = await fetch(`${API}insurance/web/claims-rag/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Upload failed");
      }
      const data = await res.json();
      jobs = data.jobs || [];
    } catch (err) {
      setUploadError(err.message || "Upload failed");
      setUploading(false);
      setUploadProgress(null);
      return;
    }

    let totalIngested = 0;
    const failed = [];
    let done = 0;
    await Promise.all(
      jobs.map(async (job) => {
        if (!job.task_id) {
          failed.push(`${job.file} (${job.error || "rejected"})`);
          done += 1;
          setUploadProgress({ done, total: jobs.length });
          return;
        }
        const finalStatus = await pollJobStatus(job.task_id);
        if (finalStatus.status === "success") {
          totalIngested += finalStatus.result?.claims_ingested || 0;
        } else {
          failed.push(`${job.file} (${finalStatus.error || "failed"})`);
        }
        done += 1;
        setUploadProgress({ done, total: jobs.length });
      })
    );

    if (totalIngested > 0) {
      setUploadStatus(`Ingested ${totalIngested} claims from ${jobs.length - failed.length} of ${jobs.length} file(s)`);
    }
    if (failed.length) setUploadError(`Failed: ${failed.join(", ")}`);

    setSelectedFiles([]);
    setUploadProgress(null);
    setUploading(false);
    onUploaded();
  };

  const handleQuery = async () => {
    const trimmed = condition.trim();
    if (!trimmed || !hospitalId) return;
    setQuerying(true);
    setQueryError(null);
    setResult(null);
    try {
      const res = await fetch(`${API}insurance/web/claims-rag/query`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospital_id: hospitalId, condition: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Query failed");
      }
      setResult(await res.json());
    } catch (err) {
      setQueryError(err.message || "Query failed");
    } finally {
      setQuerying(false);
    }
  };

  return (
    <div>
      <div className="lk-grid" style={{ marginBottom: 16 }}>
        <div className="lk-form" style={{ margin: 0 }}>
          <div className="crit-title" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
            Upload claim batch
          </div>
          <div className="hint" style={{ marginBottom: 12 }}>
            {claimsCount !== null
              ? `${claimsCount} claims indexed${lastUpload ? ` · last upload: ${lastUpload.source_file}` : ""}`
              : "Upload an Excel provider claim detail report (.xls/.xlsx)"}
          </div>
          <label
            className="dropzone-area"
            style={{
              border: `1.5px dashed ${dragActive ? "var(--navy)" : "var(--line)"}`,
              background: dragActive ? "#f4f3f9" : "#fff",
              borderRadius: 10,
              padding: "24px 12px",
              textAlign: "center",
              cursor: "pointer",
              display: "block",
            }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".xls,.xlsx"
              multiple
              style={{ display: "none" }}
              onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ""; }}
            />
            {selectedFiles.length ? (
              <>
                <FileSpreadsheet size={22} color="var(--navy)" />
                <p style={{ fontSize: 13, marginTop: 8 }}>
                  {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""} selected
                </p>
              </>
            ) : (
              <>
                <UploadCloud size={22} color="var(--muted)" />
                <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
                  Drag & drop or click to select .xls/.xlsx files (multiple allowed)
                </p>
              </>
            )}
          </label>

          {selectedFiles.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
              {selectedFiles.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--line)" }}
                >
                  <span>{f.name}</span>
                  <button
                    onClick={(e) => { e.preventDefault(); removeSelectedFile(i); }}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            className="btn"
            style={{ marginTop: 12, opacity: !selectedFiles.length || uploading ? 0.4 : 1 }}
            onClick={handleUpload}
            disabled={!selectedFiles.length || uploading}
          >
            {uploading
              ? `Uploading… (${uploadProgress?.done || 0}/${uploadProgress?.total || selectedFiles.length})`
              : `Upload & Index${selectedFiles.length ? ` (${selectedFiles.length})` : ""}`}
          </button>

          {uploadStatus && <p style={{ fontSize: 12, color: "var(--green)", marginTop: 8 }}>{uploadStatus}</p>}
          {uploadError && <p style={{ fontSize: 12, color: "var(--magenta)", marginTop: 8 }}>{uploadError}</p>}
        </div>

        <div className="lk-form" style={{ margin: 0 }}>
          <div className="crit-title" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
            Ask about a condition
          </div>
          <div className="hint" style={{ marginBottom: 12 }}>
            Type a diagnosis or condition to get an AI-written approval/rejection pattern summary
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ flex: 1 }}
              placeholder="e.g. diabetes, chronic gingivitis, dengue fever"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !querying) handleQuery(); }}
            />
            <button className="btn" onClick={handleQuery} disabled={querying || !condition.trim()}>
              {querying ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Get
            </button>
          </div>
          {queryError && <p style={{ fontSize: 12, color: "var(--magenta)", marginTop: 8 }}>{queryError}</p>}

          {querying ? (
            <div className="empty" style={{ marginTop: 12 }}>Analyzing claims…</div>
          ) : result ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={15} color="var(--green)" />
                  <b style={{ color: "var(--green)", fontSize: 12 }}>APPROVED</b>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                    {result.approved_evidence_count} claims reviewed
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "#3a3d52", lineHeight: 1.5 }}>
                  {result.approved_summary || "No approved claims found for this condition."}
                </p>
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <XCircle size={15} color="var(--magenta)" />
                  <b style={{ color: "var(--magenta)", fontSize: 12 }}>REJECTED</b>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                    {result.rejected_evidence_count} claims reviewed
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "#3a3d52", lineHeight: 1.5 }}>
                  {result.rejected_summary || "No rejected claims found for this condition."}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------- top-level page ---------------- */

const TABS = [
  { id: "upload", label: "Upload" },
  { id: "browser", label: "Claim Browser" },
  // { id: "matrix", label: "Search Matrix" },
  // { id: "dict", label: "Condition Dictionary" },
];

function InsuranceDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const hospitalId = new URLSearchParams(location.search).get("hospital_id");

  const [tab, setTab] = useState("upload");
  const [claimsCount, setClaimsCount] = useState(null);
  const [lastUpload, setLastUpload] = useState(null);

  const [rawRows, setRawRows] = useState([]);
  const [meta, setMeta] = useState({ months: [], benefits: [], icdDict: {}, combos: [] });
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState(null);
  const [month, setMonth] = useState("");

  const fetchSummary = useCallback(async () => {
    if (!hospitalId) return;
    try {
      const res = await fetch(`${API}insurance/web/claims-rag/summary?hospital_id=${encodeURIComponent(hospitalId)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setClaimsCount(data.claims_count);
        setLastUpload(data.last_upload);
      }
    } catch (err) {
      console.error("Failed to fetch claims summary:", err);
    }
  }, [hospitalId]);

  const fetchLines = useCallback(async () => {
    if (!hospitalId) return;
    setLinesLoading(true);
    setLinesError(null);
    try {
      const res = await fetch(`${API}insurance/web/claims-rag/lines?hospital_id=${encodeURIComponent(hospitalId)}`, { credentials: "include" });
      if (res.status === 404) {
        setRawRows([]);
        setMeta({ months: [], benefits: [], icdDict: {}, combos: [] });
        return;
      }
      if (!res.ok) throw new Error("Failed to load claim data");
      const data = await res.json();
      setRawRows(data.rows || []);
      setMeta(data.meta || { months: [], benefits: [], icdDict: {}, combos: [] });
    } catch (err) {
      setLinesError(err.message || "Failed to load claim data");
    } finally {
      setLinesLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    fetchSummary();
    fetchLines();
  }, [fetchSummary, fetchLines]);

  const rows = useMemo(() => withHay(rawRows), [rawRows]);

  const handleUploaded = () => {
    fetchSummary();
    fetchLines();
  };

  return (
    <div className="claims-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        :root{
          --navy:#160F4E; --magenta:#D81B60; --navy2:#241a6b; --bg:#f4f5fa;
          --line:#e3e5ef; --ink:#1d2030; --muted:#6b6f86; --green:#0f8a55; --greenbg:#e7f6ee;
          --redbg:#fdecef; --amber:#b06a00; --amberbg:#fff4e0; --white:#fff;
        }
        .claims-page *{box-sizing:border-box}
        .claims-page{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--ink);font-size:14px;min-height:100vh}
        .claims-header{background:linear-gradient(120deg,var(--navy),var(--navy2));color:#fff;padding:18px 22px}
        .claims-header h1{margin:0;font-size:19px;font-weight:700}
        .back-btn{display:flex;align-items:center;gap:6px;background:transparent;border:none;color:#fff;opacity:.85;font-size:12px;cursor:pointer;margin-bottom:8px;padding:0}
        .hdr-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
        .monthSel{padding:8px 12px;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:rgba(255,255,255,.12);color:#fff;font-size:13px;font-weight:600}
        .monthSel option{color:var(--ink)}
        .wrap{max-width:1320px;margin:0 auto;padding:18px}
        .tabbar{display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid var(--line);overflow-x:auto}
        .tabbar button{border:0;background:none;padding:11px 18px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;white-space:nowrap}
        .tabbar button.on{color:var(--navy);border-bottom-color:var(--magenta)}
        .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
        .kpi{background:#fff;border:1px solid var(--line);border-radius:10px;padding:13px 15px}
        .kpi .v{font-size:21px;font-weight:700;color:var(--navy)}
        .kpi .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
        .kpi.rej .v{color:var(--magenta)}
        .controls{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        .controls input,.controls select{padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff}
        .controls input[type=text]{flex:1;min-width:240px}
        .seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
        .seg button{border:0;background:#fff;padding:9px 14px;font-size:13px;cursor:pointer;color:var(--muted)}
        .seg button.on{background:var(--navy);color:#fff;font-weight:600}
        .btn{background:var(--magenta);color:#fff;border:0;border-radius:8px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer}
        .btn.ghost{background:#fff;color:var(--navy);border:1px solid var(--line)}
        .count{font-size:12px;color:var(--muted);margin-left:auto}
        .card{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:14px;overflow:hidden}
        .card.hasrej{border-color:#f3b9c6}
        .chead{padding:14px 16px;border-bottom:1px solid var(--line);background:#fafbff}
        .crow1{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
        .mname{font-size:15px;font-weight:700;color:var(--navy)}
        .cmeta{font-size:12px;color:var(--muted);margin-top:3px}
        .cmeta b{color:var(--ink);font-weight:600}
        .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
        .tag{font-size:11px;padding:3px 8px;border-radius:20px;background:#eef0f8;color:var(--navy);font-weight:600}
        .tag.picd{background:var(--navy);color:#fff}
        .tag.sec{background:#eceaf6;color:var(--navy2)}
        .sym{margin-top:9px;font-size:12.5px;background:#fff;border:1px dashed var(--line);border-radius:8px;padding:8px 10px;color:#3a3d52;white-space:pre-wrap;line-height:1.45}
        .sym .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:700;display:block;margin-bottom:2px}
        table.lines{width:100%;border-collapse:collapse}
        .lines th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);background:#fff;font-weight:700}
        .lines td{padding:9px 10px;border-bottom:1px solid #f0f1f7;vertical-align:top;font-size:12.5px}
        .lines tr:last-child td{border-bottom:0}
        .lines tr.rowok td{background:#e6f6ec}
        .lines tr.rowrej td{background:#fce3ea}
        .lines tr.rowok td:first-child{box-shadow:inset 3px 0 0 var(--green)}
        .lines tr.rowrej td:first-child{box-shadow:inset 3px 0 0 var(--magenta)}
        .lines td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .svc{font-weight:600;color:var(--ink)}
        .scode{font-size:11px;color:var(--muted)}
        .cpt{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
        .badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px}
        .badge.ap{background:var(--greenbg);color:var(--green)}
        .badge.re{background:var(--redbg);color:var(--magenta)}
        .denial{color:var(--magenta);font-size:11.5px;margin-top:3px;line-height:1.4}
        .combo{margin-top:5px;font-size:11px;line-height:1.35;color:#8a5a00;background:#fff6e0;border:1px solid #f0d089;border-radius:6px;padding:4px 7px;display:inline-block;cursor:help}
        .bot{color:#555a73;font-size:11.5px;margin-top:3px;font-style:italic;line-height:1.4}
        .manflag{display:inline-block;margin-top:4px;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:20px;background:#fff4e0;color:#b06a00;border:1px solid #f0d9a8}
        .mannote{display:block;color:#9a6b13;font-size:10.5px;margin-top:2px;line-height:1.35}
        .empty{text-align:center;padding:50px;color:var(--muted)}
        mark{background:#ffe9a8;padding:0 1px;border-radius:2px}
        .lk-form{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
        .lk-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .lk-grid label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);font-weight:700;margin-bottom:5px}
        .lk-grid input,.lk-grid select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font-size:14px}
        .hint{font-size:11px;color:var(--muted);margin-top:5px}
        .lk-controls{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
        .crit-title{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--navy);font-weight:700;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
        .dict-intro{background:#f4f3f9;border-left:4px solid var(--magenta);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;margin-bottom:16px;color:#3a3d52}
        .rpill{display:inline-block;padding:2px 8px;border-radius:20px;font-weight:700;font-size:12px}
        .rpill.hi{background:#e6f6ec;color:#1a7a3e} .rpill.mid{background:#fff4e0;color:#8a5a00} .rpill.lo{background:#fdecef;color:var(--magenta)}
        .dcsum{font-size:13px;color:#3a3d52;margin-bottom:10px;padding:10px 14px;background:#f4f3f9;border-radius:8px;line-height:1.5}
        .dchint{font-size:11.5px;color:#6b6f86;margin-top:8px;font-style:italic}
        .dict-tag-wrap{border:1.5px solid #e8d87a;border-radius:10px;padding:8px 10px;background:#fffde7;display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:48px}
        .dict-tags{display:contents}
        .dict-tag{display:inline-flex;align-items:center;gap:5px;background:#eceaf6;border:1px solid #ccc8e8;border-radius:20px;padding:4px 10px;font-size:12.5px;font-weight:600;color:var(--navy)}
        .tag-rm{cursor:pointer;color:#9a9db0;font-size:14px;line-height:1} .tag-rm:hover{color:var(--magenta)}
        .tag-desc{font-weight:400;color:#5b5f77;font-size:11.5px}
        #dictSecInput{border:none;outline:none;font-size:14px;min-width:260px;flex:1;padding:2px 4px;background:transparent;color:#3a3d52}
        .cc-pill-desc{font-weight:400;font-size:10.5px;color:#6b6f86;margin-left:2px}
        .inv-pill{display:inline-block;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:600;background:#eceaf6;color:var(--navy);border:1px solid #ccc8e8}
        .inv-section{margin-bottom:14px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
        .inv-section-h{padding:10px 14px;background:#f4f3f9;border-bottom:1px solid var(--line)}
        .inv-sec-tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:700;background:#eceaf6;color:var(--navy);border:1px solid #ccc8e8}
        .inv-note{margin-top:7px;font-size:11.5px;color:#3a3d52;line-height:1.45;background:#fffde7;border-left:3px solid #e8d87a;padding:5px 9px;border-radius:0 6px 6px 0}
        .ap-badge{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:10px;margin:1px 2px;white-space:nowrap}
        .ap-badge.bot{background:#e6f6ec;color:#1a7a3e;border:1px solid #b2dfcb}
        .ap-badge.man{background:#fff4e0;color:#8a5a00;border:1px solid #f0d089}
        .other-combos{margin-top:16px}
        .other-combos-h{font-size:13px;font-weight:700;color:var(--navy);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e3e1ef}
        .combo-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
        .combo-card{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fff;transition:border-color .15s,box-shadow .15s}
        .combo-card:hover{border-color:var(--navy);box-shadow:0 2px 8px rgba(22,15,78,.1)}
        .combo-card.selected{border-color:var(--navy);background:#eceaf6;box-shadow:0 2px 8px rgba(22,15,78,.15)}
        .combo-card.superset{border-color:#c8b4f0;background:#f7f4fd}
        .combo-card.superset .cc-label{color:var(--magenta);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
        .cc-codes{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
        .cc-code{font-size:11.5px;font-weight:700;padding:2px 7px;border-radius:10px;background:#eceaf6;color:var(--navy)}
        .cc-code.sel{background:#c8b4f0;color:#3a006f}
        .cc-stats{font-size:11px;color:#6b6f86}
        .srch-field{margin-top:10px}
        .srch-field label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);font-weight:700;margin-bottom:5px}
        .srch-field input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font-size:14px}
        .empty.search{padding:36px}
        @media(max-width:640px){.lk-grid{grid-template-columns:1fr}.lines .hideS{display:none}}
        .spin{animation:spin 1s linear infinite}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
      `}</style>

      <div className="claims-header">
        <button className="back-btn" onClick={() => navigate(`/hospital-dashboard?hospital_id=${hospitalId}`)}>
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
        <div className="hdr-row">
          <h1>Insurance Claims</h1>
          <select className="monthSel" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {meta.months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="wrap">
        <div className="tabbar">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "upload" && (
          <UploadTab hospitalId={hospitalId} onUploaded={handleUploaded} claimsCount={claimsCount} lastUpload={lastUpload} />
        )}

        {tab !== "upload" && linesLoading && <div className="empty">Loading claim data…</div>}
        {tab !== "upload" && !linesLoading && linesError && <div className="empty">{linesError}</div>}
        {tab !== "upload" && !linesLoading && !linesError && rows.length === 0 && (
          <div className="empty">
            No claim line data yet — upload a batch on the Upload tab first.
          </div>
        )}

        {tab === "browser" && !linesLoading && rows.length > 0 && (
          <ClaimBrowserTab rows={rows} meta={meta} month={month} />
        )}
        {/* {tab === "matrix" && !linesLoading && rows.length > 0 && (
          <SearchMatrixTab rows={rows} meta={meta} month={month} />
        )} */}
        {/* {tab === "dict" && !linesLoading && rows.length > 0 && (
          <ConditionDictionaryTab rows={rows} meta={meta} month={month} />
        )} */}
      </div>
    </div>
  );
}

export default InsuranceDashboard;