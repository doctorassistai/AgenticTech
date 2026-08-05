import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────
   GLOBAL STYLES (injected once)
   Same identity: Open Sans, white/black, hairline borders.
   Simpler structure: fewer panels, more air, one signature demo.
───────────────────────────────────────────── */
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg-primary:#ffffff;--bg-secondary:#fafafa;--bg-tertiary:#f5f5f5;
  --text-primary:#000000;--text-secondary:#444444;--text-muted:#888888;
  --border:#e0e0e0;--border-strong:#000000;--accent:#000000;
}
body{font-family:'Open Sans',sans-serif;font-weight:300;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;-webkit-font-smoothing:antialiased;}
::selection{background:var(--accent);color:var(--bg-primary);}
html{scroll-behavior:smooth;}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto;}*{animation-duration:0.01ms!important;transition-duration:0.01ms!important;}}

/* NAV */
nav{position:fixed;top:0;width:100%;padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.98);backdrop-filter:blur(10px);z-index:1000;border-bottom:1px solid var(--border);}
.logo{font-weight:400;font-size:1rem;letter-spacing:-0.01em;text-decoration:none;color:var(--text-primary);}
.nav-links{display:flex;gap:1.75rem;}
.nav-links a{text-decoration:none;color:var(--text-secondary);font-size:0.78rem;font-weight:300;transition:color 0.2s;}
.nav-links a:hover{color:var(--text-primary);}
.nav-cta{padding:0.5rem 1.1rem;background:var(--accent);color:var(--bg-primary);text-decoration:none;font-size:0.75rem;font-weight:400;border:1px solid var(--accent);transition:all 0.2s;white-space:nowrap;}
.nav-cta:hover{background:transparent;color:var(--text-primary);}

/* SHARED */
.section{padding:7rem 2rem;}
.section.alt{background:var(--bg-secondary);}
.container{max-width:1060px;margin:0 auto;}
.container-narrow{max-width:880px;margin:0 auto;}
.section-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.22em;color:var(--text-muted);margin-bottom:1.25rem;font-weight:400;}
.section-h2{font-size:clamp(1.6rem,3.2vw,2.4rem);font-weight:300;letter-spacing:-0.025em;margin-bottom:1rem;line-height:1.2;}
.section-sub{font-size:0.95rem;color:var(--text-secondary);max-width:640px;margin-bottom:3.5rem;line-height:1.85;}
.reveal{opacity:0;transform:translateY(16px);transition:opacity .7s ease,transform .7s ease;}
.reveal.visible{opacity:1;transform:none;}
@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;}}

/* HERO */
.hero{min-height:92vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:10rem 2rem 6rem;border-bottom:1px solid var(--border);}
.hero-eyebrow{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.25em;color:var(--text-muted);margin-bottom:2rem;font-weight:400;}
.hero h1{font-size:clamp(2.4rem,5.6vw,4.2rem);font-weight:300;letter-spacing:-0.035em;line-height:1.08;margin-bottom:1.75rem;max-width:880px;}
.hero-subtitle{font-size:clamp(1rem,1.8vw,1.2rem);color:var(--text-secondary);max-width:580px;margin-bottom:2.75rem;line-height:1.8;}
.hero-cta{display:inline-flex;align-items:center;gap:0.5rem;padding:1rem 2rem;background:var(--accent);color:var(--bg-primary);text-decoration:none;font-size:0.9rem;font-weight:400;border:1px solid var(--accent);transition:all 0.3s;}
.hero-cta:hover{background:transparent;color:var(--text-primary);}
.hero-note{margin-top:1rem;font-size:0.72rem;color:var(--text-muted);}

/* SIGNATURE DEMO — one quiet card, not a dashboard */
.demo{width:100%;max-width:760px;margin:4.5rem auto 0;border:1px solid var(--border-strong);background:var(--bg-primary);text-align:left;}
.demo-header{display:flex;justify-content:space-between;align-items:center;padding:0.8rem 1.25rem;background:var(--bg-secondary);border-bottom:1px solid var(--border);}
.demo-title{font-size:0.68rem;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-secondary);font-weight:400;display:flex;align-items:center;gap:0.5rem;}
.demo-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 2s infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.35;}}
.demo-meta{font-size:0.68rem;color:var(--text-muted);}
.demo-trigger{padding:1rem 1.25rem;border-bottom:1px solid var(--border);font-size:0.8rem;color:var(--text-secondary);display:flex;gap:0.75rem;align-items:baseline;flex-wrap:wrap;}
.demo-trigger-label{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-muted);white-space:nowrap;}
.demo-query{padding:1rem 1.25rem;border-bottom:1px solid var(--border);font-size:0.85rem;min-height:3.4rem;color:var(--text-primary);}
.demo-steps{padding:0.75rem 1.25rem;}
.demo-step{display:flex;gap:0.9rem;padding:0.8rem 0;border-bottom:1px solid var(--border);opacity:0.25;transition:opacity .5s;}
.demo-step:last-child{border-bottom:none;}
.demo-step.on{opacity:1;}
.demo-step-num{width:22px;height:22px;border:1px solid var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.62rem;flex-shrink:0;transition:all .4s;}
.demo-step.on .demo-step-num{background:var(--accent);color:var(--bg-primary);border-color:var(--accent);}
.demo-step-name{font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.2rem;}
.demo-step-text{font-size:0.82rem;line-height:1.55;}
.demo-reco{margin:0 1.25rem 1.25rem;border:1px solid var(--accent);padding:1.1rem 1.25rem;opacity:0;transition:opacity .7s;}
.demo-reco.show{opacity:1;}
.demo-reco-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;}
.demo-reco-label{font-size:0.62rem;text-transform:uppercase;letter-spacing:0.14em;font-weight:400;}
.demo-reco-tag{font-size:0.58rem;padding:0.15rem 0.45rem;background:var(--accent);color:var(--bg-primary);letter-spacing:0.08em;}
.demo-reco-text{font-size:0.85rem;line-height:1.6;margin-bottom:0.8rem;}
.demo-actions{display:flex;gap:0.5rem;flex-wrap:wrap;}
.demo-btn{padding:0.45rem 0.85rem;border:1px solid var(--border);background:var(--bg-primary);font-size:0.7rem;cursor:pointer;transition:all 0.2s;font-family:inherit;font-weight:300;}
.demo-btn:hover{border-color:var(--accent);}
.demo-btn.primary{background:var(--accent);color:var(--bg-primary);border-color:var(--accent);}
.demo-caption{text-align:center;margin-top:1rem;font-size:0.7rem;color:var(--text-muted);font-style:italic;}

