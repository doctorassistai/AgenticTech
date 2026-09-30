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

// Each method has its OWN dedicated backend route now — "mobile" only ever
// takes a real mobile number, "abha-mobile" only ever takes an ABHA number.
const OTP_CONFIG = {
  "mobile":       { path: "mobile",       field: "mobile_number",  len: 10, label: "10-digit mobile number" },
  "abha-mobile":  { path: "abha-mobile",  field: "abha_number",    len: 14, label: "14-digit ABHA number" },
  "aadhaar":      { path: "aadhaar",      field: "aadhaar_number", len: 12, label: "12-digit Aadhaar number" },
  "abha-aadhaar": { path: "abha-aadhaar", field: "abha_number",    len: 14, label: "14-digit ABHA number" },
};

// FastAPI 422 errors come back as detail: [{msg, loc}, ...] — flatten to a readable string
const readError = (data, fallback) => {
  if (!data) return fallback;
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map(d => d.msg).join(", ");
  return data.message || fallback;
};

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

  // ── Set Password (initial / forgot password) ──
  const [mode, setMode] = useState("login"); // "login" | "set-password" | "find-abha" | "find-abha"
  const [spStep, setSpStep] = useState("abha"); // "abha" | "channel" | "otp" | "password" | "done"
  const [spAbhaNumber, setSpAbhaNumber] = useState("");
  const [spChannel, setSpChannel] = useState(""); // "aadhaar" | "mobile"
  const [spTxnId, setSpTxnId] = useState("");
  const [spOtp, setSpOtp] = useState("");
  const [spNewPassword, setSpNewPassword] = useState("");
  const [spConfirmPassword, setSpConfirmPassword] = useState("");
  const [spXToken, setSpXToken] = useState(""); // session token from the OTP verify, used to set the password
  const [spPwTxnId, setSpPwTxnId] = useState(""); // txnId from the password-set OTP request
  const [spConfirmOtp, setSpConfirmOtp] = useState(""); // OTP that actually applies the new password
  const [spLoading, setSpLoading] = useState(false);
  const [spError, setSpError] = useState("");

  // ── Find ABHA (forgot ABHA number) ──
  const [faStep, setFaStep] = useState("mobile"); // "mobile" | "accounts" | "otp"
  const [faMobile, setFaMobile] = useState("");
  const [faAccounts, setFaAccounts] = useState([]);
  const [faTxnId, setFaTxnId] = useState("");
  const [faOtp, setFaOtp] = useState("");
  const [faLoading, setFaLoading] = useState(false);
  const [faError, setFaError] = useState("");

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
    const cfg = OTP_CONFIG[method];
    if (!cfg) { setError("Invalid login method selected."); return; }

    const cleanId = loginId.replace(/\D/g, "");
    if (cleanId.length !== cfg.len) { setError(`Please enter a valid ${cfg.label}`); return; }

    setLoading(true); setError("");

    try {
      // ABHA-number-based methods: confirm the account exists first, so a
      // typo or unknown number surfaces a clear message instead of a
      // generic OTP-request failure.
      if (cfg.field === "abha_number") {
        const searchRes = await fetch(`${API_BASE_URL}abha/auth/login/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ abha_number: cleanId }),
        });
        const searchData = await searchRes.json();
        if (!searchRes.ok) throw new Error(readError(searchData, "ABHA number not found"));
        if (searchData.status && searchData.status !== "ACTIVE") {
          throw new Error(`This ABHA account is ${String(searchData.status).toLowerCase()} — contact ABDM support.`);
        }
      }

      const res = await fetch(`${API_BASE_URL}abha/auth/login/${cfg.path}/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [cfg.field]: cleanId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "OTP request failed"));
      if (!data.txnId) throw new Error("No transaction ID returned by ABDM");

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
    const cfg = OTP_CONFIG[method];
    if (!cfg) { setError("Invalid login method selected."); return; }
    if (!otp) { setError("Enter OTP"); return; }

    setLoading(true); setError("");

    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/login/${cfg.path}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId, otp }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "OTP verification failed"));

      // Mobile login returns "X-token"; Aadhaar login returns "token"
      const tokenToStore = data["X-token"] || data.token;
      if (!tokenToStore) throw new Error("No session token returned — OTP may have expired");

      localStorage.setItem("xToken", tokenToStore);
      if (data.txnId) localStorage.setItem("txnId", data.txnId);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      if (data.expiresIn) {
        localStorage.setItem("tokenIssuedAt", Date.now().toString());
        localStorage.setItem("tokenExpiresIn", data.expiresIn.toString());
      }

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
    if (!loginId || !password.trim()) { setError("Enter ABHA number and password"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/login/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abha_number: loginId.replace(/\D/g, ""), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "Invalid ABHA or password"));
      const pwToken = data["X-token"] || data.token;
      if (pwToken) localStorage.setItem("xToken", pwToken);
      if (data.txnId) localStorage.setItem("txnId", data.txnId);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      if (data.expiresIn) {
        localStorage.setItem("tokenIssuedAt", Date.now().toString());
        localStorage.setItem("tokenExpiresIn", data.expiresIn.toString());
      }
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid ABHA or password");
    } finally {
      setLoading(false);
    }
  };

  /* ── Forgot / Set password flow ── */
  const resetSetPasswordForm = () => {
    setSpStep("abha");
    setSpAbhaNumber(""); setSpChannel(""); setSpTxnId(""); setSpOtp("");
    setSpNewPassword(""); setSpConfirmPassword(""); setSpXToken("");
    setSpPwTxnId(""); setSpConfirmOtp(""); setSpError("");
  };

  const enterSetPasswordMode = () => { resetSetPasswordForm(); setMode("set-password"); };
  const exitSetPasswordMode = () => { setMode("login"); resetSetPasswordForm(); };

  /* ── Find ABHA (forgot ABHA number) ── */
  const resetFindAbhaForm = () => {
    setFaStep("mobile");
    setFaMobile(""); setFaAccounts([]); setFaTxnId(""); setFaOtp(""); setFaError("");
  };
  const enterFindAbhaMode = () => { resetFindAbhaForm(); setMode("find-abha"); };
  const exitFindAbhaMode = () => { setMode("login"); resetFindAbhaForm(); };

  const faSearch = async () => {
    const cleanMobile = faMobile.replace(/\D/g, "");
    if (cleanMobile.length !== 10) { setFaError("Enter a valid 10-digit mobile number"); return; }
    setFaLoading(true); setFaError("");
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/find-abha/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile_number: cleanMobile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "No ABHA accounts found for this mobile number"));
      // ABDM's raw response nests the list under "ABHA" — fall back to a
      // couple of likely alternates in case your service.py reshapes it.
      // Backend normalises to { txnId, accounts: [{ABHANumber, name, ...}] }.
      const accounts = data.accounts || data.ABHA || data.abhaAccounts || [];
      if (!accounts.length) throw new Error("No ABHA accounts found for this mobile number");
      if (!data.txnId) {
        // ABDM's bare-array search response carries no txnId, and the
        // request-otp step needs one. Fail here with something actionable
        // rather than letting the next call 400 with a generic message.
        throw new Error("ABDM did not return a transaction ID for this search — try again in a moment.");
      }
      setFaAccounts(accounts);
      setFaTxnId(data.txnId);
      setFaStep("accounts");
    } catch (err) {
      setFaError(err.message || "Search failed");
    } finally {
      setFaLoading(false);
    }
  };

  const faRequestOtp = async (index) => {
    setFaLoading(true); setFaError("");
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/find-abha/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId: faTxnId, index }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "Failed to send OTP"));
      if (data.txnId) setFaTxnId(data.txnId);
      setFaStep("otp");
    } catch (err) {
      setFaError(err.message || "Failed to send OTP");
    } finally {
      setFaLoading(false);
    }
  };

  const faVerifyOtp = async () => {
    if (!faOtp.trim()) { setFaError("Enter the OTP"); return; }
    setFaLoading(true); setFaError("");
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/find-abha/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId: faTxnId, otp: faOtp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "OTP verification failed"));
      const tokenToStore = data["X-token"] || data.token;
      if (!tokenToStore) throw new Error("No session token returned — OTP may have expired");
      localStorage.setItem("xToken", tokenToStore);
      if (faTxnId) localStorage.setItem("txnId", faTxnId);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      localStorage.setItem("tokenIssuedAt", Date.now().toString());
      localStorage.setItem("tokenExpiresIn", String(data.expiresIn || 1800));
      navigate("/profile", { replace: true });
    } catch (err) {
      setFaError(err.message || "OTP verification failed");
    } finally {
      setFaLoading(false);
    }
  };

  const spSubmitAbha = () => {
    setSpError("");
    if (!spAbhaNumber.trim()) { setSpError("Enter your ABHA number"); return; }
    setSpStep("channel");
  };

  const spChooseChannel = (channel) => { setSpChannel(channel); setSpError(""); };

  // Reuses your existing, already-working login-OTP routes: sending an OTP
  // to prove identity is the same call whether you're about to log in or
  // about to change your password — ABDM doesn't have a separate endpoint
  // for it. "aadhaar" channel -> abha-aadhaar route, "mobile" -> abha-mobile.
  const spRequestOtp = async () => {
    if (!spChannel) { setSpError("Choose an OTP channel"); return; }
    const cleanAbha = spAbhaNumber.replace(/\D/g, "");
    if (cleanAbha.length !== 14) { setSpError("Enter a valid 14-digit ABHA number"); return; }

    const path = spChannel === "aadhaar" ? "abha-aadhaar" : "abha-mobile";
    setSpLoading(true); setSpError("");
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/login/${path}/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abha_number: cleanAbha }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "Failed to send OTP"));
      if (!data.txnId) throw new Error("No transaction ID returned by ABDM");
      setSpTxnId(data.txnId);
      setSpStep("otp");
    } catch (err) {
      setSpError(err.message || "Failed to send OTP");
    } finally {
      setSpLoading(false);
    }
  };

  // Verifies the OTP against the same route that requested it. This is where
  // we actually get the session token — the old version skipped this and
  // just trusted the OTP was right without checking, which meant a wrong OTP
  // silently let you through to "choose a new password".
  const spVerifyOtpAndGoToPassword = async () => {
    setSpError("");
    if (!spOtp.trim()) { setSpError("Enter the OTP"); return; }

    const path = spChannel === "aadhaar" ? "abha-aadhaar" : "abha-mobile";
    setSpLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}abha/auth/login/${path}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId: spTxnId, otp: spOtp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "OTP verification failed"));
      if (!data["X-token"]) throw new Error("No session token returned — OTP may have expired");
      setSpXToken(data["X-token"]);
      setSpStep("password");
    } catch (err) {
      setSpError(err.message || "OTP verification failed");
    } finally {
      setSpLoading(false);
    }
  };

  // Step 4a: request the dedicated password-set OTP. ABDM ties this OTP
  // to the new password itself, so it must be requested AFTER the user
  // types it, and via the profile endpoint — not /auth/set-password.
  const ABHA_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,20}$/;

  const spConfirmSetPassword = async () => {
    setSpError("");
    if (!spNewPassword.trim()) { setSpError("Enter a new password"); return; }
    if (!ABHA_PASSWORD_RE.test(spNewPassword.trim())) {
      setSpError("Password must be 8–20 characters with at least one uppercase letter, one lowercase letter, one number, and one special character.");
      return;
    }
    if (spNewPassword !== spConfirmPassword) { setSpError("Passwords do not match"); return; }
    if (!spXToken) { setSpError("Session expired — please verify OTP again"); setSpStep("otp"); return; }

    setSpLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}abha/profile/password/set/request-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Token": `Bearer ${spXToken}`,
        },
        body: JSON.stringify({
          new_password: spNewPassword.trim(),
          otp_system: spChannel === "aadhaar" ? "aadhaar" : "abdm",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "Failed to send confirmation OTP"));
      if (!data.txnId) throw new Error("ABDM did not return a transaction ID for this request");
      setSpPwTxnId(data.txnId);
      setSpStep("confirm-otp");
    } catch (err) {
      setSpError(err.message || "Failed to send confirmation OTP");
    } finally {
      setSpLoading(false);
    }
  };

  // Step 4b: verifying THIS OTP is what actually applies the new password.
  const spVerifyFinalOtp = async () => {
    setSpError("");
    if (!spConfirmOtp.trim()) { setSpError("Enter the OTP"); return; }
    if (!spXToken) { setSpError("Session expired — please verify OTP again"); setSpStep("otp"); return; }

    setSpLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}abha/profile/password/set/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Token": `Bearer ${spXToken}`,
        },
        body: JSON.stringify({ txnId: spPwTxnId, otp: spConfirmOtp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, "Failed to set password"));
      setSpStep("done");
    } catch (err) {
      setSpError(err.message || "Failed to set password");
    } finally {
      setSpLoading(false);
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
          <h1 className="left-heading">
            {mode === "set-password" ? "Set your ABHA password." : "Access your ABHA account."}
          </h1>
          <p className="left-sub">
            {mode === "set-password"
              ? "Verify your identity with an OTP, then choose a new ABHA password."
              : "Verify your identity using Aadhaar OTP, mobile OTP, or your ABHA password."}
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

            {mode === "find-abha" ? (
              <>
                {faStep !== "done" && (
                  <button
                    className="btn-back"
                    onClick={() => {
                      setFaError("");
                      if (faStep === "mobile") return exitFindAbhaMode();
                      if (faStep === "accounts") return setFaStep("mobile");
                      setFaOtp("");
                      setFaStep("accounts");
                    }}
                  >
                    ← Back
                  </button>
                )}

                {faStep === "mobile" && (
                  <>
                    <p className="form-eyebrow">Find ABHA</p>
                    <h2 className="form-title">Enter your mobile number.</h2>
                    <p className="form-desc">We'll look up any ABHA accounts linked to this number.</p>
                    <div className="field">
                      <label>Mobile number</label>
                      <input className="input" placeholder="10-digit mobile number" value={faMobile} maxLength={10} inputMode="numeric" onChange={e => setFaMobile(e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <button onClick={faSearch} disabled={faLoading} className="btn-primary">
                      {faLoading ? "Searching..." : "Search →"}
                    </button>
                    {faError && <div className="error">{faError}</div>}
                  </>
                )}

                {faStep === "accounts" && (
                  <>
                    <p className="form-eyebrow">Find ABHA</p>
                    <h2 className="form-title">Choose your account.</h2>
                    <p className="form-desc">
                      Found {faAccounts.length} account{faAccounts.length !== 1 ? "s" : ""} linked to this number.
                    </p>
                    <div className="method-list">
                      {faAccounts.map((acc, i) => (
                        <button key={acc.ABHANumber || i} className="method-btn" onClick={() => faRequestOtp(i + 1)} disabled={faLoading}>
                          <span>
                            {acc.name || `Account ${i + 1}`}
                            {acc.status && acc.status !== "ACTIVE" && (
                              <span style={{ color: "#c00", fontSize: "0.68rem", marginLeft: "0.5rem" }}>
                                {String(acc.status).toLowerCase()}
                              </span>
                            )}
                          </span>
                          <span className="method-btn-right">
                            <span className="method-tag">{acc.ABHANumber || acc.preferredAbhaAddress || "—"}</span>
                            <span className="method-arrow">→</span>
                          </span>
                        </button>
                      ))}
                    </div>
                    {faError && <div className="error">{faError}</div>}
                  </>
                )}

                {faStep === "otp" && (
                  <>
                    <p className="form-eyebrow">Find ABHA</p>
                    <h2 className="form-title">Enter OTP.</h2>
                    <p className="form-desc">Enter the one-time password sent to your registered number.</p>
                    <div className="field">
                      <label>One-time password</label>
                      <input className="input" placeholder="6-digit OTP" value={faOtp} maxLength={6} inputMode="numeric" onChange={e => setFaOtp(e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <button onClick={faVerifyOtp} disabled={faLoading} className="btn-primary">
                      {faLoading ? "Verifying..." : "Verify OTP →"}
                    </button>
                    {faError && <div className="error">{faError}</div>}
                  </>
                )}
              </>
            ) : mode === "set-password" ? (
              <>
                {spStep !== "done" && (
                  <button
                    className="btn-back"
                    onClick={() => {
                      setSpError("");
                      if (spStep === "abha") return exitSetPasswordMode();
                      if (spStep === "channel") return setSpStep("abha");
                      if (spStep === "otp") return setSpStep("channel");
                      if (spStep === "password") return setSpStep("otp");
                      if (spStep === "confirm-otp") return setSpStep("password");
                    }}
                  >← Back</button>
                )}

                {spStep === "abha" && (
                  <>
                    <p className="form-eyebrow">Set password</p>
                    <h2 className="form-title">Confirm your ABHA number.</h2>
                    <p className="form-desc">We'll verify your identity with an OTP before letting you set a new password.</p>
                    <div className="field">
                      <label>ABHA number</label>
                      <input className="input" placeholder="XX-XXXX-XXXX-XXXX" value={spAbhaNumber} onChange={e => setSpAbhaNumber(e.target.value)} />
                    </div>
                    <button onClick={spSubmitAbha} className="btn-primary">Continue →</button>
                    {spError && <div className="error">{spError}</div>}
                  </>
                )}

                {spStep === "channel" && (
                  <>
                    <p className="form-eyebrow">Set password</p>
                    <h2 className="form-title">Choose OTP channel.</h2>
                    <p className="form-desc">Where should we send the verification OTP?</p>
                    <div className="method-list">
                      <button className="method-btn" onClick={() => spChooseChannel("aadhaar")}>
                        <span>Aadhaar-linked mobile</span>
                        <span className="method-btn-right">
                          {spChannel === "aadhaar" && <span className="badge-dot" />}
                          <span className="method-arrow">→</span>
                        </span>
                      </button>
                      <button className="method-btn" onClick={() => spChooseChannel("mobile")}>
                        <span>ABDM-registered mobile</span>
                        <span className="method-btn-right">
                          {spChannel === "mobile" && <span className="badge-dot" />}
                          <span className="method-arrow">→</span>
                        </span>
                      </button>
                    </div>
                    <button onClick={spRequestOtp} disabled={spLoading || !spChannel} className="btn-primary" style={{ marginTop: "1rem" }}>
                      {spLoading ? "Sending OTP..." : "Send OTP →"}
                    </button>
                    {spError && <div className="error">{spError}</div>}
                  </>
                )}

                {spStep === "otp" && (
                  <>
                    <p className="form-eyebrow">Set password</p>
                    <h2 className="form-title">Enter OTP.</h2>
                    <p className="form-desc">Enter the one-time password sent to your {spChannel === "aadhaar" ? "Aadhaar-linked" : "ABDM-registered"} mobile.</p>
                    <div className="field">
                      <label>One-time password</label>
                      <input className="input" placeholder="6-digit OTP" value={spOtp} maxLength={6} inputMode="numeric" onChange={e => setSpOtp(e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <button onClick={spVerifyOtpAndGoToPassword} className="btn-primary">Continue →</button>
                    {spError && <div className="error">{spError}</div>}
                  </>
                )}

                {spStep === "password" && (
                  <>
                    <p className="form-eyebrow">Set password</p>
                    <h2 className="form-title">Choose a new password.</h2>
                    <p className="form-desc">This will be your password for future ABHA logins.</p>
                    <div className="field">
                      <label>New password</label>
                      <input className="input" type="password" placeholder="New ABHA password" value={spNewPassword} onChange={e => setSpNewPassword(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Confirm password</label>
                      <input className="input" type="password" placeholder="Re-enter new password" value={spConfirmPassword} onChange={e => setSpConfirmPassword(e.target.value)} />
                    </div>
                    <button onClick={spConfirmSetPassword} disabled={spLoading} className="btn-primary">
                      {spLoading ? "Sending OTP..." : "Continue →"}
                    </button>
                    {spError && <div className="error">{spError}</div>}
                  </>
                )}

                {spStep === "confirm-otp" && (
                  <>
                    <p className="form-eyebrow">Set password</p>
                    <h2 className="form-title">Confirm with OTP.</h2>
                    <p className="form-desc">Enter the OTP sent to your {spChannel === "aadhaar" ? "Aadhaar-linked" : "ABDM-registered"} mobile to apply the new password.</p>
                    <div className="field">
                      <label>One-time password</label>
                      <input className="input" placeholder="6-digit OTP" value={spConfirmOtp} maxLength={6} inputMode="numeric" onChange={e => setSpConfirmOtp(e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <button onClick={spVerifyFinalOtp} disabled={spLoading} className="btn-primary">
                      {spLoading ? "Saving..." : "Set password →"}
                    </button>
                    {spError && <div className="error">{spError}</div>}
                  </>
                )}

                {spStep === "done" && (
                  <>
                    <p className="form-eyebrow">Set password</p>
                    <h2 className="form-title">Password set.</h2>
                    <p className="form-desc">You can now sign in using your ABHA number and password.</p>
                    <button onClick={exitSetPasswordMode} className="btn-primary">Back to login →</button>
                  </>
                )}
              </>
            ) : (
            <>

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
                <button
                  type="button"
                  onClick={enterSetPasswordMode}
                  style={{ background: "none", border: "none", padding: 0, marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", cursor: "pointer", textDecoration: "underline" }}
                >
                  Set / forgot your ABHA password?
                </button>
                <button
                  type="button"
                  onClick={enterFindAbhaMode}
                  style={{ background: "none", border: "none", padding: 0, marginTop: "0.5rem", fontSize: "0.72rem", color: "#888", cursor: "pointer", textDecoration: "underline" }}
                >
                  Forgot your ABHA number?
                </button>
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
                <button
                  type="button"
                  onClick={enterSetPasswordMode}
                  style={{ background: "none", border: "none", padding: 0, marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", cursor: "pointer", textDecoration: "underline" }}
                >
                  Forgot password?
                </button>
                {error && <div className="error">{error}</div>}
              </>
            )}

            </>
            )}

          </div>
        </div>
      </div>
    </>
  );
}