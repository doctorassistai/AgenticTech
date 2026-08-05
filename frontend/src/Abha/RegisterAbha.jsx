import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function RegisterAbha() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [aadhaarSegs, setAadhaarSegs] = useState(["", "", ""]);
  const [otp, setOtp] = useState("");
  const [mobile, setMobile] = useState("");
  const [abhaAddress, setAbhaAddress] = useState("");
  const [txnId, setTxnId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  const segRefs = [useRef(null), useRef(null), useRef(null)];

  // raw 12-digit string for API — segments are display only
  const aadhaarRaw = aadhaarSegs.join("");

  /* ── Aadhaar segment handlers ── */
  const handleSegInput = (i, val) => {
    const digits = val.replace(/\D/g, "").slice(0, 4);
    const next = [...aadhaarSegs];
    next[i] = digits;
    setAadhaarSegs(next);
    // auto-advance
    if (digits.length === 4 && i < 2) {
      segRefs[i + 1].current.focus();
      segRefs[i + 1].current.setSelectionRange(0, 0);
    }
  };

  const handleSegKeyDown = (i, e) => {
    if (e.key === "Backspace" && aadhaarSegs[i] === "" && i > 0) {
      e.preventDefault();
      segRefs[i - 1].current.focus();
      segRefs[i - 1].current.setSelectionRange(4, 4);
    }
  };

  const handleSegPaste = (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData)
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 12);
    setAadhaarSegs([
      pasted.slice(0, 4),
      pasted.slice(4, 8),
      pasted.slice(8, 12),
    ]);
    const filled = pasted.length;
    if (filled >= 12) segRefs[2].current.focus();
    else if (filled >= 8) segRefs[2].current.focus();
    else if (filled >= 4) segRefs[1].current.focus();
    else segRefs[0].current.focus();
  };

  /* ── Step 1: Request OTP ── */
  const handleRequestOtp = async () => {
    setError("");
    if (!/^\d{12}$/.test(aadhaarRaw)) {
      setError("Please enter a valid 12-digit Aadhaar number");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aadhaar_number: aadhaarRaw }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTxnId(data.txnId);
      setStep(2);
    } catch {
      setError("Unable to request OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 2: Verify OTP ── */
  const handleVerifyOtp = async () => {
    setError("");
    if (!/^\d{6}$/.test(otp)) { setError("Enter valid 6-digit OTP"); return; }
    if (!/^\d{10}$/.test(mobile)) { setError("Enter valid 10-digit mobile number"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/confirm-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId, otp, phone_number: mobile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "OTP verification failed");
      setTxnId(data.txnId);
      if (data.message?.toLowerCase().includes("already exist")) {
        if (data.tokens?.token) {
          localStorage.setItem("xToken", data.tokens.token);
          navigate("/profile", { replace: true });
          return;
        }
      }
      setStep(3);
    } catch (err) {
      setError(err.message || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 3: Fetch suggestions ── */
  useEffect(() => {
    if (step === 3 && txnId) {
      fetch(`${API_BASE_URL}abha/auth/address-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId }),
      })
        .then(r => r.json())
        .then(data => {                                                             //suggestions abdm adress
    // Check if ABDM sends it as abhaAddressList OR suggestions
    const addressList = data?.abhaAddressList || data?.suggestions;                       
    if (addressList) {
        setSuggestions(addressList); 
    }
})                                                                                  //finish

        .catch(() => {});
    }
  }, [step, txnId]);

  /* ── Step 3: Create ABHA ── */
  const handleCreateAbha = async () => {
    setError("");
    if (!abhaAddress.trim()) { setError("Please enter ABHA address"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/create-address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId, abha_address: abhaAddress }),
      });
      if (!res.ok) throw new Error();
      alert("ABHA created successfully");
      navigate("/profile", { replace: true });
    } catch {
      setError("Failed to create ABHA address");
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    { num: "01", label: "Aadhaar verification", sub: "Enter your 12-digit Aadhaar number" },
    { num: "02", label: "OTP confirmation", sub: "Verify via Aadhaar-linked mobile" },
    { num: "03", label: "ABHA address creation", sub: "Choose your unique health ID" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        body {
          font-family: 'Open Sans', system-ui, sans-serif;
          font-weight: 300;
          background: #fff;
          color: #000;
          -webkit-font-smoothing: antialiased;
        }

        .register-layout { display: grid; grid-template-columns: 1.1fr 1fr; min-height: 100vh; }

        /* ── Left panel ── */
        .register-left { background: #000; color: #fff; padding: 4rem; display: flex; flex-direction: column; justify-content: center; }
        .left-brand { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; margin-bottom: 3rem; opacity: 0.5; }
        .left-heading { font-size: 2.2rem; font-weight: 300; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 0.75rem; }
        .left-sub { font-size: 0.82rem; opacity: 0.55; line-height: 1.8; margin-bottom: 3rem; max-width: 340px; }
        .step-list { list-style: none; border-top: 1px solid rgba(255,255,255,0.12); }
        .step-item { display: flex; align-items: center; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid rgba(255,255,255,0.1); opacity: 0.35; transition: opacity 0.2s; }
        .step-item.active { opacity: 1; }
        .step-num { width: 26px; height: 26px; border: 1px solid rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-size: 0.65rem; flex-shrink: 0; }
        .step-item.active .step-num { background: #fff; color: #000; border-color: #fff; }
        .step-label { font-size: 0.8rem; }
        .step-sublabel { font-size: 0.68rem; opacity: 0.55; margin-top: 2px; }

        /* ── Right panel ── */
        .register-right { display: flex; align-items: center; justify-content: center; padding: 3rem 2.5rem; background: #fafafa; }
        .register-card { width: 100%; max-width: 400px; }

        /* ── Step tabs ── */
        .step-tabs { display: flex; border: 1px solid #e0e0e0; margin-bottom: 2.5rem; }
        .step-tab { flex: 1; padding: 0.55rem 0.25rem; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; background: #fafafa; color: #888; border-right: 1px solid #e0e0e0; font-family: inherit; }
        .step-tab:last-child { border-right: none; }
        .step-tab.active { background: #000; color: #fff; }

        /* ── Form elements ── */
        .form-eyebrow { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-bottom: 1rem; }
        .form-title { font-size: 1.4rem; font-weight: 300; letter-spacing: -0.02em; margin-bottom: 0.4rem; }
        .form-desc { font-size: 0.78rem; color: #444; margin-bottom: 2rem; line-height: 1.8; }

        .field { margin-bottom: 1.25rem; }
        .field label { display: block; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.5rem; }

        /* ── Aadhaar segmented input ── */
        .aadhaar-wrap { display: flex; border: 1px solid #e0e0e0; background: #fff; transition: border-color 0.2s; }
        .aadhaar-wrap:focus-within { border-color: #000; }
        .aadhaar-seg {
          flex: 1; border: none; outline: none;
          font-family: 'Open Sans', system-ui, sans-serif;
          font-size: 1.1rem; font-weight: 400;
          letter-spacing: 0.25em; text-align: center;
          padding: 0.9rem 0; background: transparent;
          color: #000; caret-color: #000; min-width: 0;
        }
        .aadhaar-seg::placeholder { color: #ccc; letter-spacing: 0.15em; }
        .aadhaar-sep { display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 0.85rem; padding: 0 2px; flex-shrink: 0; user-select: none; }

        /* ── Regular input ── */
        .input { width: 100%; padding: 0.8rem; font-size: 0.875rem; font-family: 'Open Sans', system-ui, sans-serif; font-weight: 300; border: 1px solid #e0e0e0; background: #fff; outline: none; transition: border-color 0.2s; color: #000; }
        .input:focus { border-color: #000; }

        /* ── Buttons ── */
        .btn-primary { display: block; width: 100%; padding: 0.9rem; background: #000; color: #fff; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.875rem; font-weight: 400; border: 1px solid #000; cursor: pointer; transition: all 0.2s; margin-top: 0.5rem; }
        .btn-primary:hover:not(:disabled) { background: transparent; color: #000; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-suggestion { display: block; width: 100%; padding: 0.75rem 1rem; background: #fff; color: #000; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.8rem; font-weight: 300; border: 1px solid #e0e0e0; cursor: pointer; transition: all 0.15s; margin-bottom: 0.5rem; text-align: left; }
        .btn-suggestion:hover { border-color: #000; }
        .btn-suggestion.selected { border-color: #000; border-left-width: 3px; padding-left: calc(1rem - 2px); }

        .error { font-size: 0.75rem; color: #c00; margin-top: 1rem; padding: 0.65rem 0.875rem; border-left: 2px solid #c00; background: #fff8f8; line-height: 1.5; }
        .privacy-note { margin-top: 1.75rem; padding-top: 1.5rem; border-top: 1px solid #e0e0e0; font-size: 0.72rem; color: #888; line-height: 1.7; }

        @media (max-width: 900px) {
          .register-layout { grid-template-columns: 1fr; }
          .register-left { padding: 2.5rem; min-height: auto; }
          .left-heading { font-size: 1.75rem; }
          .register-right { padding: 2rem 1.5rem; }
        }
      `}</style>

      <div className="register-layout">
        {/* ── LEFT ── */}
        <div className="register-left">
          <div className="left-brand">Doctorassist.AI</div>
          <h1 className="left-heading">Create your ABHA identity.</h1>
          <p className="left-sub">
            Secure registration via Aadhaar OTP verification. Linked to
            the national ABDM infrastructure.
          </p>
          <ul className="step-list">
            {steps.map((s, i) => (
              <li key={i} className={`step-item ${step >= i + 1 ? "active" : ""}`}>
                <div className="step-num">{s.num}</div>
                <div>
                  <div className="step-label">{s.label}</div>
                  <div className="step-sublabel">{s.sub}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ── RIGHT ── */}
        <div className="register-right">
          <div className="register-card">

            {/* Step tabs */}
            <div className="step-tabs">
              {["01 — Aadhaar", "02 — OTP", "03 — Address"].map((t, i) => (
                <div key={i} className={`step-tab ${step === i + 1 ? "active" : ""}`}>{t}</div>
              ))}
            </div>

            {/* ── Step 1 ── */}
            {step === 1 && (
              <>
                <p className="form-eyebrow">Step 1 of 3</p>
                <h2 className="form-title">Aadhaar verification</h2>
                <p className="form-desc">
                  Enter your 12-digit Aadhaar number to receive a one-time
                  password on your registered mobile.
                </p>

                <div className="field">
                  <label>Aadhaar number</label>
                  <div className="aadhaar-wrap">
                    {[0, 1, 2].map((i) => (
                      <>
                        <input
                          key={i}
                          ref={segRefs[i]}
                          className="aadhaar-seg"
                          maxLength={4}
                          placeholder="XXXX"
                          inputMode="numeric"
                          autoComplete="off"
                          value={aadhaarSegs[i]}
                          onChange={e => handleSegInput(i, e.target.value)}
                          onKeyDown={e => handleSegKeyDown(i, e)}
                          onPaste={i === 0 ? handleSegPaste : undefined}
                        />
                        {i < 2 && <span className="aadhaar-sep">—</span>}
                      </>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleRequestOtp}
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? "Sending OTP..." : "Request OTP →"}
                </button>
                <p className="privacy-note">
                  Your Aadhaar data is used solely for OTP-based identity
                  verification and is never stored on our servers.
                </p>
              </>
            )}

            {/* ── Step 2 ── */}
            {step === 2 && (
              <>
                <p className="form-eyebrow">Step 2 of 3</p>
                <h2 className="form-title">OTP confirmation</h2>
                <p className="form-desc">
                  Enter the OTP sent to your Aadhaar-linked mobile, along
                  with the mobile number you'd like to associate.
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
                <div className="field">
                  <label>Mobile number</label>
                  <input
                    className="input"
                    placeholder="10-digit mobile number"
                    value={mobile}
                    maxLength={10}
                    inputMode="numeric"
                    onChange={e => setMobile(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <button
                  onClick={handleVerifyOtp}
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? "Verifying..." : "Verify OTP →"}
                </button>
              </>
            )}

            {/* ── Step 3 ── */}
            {step === 3 && (
              <>
                <p className="form-eyebrow">Step 3 of 3</p>
                <h2 className="form-title">Choose ABHA address</h2>
                <p className="form-desc">
                  Select a suggested address or enter a custom one. This
                  becomes your permanent health identity.
                </p>

                {suggestions.length > 0 ? (
                  <>
                    <div className="field">
                      <label>Suggested addresses</label>
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          className={`btn-suggestion ${abhaAddress === s ? "selected" : ""}`}
                          onClick={() => setAbhaAddress(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <div className="field">
                      <label>Or enter custom address</label>
                      <input
                        className="input"
                        placeholder="yourname@abha"
                        value={abhaAddress}
                        onChange={e => setAbhaAddress(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="field">
                    <label>ABHA address</label>
                    <input
                      className="input"
                      placeholder="yourname@abha"
                      value={abhaAddress}
                      onChange={e => setAbhaAddress(e.target.value)}
                    />
                  </div>
                )}

                <button
                  onClick={handleCreateAbha}
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? "Creating..." : "Create ABHA →"}
                </button>
              </>
            )}

            {error && <div className="error">{error}</div>}
          </div>
        </div>
      </div>
    </>
  );
}

export default RegisterAbha;