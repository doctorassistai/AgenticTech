import { useNavigate } from "react-router-dom";

export default function AbhaHome() {
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        body {
          font-family: 'Open Sans', system-ui, sans-serif;
          font-weight: 300;
          background: #ffffff;
          color: #000000;
          -webkit-font-smoothing: antialiased;
        }

        :root {
          --bg: #ffffff;
          --bg-alt: #fafafa;
          --text: #000000;
          --text-secondary: #444444;
          --text-muted: #888888;
          --border: #e0e0e0;
          --accent: #000000;
        }

        .site { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }

        /* Nav */
        .site-nav {
          padding: 1rem 2rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border);
          background: var(--bg);
        }
        .nav-logo { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; color: var(--text); text-decoration: none; }
        .nav-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 300; }

        /* Main */
        .site-main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 5rem 2rem; }
        .card { width: 100%; max-width: 480px; }

        /* Typography */
        .eyebrow { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.2em; color: var(--text-muted); margin-bottom: 1.5rem; font-weight: 400; }
        .card-title { font-size: 2.2rem; font-weight: 300; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 0.75rem; }
        .card-subtitle { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 2.5rem; line-height: 1.8; }

        /* Buttons */
        .btn {
          display: block; width: 100%;
          padding: 1rem 1.5rem;
          font-family: 'Open Sans', system-ui, sans-serif;
          font-size: 0.9rem; font-weight: 400;
          cursor: pointer; text-align: center; text-decoration: none;
          transition: all 0.2s; border: 1px solid;
        }
        .btn + .btn { margin-top: 0.75rem; }
        .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .btn-primary:hover { background: transparent; color: var(--text); }
        .btn-secondary { background: transparent; color: var(--text); border-color: var(--border); }
        .btn-secondary:hover { border-color: var(--accent); }

        /* Divider */
        .divider { height: 1px; background: var(--border); margin: 2rem 0; }

        /* Feature grid */
        .features { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--border); margin-top: 2.5rem; }
        .feature { padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .feature:nth-child(2n) { border-right: none; }
        .feature:nth-child(3), .feature:nth-child(4) { border-bottom: none; }
        .feature-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-bottom: 0.35rem; }
        .feature-text { font-size: 0.75rem; color: var(--text); line-height: 1.5; }

        /* Footer */
        .site-footer { text-align: center; padding: 1.5rem; border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--text-muted); font-weight: 300; }
      `}</style>

      <div className="site">
        <nav className="site-nav">
          <span className="nav-logo">Doctorassist.AI</span>
          <span className="nav-label">ABHA Management</span>
        </nav>

        <main className="site-main">
          <div className="card">
            <p className="eyebrow">ABDM Integration</p>
            <h1 className="card-title">Manage your ABHA identity.</h1>
            <p className="card-subtitle">
              Create and access your Ayushman Bharat Health Account securely —
              the foundation of your digital health records.
            </p>

            <button onClick={() => navigate("/register-abha")} className="btn btn-primary">
              Register ABHA →
            </button>
            <button onClick={() => navigate("/login-abha")} className="btn btn-secondary">
              Login with ABHA
            </button>

            <div className="divider" />

            <div className="features">
              <div className="feature">
                <div className="feature-label">Secure</div>
                <div className="feature-text">End-to-end encrypted identity verification</div>
              </div>
              <div className="feature">
                <div className="feature-label">Integrated</div>
                <div className="feature-text">Connected to national ABDM infrastructure</div>
              </div>
              <div className="feature">
                <div className="feature-label">Instant</div>
                <div className="feature-text">OTP-based verification in under 60 seconds</div>
              </div>
              <div className="feature">
                <div className="feature-label">Unified</div>
                <div className="feature-text">One ID across all your health records</div>
              </div>
            </div>
          </div>
        </main>

        <footer className="site-footer">
          © {new Date().getFullYear()} Doctorassist.AI
        </footer>
      </div>
    </>
  );
}