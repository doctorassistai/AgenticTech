import React, { useState } from 'react';

// API Configuration
const API_BASE_URL = 'https://doctorassist.ai/api/';
const ZENZO_BASE_URL = 'https://zenzo.theapothecary.co.in:9500';

export default function AmbulanceLogin() {
  const [username, setUsername]           = useState('');
  const [password, setPassword]           = useState('');
  const [loading, setLoading]             = useState(false);
  const [showPassword, setShowPassword]   = useState(false);
  const [rememberMe, setRememberMe]       = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // ─────────────────────────────────────────────────────────────────
  // STEP A — Try Ambulance login
  // Returns true if credentials matched (already redirected), false to fall through
  // ─────────────────────────────────────────────────────────────────
  const tryAmbulanceLogin = async () => {
    const response = await fetch(
      `${API_BASE_URL}/hms/users/ambulance/ambulance/driver/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }
    );
    const data = await response.json();

    if (response.ok && data.access_token) {
      // ✅ Ambulance credentials matched
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem(
        'user',
        JSON.stringify({
          username:          data.user_data.username,
          role:              data.user_data.role,
          driver_name:       data.user_data.driver_name,
          driver_id:         data.user_data.driver_id,
          assignedVehicleId: data.user_data.assignedVehicleId,
          isLoggedIn:        true,
        })
      );
      window.location.href = '/ambulance-dashboard';
      return true;
    }
    return false; // not an ambulance user — fall through to doctor
  };

  // ─────────────────────────────────────────────────────────────────
  // STEP B — Try Doctor login: DoctorAssist auth → verify → Zenzo
  // Returns 'ok' | 'invalid' | 'error'
  // ─────────────────────────────────────────────────────────────────
  const tryDoctorLogin = async () => {
    // B-1: DoctorAssist auth/login
    setStatusMessage('Verifying credentials…');
    const loginResponse = await fetch(`${API_BASE_URL}/hms/users/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    const loginData = await loginResponse.json();
    console.log('✅ DEMO LOGIN RESPONSE:', loginData);

    if (!loginResponse.ok || loginData.status !== 'success') {
      return 'invalid'; // neither ambulance nor doctor
    }

    // B-2: Verify Emergency specialization
    setStatusMessage('Verifying specialization…');
    const verifyResponse = await fetch(`${API_BASE_URL}/hms/users/doctors/verify`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const verifyData = await verifyResponse.json();
    console.log('✅ DEMO VERIFY RESPONSE:', verifyData);

    if (!verifyResponse.ok || verifyData.status !== 'authenticated') {
      alert('Doctor verification failed. Please contact support.');
      return 'error';
    }

    const specialization = verifyData.doctor?.specialization;
    if (specialization !== 'Emergency') {
      alert(
        `Access Denied\n\nOnly Emergency department doctors can access this portal.\nYour specialization: ${specialization || 'Unknown'}`
      );
      return 'error';
    }

    // B-3: Zenzo doctor login (non-blocking)
    setStatusMessage('Connecting to Zenzo…');
    console.log('🩺 CALLING ZENZO DOCTOR LOGIN API');
   try {

  const zenzoResponse = await fetch(
    `${API_BASE_URL}/hms/users/ambulance/zenzo-doctor-login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        email: username,
        password,
      }),
    }
  );

  const zenzoData = await zenzoResponse.json();

  console.log('🩺 ZENZO DOCTOR RESPONSE:', zenzoData);

  // ✅ Save token coming from backend
  if (zenzoData?.accessToken) {

    localStorage.setItem(
      'zenzo_doctor_access_token',
      zenzoData.accessToken
    );

    console.log('🔑 ZENZO ACCESS TOKEN SAVED');
  }

  if (zenzoResponse.ok && zenzoData?.success) {

    localStorage.setItem(
      'zenzo_doctor_data',
      JSON.stringify(zenzoData.data)
    );

    localStorage.setItem(
      'zenzo_doctor_mongo_id',
      zenzoData.data._id
    );

    localStorage.setItem(
      'zenzo_doctor_id',
      zenzoData.data.doctorId
    );

    localStorage.setItem(
      'zenzo_doctor_organization_id',
      zenzoData.data?.organization?._id || ''
    );

    localStorage.setItem(
      'zenzo_doctor_department_id',
      zenzoData.data?.department?._id || ''
    );

    localStorage.setItem(
      'zenzo_doctor_email',
      username
    );

    console.log('✅ ZENZO DOCTOR LOGIN SUCCESS');

  } else {

    console.warn(
      '⚠️ Zenzo login did not succeed'
    );
  }

} catch (zenzoError) {

  console.warn(
    '⚠️ Zenzo login failed:',
    zenzoError.message
  );
}

    // B-4: Persist DoctorAssist session & redirect
    setStatusMessage('Opening dashboard…');
    localStorage.setItem(
      'user',
      JSON.stringify({
        username,
        role:          'doctor',
        specialization,
        doctor_id:     verifyData.doctor?.sys_user_id || loginData.user_id,
        doctor_name:   verifyData.doctor?.name,
        isLoggedIn:    true,
      })
    );
    window.location.href = '/Doctor-Emergency-Dashbaord';
    return 'ok';
  };

  // ─────────────────────────────────────────────────────────────────
  // UNIFIED SUBMIT — ambulance first, fall through to doctor
  // ─────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      alert('Please enter both username and password');
      return;
    }

    setLoading(true);
    setStatusMessage('Authenticating…');

    try {
      const isAmbulance = await tryAmbulanceLogin();
      if (isAmbulance) return; // already redirected

      const result = await tryDoctorLogin();
      if (result === 'invalid') {
        alert('Invalid credentials. Please check your username and password.');
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Network error. Please check your connection and try again.\n' + error.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; }

        .amb-root {
          display: flex;
          min-height: 100vh;
          width: 100%;
        }

        /* ── LEFT PANEL ── */
        .amb-left {
          width: 48%;
          background: #0a0a0a;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 40px 48px;
          overflow: hidden;
          flex-shrink: 0;
        }

        .amb-left::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 60px 60px;
          pointer-events: none;
        }

        .amb-left::after {
          content: '';
          position: absolute;
          top: -120px;
          right: -120px;
          width: 380px;
          height: 380px;
          background: radial-gradient(circle, rgba(220,38,38,0.18) 0%, transparent 70%);
          pointer-events: none;
        }

        .amb-logo {
          font-family: 'DM Sans', sans-serif;
          font-weight: 600;
          font-size: 15px;
          color: #ffffff;
          letter-spacing: 0.5px;
          position: relative;
          z-index: 1;
        }

        .amb-left-body {
          position: relative;
          z-index: 1;
        }

        .amb-emergency-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(220,38,38,0.15);
          border: 1px solid rgba(220,38,38,0.4);
          border-radius: 4px;
          padding: 6px 14px;
          margin-bottom: 32px;
        }

        .amb-badge-dot {
          width: 7px;
          height: 7px;
          background: #ef4444;
          border-radius: 50%;
          animation: pulse-dot 1.4s ease-in-out infinite;
          flex-shrink: 0;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.7); }
        }

        .amb-badge-text {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #ef4444;
        }

        .amb-hero-title {
          font-family: 'DM Serif Display', serif;
          font-size: clamp(36px, 4vw, 56px);
          font-weight: 400;
          color: #ffffff;
          line-height: 1.1;
          letter-spacing: -1px;
          margin-bottom: 24px;
        }

        .amb-hero-title em {
          font-style: italic;
          color: #f87171;
        }

        .amb-hero-sub {
          font-size: 14px;
          color: #6b6b6b;
          line-height: 1.7;
          max-width: 340px;
        }

        .amb-stats {
          display: flex;
          gap: 32px;
          position: relative;
          z-index: 1;
        }

        .amb-stat { display: flex; flex-direction: column; gap: 4px; }

        .amb-stat-num {
          font-family: 'DM Serif Display', serif;
          font-size: 28px;
          color: #ffffff;
          letter-spacing: -1px;
        }

        .amb-stat-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: #4b4b4b;
        }

        .amb-stat-divider {
          width: 1px;
          background: #222;
          align-self: stretch;
        }

        /* ── RIGHT PANEL ── */
        .amb-right {
          flex: 1;
          background: #f8f7f5;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 60px 72px;
        }

        .amb-right-inner {
          max-width: 420px;
          width: 100%;
        }

        .amb-section-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 2.5px;
          color: #9ca3af;
          margin-bottom: 12px;
        }

        .amb-form-title {
          font-family: 'DM Serif Display', serif;
          font-size: 38px;
          font-weight: 400;
          color: #0a0a0a;
          letter-spacing: -1px;
          line-height: 1.1;
          margin-bottom: 8px;
        }

        .amb-form-sub {
          font-size: 13px;
          color: #9ca3af;
          line-height: 1.6;
          margin-bottom: 32px;
        }

        .amb-chips {
          display: flex;
          gap: 8px;
          margin-bottom: 36px;
          flex-wrap: wrap;
        }

        .amb-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          padding: 5px 12px;
          border-radius: 3px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: #374151;
        }

        .amb-chip-dot {
          width: 6px;
          height: 6px;
          background: #22c55e;
          border-radius: 50%;
          animation: pulse-dot 1.4s ease-in-out infinite;
        }

        .amb-field { margin-bottom: 20px; }

        .amb-label {
          display: block;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: #9ca3af;
          margin-bottom: 8px;
        }

        .amb-input-wrap { position: relative; }

        .amb-input {
          width: 100%;
          padding: 14px 16px;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          color: #0a0a0a;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 0;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .amb-input::placeholder { color: #c4c4c4; }
        .amb-input:focus {
          border-color: #0a0a0a;
          box-shadow: 0 0 0 3px rgba(10,10,10,0.06);
        }
        .amb-input:disabled { opacity: 0.5; cursor: not-allowed; }

        .amb-eye-btn {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #9ca3af;
          padding: 4px;
          display: flex;
          align-items: center;
        }
        .amb-eye-btn:hover { color: #374151; }

        .amb-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }

        .amb-remember { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .amb-remember input[type="checkbox"] {
          width: 14px;
          height: 14px;
          accent-color: #0a0a0a;
          cursor: pointer;
        }
        .amb-remember-label {
          font-size: 12px;
          color: #6b7280;
          cursor: pointer;
          user-select: none;
        }

        .amb-forgot {
          font-size: 12px;
          color: #6b7280;
          text-decoration: none;
          border-bottom: 1px solid transparent;
          transition: border-color 0.2s, color 0.2s;
        }
        .amb-forgot:hover { color: #0a0a0a; border-bottom-color: #0a0a0a; }

        /* Live step indicator */
        .amb-status-msg {
          min-height: 20px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: #6b7280;
          letter-spacing: 0.3px;
        }

        .amb-status-spinner {
          width: 10px;
          height: 10px;
          border: 1.5px solid rgba(107,114,128,0.3);
          border-top-color: #6b7280;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }

        .amb-submit {
          width: 100%;
          background: #0a0a0a;
          color: #ffffff;
          border: none;
          padding: 15px 24px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.5px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: background 0.2s, transform 0.1s;
          margin-bottom: 16px;
        }
        .amb-submit:hover:not(:disabled) { background: #1f1f1f; }
        .amb-submit:active:not(:disabled) { transform: scale(0.99); }
        .amb-submit:disabled { opacity: 0.6; cursor: not-allowed; }

        .amb-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .amb-divider {
          border: none;
          border-top: 1px solid #e5e7eb;
          margin: 24px 0;
        }

        .amb-footer-links { display: flex; gap: 20px; }
        .amb-footer-link {
          font-size: 11px;
          color: #9ca3af;
          text-decoration: none;
          letter-spacing: 0.5px;
          transition: color 0.2s;
        }
        .amb-footer-link:hover { color: #374151; }

        .amb-auth-note {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: #d1d5db;
          margin-top: 6px;
        }

        @media (max-width: 900px) {
          .amb-root { flex-direction: column; }
          .amb-left { width: 100%; min-height: 340px; padding: 32px; }
          .amb-right { padding: 48px 32px; }
          .amb-right-inner { max-width: 100%; }
          .amb-stats { gap: 20px; }
        }
      `}</style>

      <div className="amb-root">

        {/* ── LEFT DARK PANEL ── */}
        <div className="amb-left">
      <div className="amb-logo" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

  {/* Row 1 — A Product of + Apoc + Zenzo */}
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
    <span style={{
   fontSize: '13px', color: '#ffffff', letterSpacing: '2px',
textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>
      A Product by
    </span>
    <img
    src="https://doctorassist.ai/uploads/files/Ambulance/apoc1.png"
alt="a-poc"
style={{ height: '30px', objectFit: 'contain', mixBlendMode: 'screen' }}
    />
  <span style={{ color: '#ffffff', fontSize: '18px', lineHeight: 1 }}>×</span>
    <div style={{ fontSize: '22px', color: '#ffffff', fontWeight: 600, letterSpacing: '0.3px' }}>
        DoctorAssist.Ai
      </div>
  </div>

  {/* Row 2 — DoctorAssist icon + label */}
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
   
    <div style={{ lineHeight: 1.4 }}>
     
      
    </div>
  </div>

</div>

          <div className="amb-left-body">
            <div className="amb-emergency-badge">
              <span className="amb-badge-dot" />
              <span className="amb-badge-text">Emergency Dispatch Active</span>
            </div>

            <h1 className="amb-hero-title">
              Emergency<br />
              response that<br />
              <em>never waits.</em>
            </h1>

          <p className="amb-hero-sub">
  A real-time dispatch and navigation system built for
  ambulance crews — tracking every second from call to
  care, continuously.
</p>

{/* Zenzo Logo */}
<div style={{ marginTop: '22px' }}>
  <img
    src="https://doctorassist.ai/uploads/files/Ambulance/ZENO LOGO .png"
    alt="Zenzo"
    style={{
      height: '45px',
      objectFit: 'contain',
      mixBlendMode: 'screen'
    }}
  />
</div>
          </div>
          

          <div className="amb-stats">
            <div className="amb-stat">
              <span className="amb-stat-num">24/7</span>
              <span className="amb-stat-label">Dispatch</span>
            </div>
            <div className="amb-stat-divider" />
            <div className="amb-stat">
              <span className="amb-stat-num">GPS</span>
              <span className="amb-stat-label">Live Tracking</span>
            </div>
            <div className="amb-stat-divider" />
            <div className="amb-stat">
              <span className="amb-stat-num">ETA</span>
              <span className="amb-stat-label">Real-time ETA</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT LIGHT PANEL ── */}
        <div className="amb-right">
          <div className="amb-right-inner">

            <p className="amb-section-label">Staff Portal</p>
            <h2 className="amb-form-title">Sign in to your account.</h2>
            <p className="amb-form-sub">
              Access your emergency response console.<br />
              All sessions are encrypted and HIPAA-compliant.
            </p>

            <div className="amb-chips">
              <span className="amb-chip">
                <span className="amb-chip-dot" />
                Dispatch Online
              </span>
              <span className="amb-chip">GPS Synced</span>
              <span className="amb-chip">HIPAA Compliant</span>
            </div>

            <form onSubmit={handleLogin}>
              <div className="amb-field">
                <label className="amb-label">Username</label>
                <div className="amb-input-wrap">
                  <input
                    className="amb-input"
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="amb-field">
                <label className="amb-label">Password</label>
                <div className="amb-input-wrap">
                  <input
                    className="amb-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    style={{ paddingRight: '44px' }}
                  />
                  <button
                    type="button"
                    className="amb-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="amb-row">
                <label className="amb-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span className="amb-remember-label">Remember me</span>
                </label>
                <a href="#" className="amb-forgot">Forgot password?</a>
              </div>

              {/* Live auth-step indicator */}
              <div className="amb-status-msg">
                {statusMessage && (
                  <>
                    <span className="amb-status-spinner" />
                    {statusMessage}
                  </>
                )}
              </div>

              <button type="submit" className="amb-submit" disabled={loading}>
                {loading ? (
                  <>
                    <span className="amb-spinner" />
                    Authenticating…
                  </>
                ) : (
                  'Sign In →'
                )}
              </button>
            </form>

            <p className="amb-auth-note">Authorized Emergency Personnel Only</p>

            <hr className="amb-divider" />

            <div className="amb-footer-links">
              <a href="#" className="amb-footer-link">Privacy Policy</a>
              <a href="#" className="amb-footer-link">Terms of Service</a>
              <a href="#" className="amb-footer-link">Contact Support</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}