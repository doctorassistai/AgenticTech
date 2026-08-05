import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// ── Analytics: defer until after first render ──────────────────
function initEngagementTracking() {
  let lastActive = Date.now();

  // Passive listeners — don't block scroll/touch
  ["mousemove", "scroll", "keydown", "click", "touchstart"].forEach(e => {
    window.addEventListener(e, () => {
      lastActive = Date.now();
    }, { passive: true }); // ← key fix
  });

  setInterval(() => {
    if (Date.now() - lastActive < 30000) {
      gtag("event", "user_engagement", {
        engagement_time_msec: 10000
      });
    }
  }, 10000);
}

// ── Mount React first, analytics after ─────────────────────────
const root = createRoot(document.getElementById('root'));

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

// Run after paint — doesn't compete with initial render
requestIdleCallback
  ? requestIdleCallback(initEngagementTracking)
  : setTimeout(initEngagementTracking, 2000);