/* GAP / PROBLEM */
.gap-line{font-size:clamp(1.3rem,2.6vw,1.9rem);font-weight:300;letter-spacing:-0.02em;line-height:1.5;max-width:760px;}
.gap-line em{font-style:normal;border-bottom:1px solid var(--text-primary);}
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--border);margin-top:3.5rem;}
.stat-box{padding:2rem 1.5rem;border-right:1px solid var(--border);}
.stat-box:last-child{border-right:none;}
.stat-number{font-size:2.4rem;font-weight:300;letter-spacing:-0.05em;margin-bottom:0.5rem;line-height:1;}
.stat-label{font-size:0.74rem;color:var(--text-secondary);line-height:1.55;}

/* CAPABILITIES — the four chapters */
.cap{display:grid;grid-template-columns:88px 1fr;gap:2.5rem;padding:4.5rem 0;border-bottom:1px solid var(--border);}
.cap:last-child{border-bottom:none;}
.cap-num{font-size:2.6rem;font-weight:300;letter-spacing:-0.05em;color:var(--text-primary);line-height:1;}
.cap-num span{display:block;font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--text-muted);margin-top:0.6rem;font-weight:400;}
.cap h3{font-size:clamp(1.3rem,2.4vw,1.7rem);font-weight:300;letter-spacing:-0.02em;margin-bottom:0.9rem;line-height:1.25;}
.cap-lead{font-size:0.95rem;color:var(--text-secondary);line-height:1.85;max-width:560px;margin-bottom:2rem;}
.cap-body{display:grid;grid-template-columns:1fr 1fr;gap:2.5rem;align-items:start;}
.cap-points{display:flex;flex-direction:column;}
.cap-point{padding:1rem 0;border-bottom:1px solid var(--border);}
.cap-point:last-child{border-bottom:none;}
.cap-point strong{font-weight:400;font-size:0.88rem;display:block;margin-bottom:0.25rem;}
.cap-point p{font-size:0.78rem;color:var(--text-secondary);line-height:1.65;}
.cap-visual{border:1px solid var(--border);background:var(--bg-primary);}
.cv-header{padding:0.7rem 1rem;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:0.62rem;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-muted);font-weight:400;}
.cv-body{padding:1rem;}
.cv-split{display:grid;grid-template-columns:1fr 24px 1fr;gap:0.6rem;align-items:center;}
.cv-raw{font-size:0.68rem;line-height:1.7;color:var(--text-secondary);background:var(--bg-secondary);border:1px solid var(--border);padding:0.75rem;font-style:italic;}
.cv-arrow{text-align:center;color:var(--text-muted);font-size:0.9rem;}
.cv-struct{display:flex;flex-direction:column;gap:0.4rem;}
.cv-field{display:flex;justify-content:space-between;gap:0.5rem;font-size:0.68rem;border:1px solid var(--border);padding:0.4rem 0.6rem;}
.cv-field span:first-child{color:var(--text-muted);}
.cv-field span:last-child{font-weight:400;text-align:right;}
.cv-field.flag{border-color:var(--accent);}
.cv-mem-row{display:flex;gap:0.8rem;padding:0.7rem 0;border-bottom:1px solid var(--border);align-items:flex-start;}
.cv-mem-row:last-child{border-bottom:none;}
.cv-mem-bar{width:3px;align-self:stretch;flex-shrink:0;background:var(--border);}
.cv-mem-row.hot .cv-mem-bar{background:#000;}
.cv-mem-row.warm .cv-mem-bar{background:#777;}
.cv-mem-title{font-size:0.74rem;font-weight:400;margin-bottom:0.15rem;}
.cv-mem-desc{font-size:0.68rem;color:var(--text-secondary);line-height:1.6;}
.cv-consensus{display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.9rem;}
.cv-agent{font-size:0.6rem;padding:0.25rem 0.55rem;border:1px solid var(--border);letter-spacing:0.06em;text-transform:uppercase;}
.cv-agent.on{background:var(--accent);color:var(--bg-primary);border-color:var(--accent);}
.cv-verdict{border-left:2px solid var(--accent);padding:0.6rem 0.85rem;background:var(--bg-secondary);font-size:0.74rem;line-height:1.65;margin-bottom:0.6rem;}
.cv-verdict .v-label{font-size:0.58rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted);display:block;margin-bottom:0.25rem;}
.cv-note-line{display:flex;gap:0.6rem;align-items:baseline;padding:0.45rem 0;border-bottom:1px solid var(--border);font-size:0.72rem;}
.cv-note-line:last-child{border-bottom:none;}
.cv-check{width:14px;height:14px;border:1px solid var(--accent);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:0.5rem;flex-shrink:0;position:relative;top:2px;}
.cv-note-line span:last-child{color:var(--text-secondary);}
.cap-depth{margin-top:2rem;padding:1.1rem 1.4rem;background:var(--bg-secondary);border-left:3px solid var(--accent);font-size:0.8rem;color:var(--text-secondary);line-height:1.75;max-width:760px;}
.cap-depth strong{font-weight:400;color:var(--text-primary);}

/* CASE */
.case{border:1px solid var(--border);display:grid;grid-template-columns:260px 1fr;}
.case-side{background:var(--bg-secondary);border-right:1px solid var(--border);padding:1.75rem;}
.case-tag{display:inline-block;padding:0.25rem 0.55rem;background:var(--accent);color:var(--bg-primary);font-size:0.58rem;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:1rem;}
.case-title{font-size:1.15rem;font-weight:400;margin-bottom:0.5rem;}
.case-meta{font-size:0.76rem;color:var(--text-secondary);line-height:1.7;}
.case-vitals{margin-top:1.75rem;}
.cv-title{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-muted);margin-bottom:0.6rem;}
.vital-row{display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.74rem;}
.vital-row:last-child{border-bottom:none;}
.vital-row b{font-weight:600;}
.case-main{padding:1.75rem;}
.tl{position:relative;padding-left:1.5rem;border-left:1px solid var(--border);}
.tl-item{position:relative;margin-bottom:1.75rem;}
.tl-item:last-child{margin-bottom:0;}
.tl-dot{position:absolute;left:-1.5rem;top:0.3rem;width:8px;height:8px;background:var(--accent);border-radius:50%;margin-left:-4px;}
.tl-time{font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:0.3rem;}
.tl-text{font-size:0.85rem;line-height:1.7;color:var(--text-secondary);max-width:560px;}
.tl-text strong{font-weight:400;color:var(--text-primary);}
.tl-outcome{margin-top:0.6rem;border-left:2px solid var(--accent);background:var(--bg-secondary);padding:0.75rem 1rem;font-size:0.8rem;line-height:1.65;}

