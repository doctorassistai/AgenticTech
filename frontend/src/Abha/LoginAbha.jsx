import { useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const LOGIN_METHODS = [
  { id: "abha-aadhaar", label: "ABHA + Aadhaar OTP", tag: "Aadhaar" },
  { id: "abha-mobile", label: "ABHA + Mobile OTP", tag: "Mobile" },
  { id: "mobile", label: "Mobile OTP", tag: "Mobile" },
  { id: "aadhaar", label: "Aadhaar OTP", tag: "Aadhaar" },
  { id: "password", label: "ABHA Password", tag: "Password" },
];

export default function LoginAbha() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [method, setMethod] = useState("");
  const [loginId, setLoginId] = useState("");
  const [otp, setOtp] = useState("");
  const [txnId, setTxnId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedMethod = LOGIN_METHODS.find(m => m.id === method);

  const getIdLabel = () => {
    if (method === "mobile") return "Mobile number";
    if (method === "aadhaar") return "Aadhaar number";
    return "ABHA number";
  };

  const getIdPlaceholder = () => {
    if (method === "mobile") return "10-digit mobile number";
    if (method === "aadhaar") return "12-digit Aadhaar number";
    return "XX-XXXX-XXXX-XXXX";
  };

  /* ── Step 1: select method ── */
  const selectMethod = (m) => {
    setMethod(m);
    setLoginId(""); setOtp(""); setPassword(""); setError("");
    setStep(m === "password" ? 3 : 2);
  };

  const goBack = () => {
    setError("");
    if (step === 2) { setStep(1); setMethod(""); }
    if (step === 3 && method !== "password") setStep(2);
    if (step === 3 && method === "password") { setStep(1); setMethod(""); }
  };

  /* ── Step 2: request OTP ── */
  const requestOtp = async () => {
    if (!loginId) { setError("Please enter a valid value"); return; }
    setLoading(true); setError("");

    try {
      let res;
      // --- NEW: Separate logic for Mobile OTP ---
      if (method === "mobile" || method === "abha-mobile") {
        res = await fetch(`${API_BASE_URL}abha/auth/login/mobile/request-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The new strict schema only expects mobile_number!
          body: JSON.stringify({ mobile_number: loginId }),
        });
      }
      // --- NEW: Separate logic for Aadhaar OTP ---
      else if (method === "aadhaar" || method === "abha-aadhaar") {
        res = await fetch(`${API_BASE_URL}abha/auth/login/aadhaar/request-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The new strict schema only expects aadhaar_number!
          body: JSON.stringify({ aadhaar_number: loginId }),
        });
      }
      else {
        throw new Error("Invalid login method selected.");
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.detail || "OTP request failed");

      setTxnId(data.txnId);
      setStep(3);
    } catch (err) {
      setError(err.message || "Failed to request OTP");
    } finally {
      setLoading(false);
    }
  };


  /* ── Step 3a: verify OTP ── */
  const verifyOtp = async () => {
    if (!otp) { setError("Enter OTP"); return; }
    setLoading(true); setError("");

    try {
      let res;
      // --- NEW: Separate logic for Mobile OTP ---
      if (method === "mobile" || method === "abha-mobile") {
        res = await fetch(`${API_BASE_URL}abha/auth/login/mobile/verify-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The new strict schema handles scope automatically in backend
          body: JSON.stringify({ txnId, otp }),
        });
      }
      // --- NEW: Separate logic for Aadhaar OTP ---
      else if (method === "aadhaar" || method === "abha-aadhaar") {
        res = await fetch(`${API_BASE_URL}abha/auth/login/aadhaar/verify-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The new strict schema handles scope automatically in backend
          body: JSON.stringify({ txnId, otp }),
        });
      }
      else {
        throw new Error("Invalid login method selected.");
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.detail || "OTP verification failed");

      // Mobile login now returns X-token directly from our backend
      const tokenToStore = data["X-token"] || data.token;

      if (tokenToStore) localStorage.setItem("xToken", tokenToStore);
      if (data.txnId) localStorage.setItem("txnId", data.txnId);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);

      // Navigate to the profile page
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(err.message || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 3b: password login ── */
  const verifyPassword = async () => {
    if (!loginId || !password) { setError("Enter ABHA number and password"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/login/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abha_number: loginId, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Invalid ABHA or password");
      if (data.token) localStorage.setItem("xToken", data.token);
      if (data.txnId) localStorage.setItem("txnId", data.txnId);
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid ABHA or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        body { font-family: 'Open Sans', system-ui, sans-serif; font-weight: 300; background: #fff; color: #000; -webkit-font-smoothing: antialiased; }

        .login-layout { display: grid; grid-template-columns: 1.1fr 1fr; min-height: 100vh; }

        /* ── Left ── */
        .login-left { background: #000; color: #fff; padding: 4rem; display: flex; flex-direction: column; justify-content: center; }
        .left-brand { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; margin-bottom: 3rem; opacity: 0.5; }
        .left-heading { font-size: 2.2rem; font-weight: 300; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 0.75rem; }
        .left-sub { font-size: 0.82rem; opacity: 0.55; line-height: 1.8; max-width: 320px; }
        .left-divider { height: 1px; background: rgba(255,255,255,0.12); margin: 2.5rem 0; }
        .left-note { font-size: 0.72rem; opacity: 0.35; line-height: 1.8; max-width: 320px; }

        /* ── Right ── */
        .login-right { display: flex; align-items: center; justify-content: center; padding: 3rem 2.5rem; background: #fafafa; }
        .login-card { width: 100%; max-width: 400px; }

        /* ── Form elements ── */
        .form-eyebrow { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-bottom: 1rem; }
        .form-title { font-size: 1.4rem; font-weight: 300; letter-spacing: -0.02em; margin-bottom: 0.4rem; }
        .form-desc { font-size: 0.78rem; color: #444; margin-bottom: 2rem; line-height: 1.8; }

        /* ── Method list ── */
        .method-list { border: 1px solid #e0e0e0; }
        .method-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 1rem 1.25rem; background: #fff; border: none; border-bottom: 1px solid #e0e0e0; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.875rem; font-weight: 300; color: #000; cursor: pointer; text-align: left; transition: background 0.15s; }
        .method-btn:last-child { border-bottom: none; }
        .method-btn:hover { background: #fafafa; }
        .method-btn-right { display: flex; align-items: center; gap: 0.75rem; }
        .method-tag { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; border: 1px solid #e0e0e0; padding: 0.15rem 0.4rem; }
        .method-arrow { font-size: 0.75rem; color: #ccc; }

        /* ── Back + selected badge ── */
        .btn-back { background: transparent; border: none; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.72rem; color: #888; cursor: pointer; padding: 0; margin-bottom: 1.75rem; display: flex; align-items: center; gap: 0.35rem; transition: color 0.2s; }
        .btn-back:hover { color: #000; }
        .selected-badge { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 1.75rem; padding: 0.3rem 0.65rem; border: 1px solid #e0e0e0; }
        .badge-dot { width: 5px; height: 5px; background: #000; border-radius: 50%; }

        /* ── Fields ── */
        .field { margin-bottom: 1.25rem; }
        .field label { display: block; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.5rem; }
        .input { width: 100%; padding: 0.8rem; font-size: 0.875rem; font-family: 'Open Sans', system-ui, sans-serif; font-weight: 300; border: 1px solid #e0e0e0; background: #fff; outline: none; transition: border-color 0.2s; color: #000; }
        .input:focus { border-color: #000; }

        /* ── Buttons ── */
        .btn-primary { display: block; width: 100%; padding: 0.9rem; background: #000; color: #fff; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.875rem; font-weight: 400; border: 1px solid #000; cursor: pointer; transition: all 0.2s; margin-top: 0.25rem; }
        .btn-primary:hover:not(:disabled) { background: transparent; color: #000; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Error ── */
        .error { font-size: 0.75rem; color: #c00; margin-top: 1rem; padding: 0.65rem 0.875rem; border-left: 2px solid #c00; background: #fff8f8; line-height: 1.5; }

        /* ── Register link ── */
        .register-link { margin-top: 1.75rem; padding-top: 1.5rem; border-top: 1px solid #e0e0e0; font-size: 0.72rem; color: #888; display: flex; align-items: center; justify-content: space-between; }
        .register-link a { color: #000; text-decoration: none; font-weight: 400; }
        .register-link a:hover { text-decoration: underline; }

        @media (max-width: 900px) {
          .login-layout { grid-template-columns: 1fr; }
          .login-left { padding: 2.5rem; min-height: auto; }
          .left-heading { font-size: 1.75rem; }
          .login-right { padding: 2rem 1.5rem; }
        }
      `}</style>

      <div className="login-layout">
        {/* ── LEFT ── */}
        <div className="login-left">
          <div className="left-brand">Doctorassist.AI</div>
          <h1 className="left-heading">Access your ABHA account.</h1>
          <p className="left-sub">
            Verify your identity using Aadhaar OTP, mobile OTP, or your
            ABHA password.
          </p>
          <div className="left-divider" />
          <p className="left-note">
            Your health data is protected by ABDM's national security
            framework. We never store your credentials on our servers.
          </p>
        </div>

        {/* ── RIGHT ── */}
        <div className="login-right">
          <div className="login-card">

            {/* Step 1 — choose method */}
            {step === 1 && (
              <>
                <p className="form-eyebrow">Login</p>
                <h2 className="form-title">Choose login method.</h2>
                <p className="form-desc">
                  Select how you'd like to verify your identity.
                </p>
                <div className="method-list">
                  {LOGIN_METHODS.map(m => (
                    <button key={m.id} className="method-btn" onClick={() => selectMethod(m.id)}>
                      <span>{m.label}</span>
                      <span className="method-btn-right">
                        <span className="method-tag">{m.tag}</span>
                        <span className="method-arrow">→</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="register-link">
                  <span>Don't have an ABHA?</span>
                  <a href="/register-abha">Register →</a>
                </div>
              </>
            )}

            {/* Step 2 — enter ID */}
            {step === 2 && (
              <>
                <button className="btn-back" onClick={goBack}>← Back</button>
                <div className="selected-badge">
                  <span className="badge-dot" />
                  {selectedMethod?.label}
                </div>
                <p className="form-eyebrow">Step 1 of 2</p>
                <h2 className="form-title">Enter your details.</h2>
                <p className="form-desc">
                  We'll send a one-time password to verify your identity.
                </p>
                <div className="field">
                  <label>{getIdLabel()}</label>
                  <input
                    className="input"
                    placeholder={getIdPlaceholder()}
                    value={loginId}
                    inputMode="numeric"
                    onChange={e => setLoginId(e.target.value)}
                  />
                </div>
                <button onClick={requestOtp} disabled={loading} className="btn-primary">
                  {loading ? "Sending OTP..." : "Request OTP →"}
                </button>
                {error && <div className="error">{error}</div>}
              </>
            )}

            {/* Step 3a — verify OTP */}
            {step === 3 && method !== "password" && (
              <>
                <button className="btn-back" onClick={goBack}>← Back</button>
                <div className="selected-badge">
                  <span className="badge-dot" />
                  {selectedMethod?.label}
                </div>
                <p className="form-eyebrow">Step 2 of 2</p>
                <h2 className="form-title">Enter OTP.</h2>
                <p className="form-desc">
                  Enter the one-time password sent to your registered number.
                </p>
                <div className="field">
                  <label>One-time password</label>
                  <input
                    className="input"
                    placeholder="6-digit OTP"
                    value={otp}
                    maxLength={6}
                    inputMode="numeric"
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <button onClick={verifyOtp} disabled={loading} className="btn-primary">
                  {loading ? "Verifying..." : "Verify OTP →"}
                </button>
                {error && <div className="error">{error}</div>}
              </>
            )}

            {/* Step 3b — password */}
            {step === 3 && method === "password" && (
              <>
                <button className="btn-back" onClick={goBack}>← Back</button>
                <div className="selected-badge">
                  <span className="badge-dot" />
                  ABHA Password
                </div>
                <p className="form-eyebrow">Password login</p>
                <h2 className="form-title">Sign in.</h2>
                <p className="form-desc">
                  Enter your ABHA number and password to access your account.
                </p>
                <div className="field">
                  <label>ABHA number</label>
                  <input
                    className="input"
                    placeholder="XX-XXXX-XXXX-XXXX"
                    value={loginId}
                    onChange={e => setLoginId(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Your ABHA password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
                <button onClick={verifyPassword} disabled={loading} className="btn-primary">
                  {loading ? "Signing in..." : "Sign in →"}
                </button>
                {error && <div className="error">{error}</div>}
              </>
            )}

          </div>
        </div>
      </div>
    </>
  );
}