/* MOAT */
.moat{background:#080808;color:#fff;padding:7rem 2rem;}
.moat .section-label{color:rgba(255,255,255,0.45);}
.moat h2{font-size:clamp(1.6rem,3.2vw,2.4rem);font-weight:300;letter-spacing:-0.025em;line-height:1.25;margin-bottom:1.25rem;max-width:740px;}
.moat-sub{font-size:0.95rem;color:rgba(255,255,255,0.7);max-width:600px;line-height:1.85;margin-bottom:3.5rem;}
.moat-grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid rgba(255,255,255,0.14);}
.moat-cell{padding:2rem 1.75rem;border-right:1px solid rgba(255,255,255,0.1);}
.moat-cell:last-child{border-right:none;}
.moat-cell h4{font-weight:400;font-size:0.95rem;margin-bottom:0.7rem;color:#fff;}
.moat-cell p{font-size:0.8rem;color:rgba(255,255,255,0.65);line-height:1.75;}
.moat-quote{margin-top:3.5rem;border-left:3px solid #fff;padding-left:1.75rem;max-width:720px;}
.moat-quote p{font-size:1.1rem;font-weight:300;line-height:1.8;color:#fff;letter-spacing:-0.01em;}

/* SAFETY + SECURITY */
.principle{display:flex;gap:1.25rem;padding:1.5rem 0;border-bottom:1px solid var(--border);}
.principle:last-child{border-bottom:none;}
.principle-check{width:26px;height:26px;border:1px solid var(--accent);display:flex;align-items:center;justify-content:center;font-size:0.7rem;flex-shrink:0;}
.principle h4{font-size:0.95rem;font-weight:400;margin-bottom:0.3rem;}
.principle p{font-size:0.82rem;color:var(--text-secondary);line-height:1.7;max-width:640px;}
.sec-row{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--border);margin-top:2.5rem;}
.sec-cell{padding:1.75rem 1.5rem;border-right:1px solid var(--border);}
.sec-cell:last-child{border-right:none;}
.sec-cell h4{font-size:0.85rem;font-weight:400;margin-bottom:0.45rem;}
.sec-cell p{font-size:0.74rem;color:var(--text-secondary);line-height:1.65;}

/* PRICING */
.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;margin-top:3rem;}
.pricing-card{border:1px solid var(--border);padding:2.25rem 2rem;position:relative;transition:border-color 0.3s;}
.pricing-card:hover{border-color:var(--accent);}
.pricing-card.featured{border-color:var(--accent);}
.pricing-card.featured::before{content:"Most popular";position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:var(--accent);color:var(--bg-primary);padding:0.22rem 0.9rem;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.12em;}
.pricing-name{font-size:1.05rem;font-weight:400;}
.pricing-price{font-size:2.4rem;font-weight:300;letter-spacing:-0.04em;margin:1rem 0;}
.pricing-price span{font-size:0.85rem;color:var(--text-muted);}
.pricing-features{list-style:none;margin:1.25rem 0 1.75rem;}
.pricing-features li{padding:0.55rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;color:var(--text-secondary);}
.pricing-features li:last-child{border-bottom:none;}
.pricing-cta{display:block;width:100%;padding:0.875rem;text-align:center;background:var(--accent);color:var(--bg-primary);text-decoration:none;font-size:0.8rem;font-weight:400;border:1px solid var(--accent);transition:all 0.2s;}
.pricing-cta:hover{background:transparent;color:var(--text-primary);}

/* FOOTER */
footer{padding:6rem 2rem 4rem;text-align:center;border-top:1px solid var(--border);}
.footer-tagline{font-size:clamp(1.5rem,3vw,2.4rem);font-weight:300;letter-spacing:-0.025em;margin-bottom:2rem;}
.footer-cta{display:inline-block;padding:1.2rem 2.5rem;background:var(--accent);color:var(--bg-primary);text-decoration:none;font-size:0.95rem;font-weight:400;border:1px solid var(--accent);transition:all 0.3s;}
.footer-cta:hover{background:transparent;color:var(--text-primary);}
.footer-links{display:flex;justify-content:center;gap:2rem;margin-top:3rem;flex-wrap:wrap;}
.footer-links a{color:var(--text-muted);text-decoration:none;font-size:0.74rem;transition:color 0.2s;}
.footer-links a:hover{color:var(--text-primary);}

/* RESPONSIVE */
@media(max-width:900px){
  .cap-body{grid-template-columns:1fr;}
  .stats-row{grid-template-columns:1fr 1fr;}
  .stat-box:nth-child(2){border-right:none;}
  .stat-box:nth-child(-n+2){border-bottom:1px solid var(--border);}
  .moat-grid{grid-template-columns:1fr;}
  .moat-cell{border-right:none;border-bottom:1px solid rgba(255,255,255,0.1);}
  .moat-cell:last-child{border-bottom:none;}
  .sec-row{grid-template-columns:1fr 1fr;}
  .sec-cell:nth-child(2){border-right:none;}
  .sec-cell:nth-child(-n+2){border-bottom:1px solid var(--border);}
  .case{grid-template-columns:1fr;}
  .case-side{border-right:none;border-bottom:1px solid var(--border);}
  .pricing-grid{grid-template-columns:1fr;}
}
@media(max-width:768px){
  .nav-links{display:none;}
  .section{padding:4rem 1.25rem;}
  .hero{padding:7rem 1.25rem 4rem;min-height:auto;}
  .cap{grid-template-columns:1fr;gap:1.25rem;padding:3rem 0;}
  .cap-num{display:flex;align-items:baseline;gap:0.9rem;}
  .cap-num span{margin-top:0;}
  .stats-row,.sec-row{grid-template-columns:1fr;}
  .stat-box,.sec-cell{border-right:none;border-bottom:1px solid var(--border);}
  .stat-box:last-child,.sec-cell:last-child{border-bottom:none;}
  .moat{padding:4rem 1.25rem;}
  footer{padding:4rem 1.25rem 3rem;}
}
`;

function injectStyles() {
  if (document.getElementById("da-global-css")) return;
  const style = document.createElement("style");
  style.id = "da-global-css";
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}

/* ─────────────────────────────────────────────
   SIGNATURE DEMO
   One card. The system notices, reasons, recommends. Loops.
───────────────────────────────────────────── */
function SignatureDemo() {
  const timersRef = useRef([]);
  const [query, setQuery] = useState("\u00a0");
  const [trigger, setTrigger] = useState("Watching quietly — no action needed");
  const [trop, setTrop] = useState("0.06");
  const [stepsOn, setStepsOn] = useState([false, false, false, false]);
  const [recoShow, setRecoShow] = useState(false);

  const QUERY = "Troponin rising in a diabetic patient with no chest pain. Is this being missed?";
  const STEPS = [
    { name: "Understand", text: "Read the full chart in 1.2 seconds — 214 data points, including three free-text notes no system had structured before." },
    { name: "Remember", text: "Matched against clinical memory: 3 prior cases with this exact silent pattern. All three were NSTEMIs." },
    { name: "Reason", text: "Specialist agents reach consensus: NSTEMI probability 74%. HEART Score 5. The \u201cno chest pain\u201d is the pattern, not the reassurance." },
    { name: "Protect", text: "Before any order: metformin flagged for hold (eGFR 42 + contrast risk). One adverse event prevented before it could exist." },
  ];

  function after(ms, fn) { const t = setTimeout(fn, ms); timersRef.current.push(t); return t; }
  function clearAll() { timersRef.current.forEach(clearTimeout); timersRef.current = []; }

  function typewrite(text, cb) {
    let i = 0;
    const interval = setInterval(() => {
      setQuery(text.substring(0, i) + (i < text.length ? "|" : ""));
      i++;
      if (i > text.length) { clearInterval(interval); setQuery(text); if (cb) cb(); }
    }, 24);
    timersRef.current.push(interval);
  }

  function run() {
    setQuery("\u00a0");
    setTrigger("Watching quietly — no action needed");
    setTrop("0.06");
    setStepsOn([false, false, false, false]);
    setRecoShow(false);

    after(900, () => { setTrigger("Pattern detected — troponin 0.06 → 0.24 · HR 72 → 94"); setTrop("0.06 → 0.24"); });
    after(1700, () => typewrite(QUERY, () => {
      STEPS.forEach((_, i) => after(700 + i * 1500, () => setStepsOn(prev => prev.map((v, j) => (j === i ? true : v)))));
      after(700 + 4 * 1500, () => setRecoShow(true));
      after(700 + 4 * 1500 + 7000, () => { clearAll(); run(); });
    }));
  }

  useEffect(() => { run(); return () => clearAll(); }, []);

  return (
    <div>
      <div className="demo">
        <div className="demo-header">
          <div className="demo-title"><span className="demo-dot"></span>DoctorAssist — Live</div>
          <div className="demo-meta">M. Rodriguez · 67M · ED Bay 4 · Troponin {trop}</div>
        </div>
        <div className="demo-trigger">
          <span className="demo-trigger-label">No one asked anything yet</span>
          <span>{trigger}</span>
        </div>
        <div className="demo-query">{query}</div>
        <div className="demo-steps">
          {STEPS.map((s, i) => (
            <div key={i} className={`demo-step${stepsOn[i] ? " on" : ""}`}>
              <div className="demo-step-num">{i + 1}</div>
              <div>
                <div className="demo-step-name">{s.name}</div>
                <div className="demo-step-text">{s.text}</div>
              </div>
            </div>
          ))}
        </div>
        <div className={`demo-reco${recoShow ? " show" : ""}`}>
          <div className="demo-reco-head">
            <span className="demo-reco-label">Recommendation — yours to accept or dismiss</span>
            <span className="demo-reco-tag">High-risk ACS</span>
          </div>
          <div className="demo-reco-text">
            Activate ACS protocol. Serial troponins at 3h and 6h. Cardiology consult now. Hold metformin. Every line above links to its source evidence.
          </div>
          <div className="demo-actions">
            <button className="demo-btn primary">Order protocol</button>
            <button className="demo-btn">Page cardiology</button>
            <button className="demo-btn">See the evidence</button>
            <button className="demo-btn" onClick={() => { clearAll(); run(); }}>Replay ↻</button>
          </div>
        </div>
      </div>
      <div className="demo-caption">This entire sequence ran before anyone opened a search bar. That is the product.</div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   SCROLL REVEAL
───────────────────────────────────────────── */
function useReveal() {
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll(".reveal").forEach(el => el.classList.add("visible"));
      return;
    }
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); obs.unobserve(e.target); } }),
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

/* ─────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────── */
export default function home() {
  useEffect(() => { injectStyles(); }, []);
  useReveal();

  return (
    <>
      {/* NAV */}
      <nav>
        <a href="#" className="logo">DoctorAssist.AI</a>
        <div className="nav-links">
          <a href="#what-it-does">What it does</a>
          <a href="#proof">Proof</a>
          <a href="#why-us">Why no one else can</a>
          <a href="#safety">Safety</a>
          <a href="#pricing">Pricing</a>
        </div>
        <a href="https://doctorassist.ai/login" className="nav-cta">Launch interface</a>
      </nav>

      {/* HERO */}
      <section className="hero" id="home">
        <p className="hero-eyebrow">Clinical intelligence · Built for physicians</p>
        <h1>It thinks about your patient before you ask.</h1>
        <p className="hero-subtitle">
          DoctorAssist reads everything in the chart, remembers everything you've learned,
          reasons like a team of specialists, and writes the note while you work.
          One system. Four jobs. Done at the highest standard medicine has.
        </p>
        <a href="https://doctorassist.ai/login" className="hero-cta">Start free as a verified physician →</a>
        <p className="hero-note">No sales call · Verified in 24 hours · Free for individual physicians</p>
        <SignatureDemo />
      </section>

      {/* THE GAP */}
      <section className="section alt" id="gap">
        <div className="container-narrow reveal">
          <p className="section-label">Why this exists</p>
          <p className="gap-line">
            Your EHR gives you data. UpToDate gives you literature. Scribes give you words.
            <em> None of them think.</em> The thinking — across 200 data points, at 3am,
            on the patient who says "just weakness" — has always been yours alone.
          </p>
          <div className="stats-row">
            {[
              ["200+", "Data points per patient that need synthesis — every encounter"],
              ["90%", "Of CDS alerts get overridden. When everything fires, nothing matters"],
              ["2 hrs", "Of documentation for every day of actual patient care"],
              ["3am", "When the patterns get missed. Fatigue is human. Missing isn't optional"],
            ].map(([n, l], i) => (
              <div key={i} className="stat-box"><div className="stat-number">{n}</div><div className="stat-label">{l}</div></div>
            ))}
          </div>
        </div>
      </section>

      {/* FOUR CAPABILITIES */}
      <section className="section" id="what-it-does">
        <div className="container">
          <div className="reveal">
            <p className="section-label">What it does</p>
            <h2 className="section-h2">Four things. Each one, the best in the world.</h2>
            <p className="section-sub">
              Most clinical AI does one thing adequately. DoctorAssist does the four things
              that actually carry a clinical day — and does each as if it were the entire product.
            </p>
          </div>

          {/* 01 — UNDERSTAND */}
          <div className="cap reveal">
            <div className="cap-num">01<span>Understand</span></div>
            <div>
              <h3>Every patient, made readable in seconds.</h3>
              <p className="cap-lead">
                The chart is not the patient. Free-text notes, scanned documents, lab trends,
                outside records — DoctorAssist turns all of it into one structured, living clinical
                picture. Nothing buried. Nothing missed because it was a PDF.
              </p>
              <div className="cap-body">
                <div className="cap-points">
                  <div className="cap-point"><strong>Unstructured to structured, automatically</strong><p>Notes, discharge summaries, faxes, and outside records become clean clinical data — coded, time-stamped, and queryable.</p></div>
                  <div className="cap-point"><strong>Trends, not snapshots</strong><p>A troponin of 0.06 means nothing alone. The system reads direction and velocity — the things a single value hides.</p></div>
                  <div className="cap-point"><strong>One picture, always current</strong><p>New result, new note, new order — the patient picture updates in real time, across every source you have.</p></div>
                </div>
                <div className="cap-visual">
                  <div className="cv-header">Free text in → Clinical data out</div>
                  <div className="cv-body">
                    <div className="cv-split">
                      <div className="cv-raw">"pt c/o weakness x2d, denies CP, hx DM2 poorly controlled, s/p PCI '19, cr bumped, on metformin…"</div>
                      <div className="cv-arrow">→</div>
                      <div className="cv-struct">
                        <div className="cv-field"><span>Chief complaint</span><span>Weakness ×2 days</span></div>
                        <div className="cv-field"><span>History</span><span>T2DM (A1c 9.2) · PCI 2019</span></div>
                        <div className="cv-field flag"><span>Renal</span><span>eGFR 42 — flag meds</span></div>
                        <div className="cv-field flag"><span>Risk pattern</span><span>Atypical ACS candidate</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 02 — REMEMBER */}
          <div className="cap reveal">
            <div className="cap-num">02<span>Remember</span></div>
            <div>
              <h3>A clinical memory that compounds.</h3>
              <p className="cap-lead">
                Every case you see, every override you make, every near-miss you catch —
                captured automatically and returned at the exact moment it becomes relevant
                again. A second brain that gets sharper every shift you work.
              </p>
              <div className="cap-body">
                <div className="cap-points">
                  <div className="cap-point"><strong>It remembers this patient</strong><p>Last admission's decisions, what worked, what was overridden and why — present in every new encounter.</p></div>
                  <div className="cap-point"><strong>It remembers your patterns</strong><p>Your workup preferences, your judgment calls, the cases that taught you something. It learns how you practice.</p></div>
                  <div className="cap-point"><strong>It remembers what medicine learned</strong><p>Guidelines, trials, and your institution's protocols — versioned and current, so every answer reflects today's evidence.</p></div>
                </div>
                <div className="cap-visual">
                  <div className="cv-header">Three layers of memory</div>
                  <div className="cv-body">
                    <div className="cv-mem-row hot"><div className="cv-mem-bar"></div><div><div className="cv-mem-title">This encounter</div><div className="cv-mem-desc">Live state — troponin trending, cardiology consult pending since 08:14.</div></div></div>
                    <div className="cv-mem-row warm"><div className="cv-mem-bar"></div><div><div className="cv-mem-title">This patient, over time</div><div className="cv-mem-desc">2023 admission: similar weakness → NSTEMI. Pattern weighted accordingly.</div></div></div>
                    <div className="cv-mem-row"><div className="cv-mem-bar"></div><div><div className="cv-mem-title">Your practice, distilled</div><div className="cv-mem-desc">"You've seen this before — last time the answer was X, and it responded to Y."</div></div></div>
                  </div>
                </div>
              </div>
              <div className="cap-depth">
                <strong>Why it can't be switched away from:</strong> the memory is yours, and it compounds.
                Month one it's helpful. Month twelve it knows your patients, your patterns, and your blind spots
                better than any tool you've ever used. No competitor starts there.
              </div>
            </div>
          </div>

          {/* 03 — REASON & PROTECT */}
          <div className="cap reveal">
            <div className="cap-num">03<span>Decide</span></div>
            <div>
              <h3>A second opinion before you ask. A safety net after you decide.</h3>
              <p className="cap-lead">
                Not one model guessing — a team of specialist agents reasoning from different
                clinical perspectives, surfacing a recommendation only when they reach consensus.
                And when something is about to go wrong, it tells you why, with the evidence, before the order saves.
              </p>
              <div className="cap-body">
                <div className="cap-points">
                  <div className="cap-point"><strong>Consensus, not a guess</strong><p>Diagnostic, risk, pharmacy, and evidence agents reason independently. You only see what they agree on — with confidence shown.</p></div>
                  <div className="cap-point"><strong>Validation of your decision</strong><p>Made the call already? It checks it against guidelines, interactions, and your patient's specifics — silently, unless something matters.</p></div>
                  <div className="cap-point"><strong>It shows where it could be wrong</strong><p>Every recommendation includes the strongest case against itself and the test that would settle it. Below 70% confidence, it says so.</p></div>
                </div>
                <div className="cap-visual">
                  <div className="cv-header">Agent consensus — live</div>
                  <div className="cv-body">
                    <div className="cv-consensus">
                      {["Diagnostic", "Risk", "Pharmacy", "Evidence"].map((a, i) => <span key={i} className="cv-agent on">{a}</span>)}
                      <span className="cv-agent">Consensus: 4/4</span>
                    </div>
                    <div className="cv-verdict"><span className="v-label">Recommendation</span>NSTEMI 74% — activate ACS protocol, serial troponins, cardiology now.</div>
                    <div className="cv-verdict"><span className="v-label">Caught before it happened</span>Amiodarone order would push simvastatin levels ×4 — rhabdomyolysis risk. Order held. Alternative suggested.</div>
                  </div>
                </div>
              </div>
              <div className="cap-depth">
                <strong>You stay in charge — always.</strong> The system suggests; you decide.
                Every action requires your approval, every recommendation traces to its source,
                and when it's uncertain, silence beats a wrong answer. This is architecture, not policy.
              </div>
            </div>
          </div>

          {/* 04 — DOCUMENT */}
          <div className="cap reveal">
            <div className="cap-num">04<span>Document</span></div>
            <div>
              <h3>The note writes itself while you work.</h3>
              <p className="cap-lead">
                Your clinical reasoning — captured as it happens, structured the way medicine
                requires, coded at the complexity you actually delivered. Two hours a day,
                returned to you and your patients.
              </p>
              <div className="cap-body">
                <div className="cap-points">
                  <div className="cap-point"><strong>Reasoning embedded, not transcribed</strong><p>Not a recording of words — a record of decisions. Why you ordered, what you ruled out, what changed your mind.</p></div>
                  <div className="cap-point"><strong>Complexity captured honestly</strong><p>Decision-making complexity calculated from what actually happened in the encounter — never undercoded again.</p></div>
                  <div className="cap-point"><strong>Ready before you leave the room</strong><p>Review, edit, sign. Patient instructions generated in any language, at the right reading level, automatically.</p></div>
                </div>
                <div className="cap-visual">
                  <div className="cv-header">Generated as the encounter happened</div>
                  <div className="cv-body">
                    {[
                      "HPI structured from conversation — 67M, weakness ×2d, pertinent negatives captured",
                      "MDM: high complexity — documented from actual decisions made",
                      "Troponin trend, ECG comparison, and consult reasoning embedded",
                      "Discharge instructions drafted in Spanish, 6th-grade level",
                    ].map((line, i) => (
                      <div key={i} className="cv-note-line"><span className="cv-check">✓</span><span>{line}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROOF — ONE CASE, TOLD WELL */}
      <section className="section alt" id="proof">
        <div className="container reveal">
          <p className="section-label">Proof</p>
          <h2 className="section-h2">The case that made physicians tell other physicians.</h2>
          <p className="section-sub">
            We could show you benchmarks. Instead, here's forty-five minutes from a real emergency
            department — the kind of case every physician has almost missed.
          </p>
          <div className="case">
            <div className="case-side">
              <div className="case-tag">Emergency Medicine</div>
              <div className="case-title">The silent pattern</div>
              <div className="case-meta">67M admitted for "weakness." No chest pain reported. Working diagnosis on arrival: viral syndrome vs dehydration.</div>
              <div className="case-vitals">
                <div className="cv-title">On arrival</div>
                <div className="vital-row"><span>BP</span><b>142/88</b></div>
                <div className="vital-row"><span>HR</span><b>102</b></div>
                <div className="vital-row"><span>SpO2</span><b>94%</b></div>
                <div className="vital-row"><span>Troponin I</span><b>0.06</b></div>
              </div>
            </div>
            <div className="case-main">
              <div className="tl">
                <div className="tl-item">
                  <div className="tl-dot"></div>
                  <div className="tl-time">T+0 — Admission</div>
                  <div className="tl-text"><strong>Nothing looks urgent.</strong> No chest pain. Vitals borderline. On a busy shift, this patient waits.</div>
                </div>
                <div className="tl-item">
                  <div className="tl-dot"></div>
                  <div className="tl-time">T+4 min — The system notices</div>
                  <div className="tl-text">Troponin above the 99th percentile, heart rate climbing, diabetic, male, 67 — and subtle new T-wave changes versus the 2022 ECG. <strong>It had seen this exact silence before:</strong> atypical ACS hides in roughly 1 in 4 diabetic patients.</div>
                </div>
                <div className="tl-item">
                  <div className="tl-dot"></div>
                  <div className="tl-time">T+6 min — The physician decides</div>
                  <div className="tl-text">One alert, evidence attached, two buttons. The physician pages cardiology and orders serial troponins. <strong>Total added work: one click.</strong></div>
                </div>
                <div className="tl-item">
                  <div className="tl-dot"></div>
                  <div className="tl-time">T+45 min — Outcome</div>
                  <div className="tl-outcome">Troponin peaked at 4.8. Cath revealed a 95% RCA occlusion. Door-to-balloon: 62 minutes. Discharged three days later with preserved ejection fraction — and a note that wrote itself.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHY NO ONE ELSE CAN */}
      <section className="moat" id="why-us">
        <div className="container reveal">
          <p className="section-label">Why no one else can do this</p>
          <h2>The four capabilities are easy to list.<br />They are nearly impossible to build together.</h2>
          <p className="moat-sub">
            Anyone can claim "AI for doctors." What they cannot copy is a system where each
            capability feeds the others — and where the most valuable part is built from
            your own practice, case by case.
          </p>
          <div className="moat-grid">
            <div className="moat-cell">
              <h4>The capabilities are one loop, not four features</h4>
              <p>Understanding feeds memory. Memory sharpens reasoning. Reasoning is captured into documentation — which becomes tomorrow's memory. Copy one piece and you have a feature. The loop is the product.</p>
            </div>
            <div className="moat-cell">
              <h4>The memory cannot be copied — it's yours</h4>
              <p>A competitor can imitate our interface in a quarter. They cannot imitate the twelve months of your cases, overrides, and patterns the system has already learned. The moat compounds daily, per physician.</p>
            </div>
            <div className="moat-cell">
              <h4>Consensus is an architecture, not a prompt</h4>
              <p>Specialist agents that reason independently and disagree before they agree — grounded in evidence, calibrated for uncertainty, safe by construction. This took years. It does not fit in a press release.</p>
            </div>
          </div>
          <div className="moat-quote">
            <p>"We didn't build a tool doctors would want to use. We built one they couldn't not use — because the alternative is practicing with less than everything available to you."</p>
          </div>
        </div>
      </section>

      {/* SAFETY */}
      <section className="section" id="safety">
        <div className="container-narrow reveal">
          <p className="section-label">Clinical safety</p>
          <h2 className="section-h2">Built for the stakes.</h2>
          <p className="section-sub">In medicine, "mostly right" is not a standard. These principles are designed into the architecture — they cannot be configured away.</p>
          <div>
            {[
              ["You decide. Always.", "Every recommendation requires your approval before anything touches a patient. The system provides intelligence, never authority."],
              ["Every answer shows its source", "Each recommendation links to the guideline, trial, or protocol behind it — and the patient data that triggered it. No black boxes."],
              ["Uncertainty is said out loud", "Calibrated confidence on every output. When the system isn't sure, it tells you — and flags itself for your review."],
              ["Silence over error", "If the system fails or can't be confident, it makes no recommendation rather than a wrong one. Your EHR keeps working either way."],
            ].map(([t, d], i) => (
              <div key={i} className="principle">
                <div className="principle-check">✓</div>
                <div><h4>{t}</h4><p>{d}</p></div>
              </div>
            ))}
          </div>
          <div className="sec-row">
            {[
              ["Tokenized by design", "Names and identifiers are replaced with codes before data ever enters our system. The model never sees a real name."],
              ["Zero retention", "Processed in temporary memory, deleted after your response. Patient data is never stored, never used to train models."],
              ["HIPAA & SOC 2", "HIPAA-compliant by architecture, SOC 2 Type II audited, BAAs with every subprocessor. End-to-end encryption throughout."],
              ["Everything audited", "Every recommendation, every action, every access — logged as metadata, never PHI. A full trail, always."],
            ].map(([t, d], i) => (
              <div key={i} className="sec-cell"><h4>{t}</h4><p>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="section alt" id="pricing">
        <div className="container reveal">
          <p className="section-label">Pricing</p>
          <h2 className="section-h2">For individual physicians. No committees required.</h2>
          <p className="section-sub">No enterprise sales cycle. No implementation fees. Pricing a physician can expense without asking the IT department for permission.</p>
          <div className="pricing-grid">
            {[
              { name: "Individual", price: "$0", sub: "/month", features: ["35 clinical cases per day", "Differential and decision support", "Standalone interface — no EHR required", "Community support"], cta: "Start free", featured: false },
              { name: "Clinical Pro", price: "$99", sub: "/month", features: ["Everything in Individual", "EHR integration (Epic · Cerner · athenahealth)", "Full multi-agent reasoning", "Documentation automation", "Your personal clinical memory", "Priority support"], cta: "Upgrade to Pro", featured: true },
              { name: "Department", price: "Custom", sub: "", features: ["Department-wide deployment", "Institutional protocol integration", "Quality analytics dashboard", "Agents trained on your protocols", "Dedicated success manager"], cta: "Talk to us", featured: false },
            ].map((p, i) => (
              <div key={i} className={`pricing-card${p.featured ? " featured" : ""}`}>
                <div className="pricing-name">{p.name}</div>
                <div className="pricing-price">{p.price}<span>{p.sub}</span></div>
                <ul className="pricing-features">{p.features.map((f, j) => <li key={j}>{f}</li>)}</ul>
                <a href="https://doctorassist.ai/login" className="pricing-cta">{p.cta}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-tagline">Clinical intelligence that compounds over time.</div>
        <a href="https://doctorassist.ai/login?ref=webpage" className="footer-cta">Launch clinical interface →</a>
        <div className="footer-links">
          {[
            ["#home", "Home"], ["#what-it-does", "What it does"], ["#proof", "Proof"],
            ["#why-us", "Why us"], ["#safety", "Safety & HIPAA"], ["#pricing", "Pricing"],
            ["https://doctorassist.ai/clinical-agent-skills", "Skills"],
            ["https://doctorassist.ai/ai-in-hospitals", "Hospitals"],
            ["https://doctorassist.ai/api-reference", "API Reference"],
            ["/ai-in-oncology", "Oncology"],
          ].map(([href, label], i) => <a key={i} href={href}>{label}</a>)}
        </div>
      </footer>
    </>
  );
}