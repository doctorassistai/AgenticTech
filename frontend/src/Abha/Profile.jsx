import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const InfoCell = ({ label, value }) => (
  <div className="info-cell">
    <div className="info-cell-label">{label}</div>
    <div className="info-cell-value">{value || "—"}</div>
  </div>
);

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [qrCode, setQrCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [abhaCardUrl, setAbhaCardUrl] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const xToken = localStorage.getItem("xToken");
  const txnId = localStorage.getItem("txnId");
  const headers = {
    "X-Token": `Bearer ${xToken}`,
    "Content-Type": "application/json",
  };

  useEffect(() => {
    if (!xToken) { 
      navigate("/login-abha", { replace: true }); 
      return;
    }
    loadProfile();
    
    // Cleanup: revoke object URL when component unmounts or session ends
    return () => {
      if (abhaCardUrl) {
        URL.revokeObjectURL(abhaCardUrl);
      }
    };
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}abha/profile`, {
        headers: { "X-Token": `Bearer ${xToken}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      const profileData = await res.json();
      setProfile(profileData);
      
      // Automatically download ABHA card after profile loads
      await autoDownloadAbhaCard();
    } catch (err) { 
      setError(err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const autoDownloadAbhaCard = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}abha/profile/abha-card`, {
        headers: { "X-Token": `Bearer ${xToken}` },
      });
      if (!res.ok) throw new Error("Failed to download card");
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAbhaCardUrl(url);
    } catch (err) { 
      console.error("Auto download failed:", err);
    }
  };

  const downloadAbhaCard = async () => {
    try {
      setIsDownloading(true);
      
      // If we already have the card data, just trigger download
      if (abhaCardUrl) {
        const link = document.createElement("a");
        link.href = abhaCardUrl;
        link.download = `ABHA-Card-${profile?.ABHANumber || "profile"}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // Fetch fresh copy if not available
        const res = await fetch(`${API_BASE_URL}abha/profile/abha-card`, {
          headers: { "X-Token": `Bearer ${xToken}` },
        });
        if (!res.ok) throw new Error("Failed to download card");
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setAbhaCardUrl(url);
        
        const link = document.createElement("a");
        link.href = url;
        link.download = `ABHA-Card-${profile?.ABHANumber || "profile"}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) { 
      alert(err.message); 
    } finally { 
      setIsDownloading(false); 
    }
  };

  const loadQrCode = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}abha/profile/qrcode`, { headers });
      if (!res.ok) throw new Error("Failed to load QR code");
      const data = await res.json();
      setQrCode(data.qrCode);
      setShowQr(true);
    } catch (err) { alert(err.message); }
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        setLoading(true);
        const base64 = reader.result.split(",")[1];
        const res = await fetch(`${API_BASE_URL}/photo`, {
          method: "PUT", headers,
          body: JSON.stringify({ profilePhoto: base64 }),
        });
        if (!res.ok) throw new Error("Upload failed");
        loadProfile();
      } catch (err) { alert(err.message); }
      finally { setLoading(false); }
    };
    reader.readAsDataURL(file);
  };

  const logout = () => { 
    // Clean up object URL before logging out
    if (abhaCardUrl) {
      URL.revokeObjectURL(abhaCardUrl);
    }
    localStorage.clear(); 
    navigate("/login-abha", { replace: true }); 
  };

  const initials = profile?.name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const dob = profile ? `${profile.dayOfBirth}-${profile.monthOfBirth}-${profile.yearOfBirth}` : "—";
  const gender = profile?.gender === "M" ? "Male" : profile?.gender === "F" ? "Female" : "Other";

  if (loading) return (
    <div className="state-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Open Sans',system-ui,sans-serif;font-weight:300;background:#fafafa;color:#000;}
        .state-screen{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#fafafa;}
        .spinner{width:24px;height:24px;border:1px solid #e0e0e0;border-top-color:#000;border-radius:50%;animation:spin 0.8s linear infinite;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .state-label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.15em;color:#888;}
      `}</style>
      <div className="spinner" />
      <p className="state-label">Loading profile</p>
    </div>
  );

  if (error) return (
    <div className="state-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Open Sans',system-ui,sans-serif;font-weight:300;background:#fafafa;color:#000;}
        .state-screen{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#fafafa;padding:2rem;}
        .error-box{border:1px solid #e0e0e0;background:#fff;padding:2rem;max-width:400px;width:100%;}
        .error-eyebrow{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.15em;color:#c00;margin-bottom:0.75rem;}
        .error-msg{font-size:0.875rem;color:#444;margin-bottom:1.5rem;line-height:1.7;}
        .btn-primary{display:block;width:100%;padding:0.875rem;background:#000;color:#fff;font-family:'Open Sans',system-ui,sans-serif;font-size:0.875rem;font-weight:400;border:1px solid #000;cursor:pointer;transition:all 0.2s;}
        .btn-primary:hover{background:transparent;color:#000;}
      `}</style>
      <div className="error-box">
        <p className="error-eyebrow">Error</p>
        <p className="error-msg">{error}</p>
        <button className="btn-primary" onClick={logout}>Login again →</button>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        body { font-family: 'Open Sans', system-ui, sans-serif; font-weight: 300; background: #fafafa; color: #000; -webkit-font-smoothing: antialiased; }

        /* ── Nav ── */
        .profile-nav { padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e0e0e0; background: #fff; position: sticky; top: 0; z-index: 100; }
        .nav-logo { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; color: #000; }
        .nav-right { display: flex; align-items: center; gap: 1.5rem; }
        .nav-tag { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.15em; color: #888; }
        .btn-logout { padding: 0.5rem 1rem; background: transparent; border: 1px solid #e0e0e0; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.75rem; font-weight: 400; cursor: pointer; color: #000; transition: all 0.2s; }
        .btn-logout:hover { border-color: #000; }

        /* ── Layout ── */
        .profile-main { max-width: 1100px; margin: 0 auto; padding: 2.5rem 2rem; }

        /* ── Hero ── */
        .profile-hero { display: grid; grid-template-columns: auto 1fr; gap: 2rem; align-items: center; border: 1px solid #e0e0e0; background: #fff; padding: 2rem; margin-bottom: 2.5rem; }
        .avatar { width: 96px; height: 96px; background: #000; display: flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 400; color: #fff; flex-shrink: 0; position: relative; cursor: pointer; overflow: hidden; }
        .avatar img { width: 100%; height: 100%; object-fit: cover; }
        .avatar-overlay { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.65); font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.08em; color: #fff; text-align: center; padding: 4px 0; opacity: 0; transition: opacity 0.2s; }
        .avatar:hover .avatar-overlay { opacity: 1; }
        .profile-name { font-size: 1.75rem; font-weight: 300; letter-spacing: -0.02em; margin-bottom: 0.35rem; }
        .abha-number { font-size: 0.78rem; color: #888; letter-spacing: 0.08em; margin-bottom: 0.75rem; font-family: monospace; }
        .verified-badge { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; padding: 0.25rem 0.65rem; border: 1px solid #000; color: #000; }
        .badge-dot { width: 5px; height: 5px; background: #000; border-radius: 50%; flex-shrink: 0; }

        /* ── Section label ── */
        .section-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-bottom: 1rem; font-weight: 400; }

        /* ── Info grid ── */
        .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); border: 1px solid #e0e0e0; background: #fff; margin-bottom: 2.5rem; }
        .info-cell { padding: 1.25rem; border-right: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; transition: background 0.15s; }
        .info-cell:hover { background: #fafafa; }
        .info-cell-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.4rem; }
        .info-cell-value { font-size: 0.875rem; color: #000; font-weight: 400; word-break: break-word; }

        /* ── Address ── */
        .address-block { border: 1px solid #e0e0e0; background: #fff; padding: 1.5rem; margin-bottom: 2.5rem; }
        .address-text { font-size: 0.875rem; color: #444; line-height: 1.8; }

        /* ── ABHA Card Preview ── */
        .card-preview { border: 1px solid #e0e0e0; background: #fff; margin-bottom: 2.5rem; overflow: hidden; }
        .card-header { background: #000; color: #fff; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; }
        .card-header h3 { font-size: 0.875rem; font-weight: 400; letter-spacing: 0.05em; margin: 0; }
        .card-badge { font-size: 0.7rem; background: rgba(255,255,255,0.2); padding: 0.25rem 0.75rem; border-radius: 2px; }
        .card-content { padding: 2rem; background: #f9f9f9; text-align: center; }
        .card-content iframe, .card-content embed { width: 100%; height: 500px; border: none; border: 1px solid #e0e0e0; background: #fff; }
        .card-download-btn { margin-top: 1rem; display: inline-block; padding: 0.75rem 1.5rem; background: #000; color: #fff; border: none; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.875rem; cursor: pointer; transition: opacity 0.2s; }
        .card-download-btn:hover { opacity: 0.9; }
        .card-download-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Actions ── */
        .actions { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #e0e0e0; margin-bottom: 2.5rem; }
        .action-btn { padding: 1.5rem 2rem; background: #fff; border: none; border-right: 1px solid #e0e0e0; cursor: pointer; text-align: left; transition: background 0.15s; font-family: 'Open Sans', system-ui, sans-serif; }
        .action-btn:last-child { border-right: none; }
        .action-btn:hover { background: #fafafa; }
        .action-btn-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.35rem; }
        .action-btn-title { font-size: 0.95rem; font-weight: 400; color: #000; margin-bottom: 0.25rem; }
        .action-btn-arrow { font-size: 0.75rem; color: #888; }

        /* ── QR modal ── */
        .qr-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem; }
        .qr-modal { background: #fff; border: 1px solid #e0e0e0; padding: 2.5rem; max-width: 400px; width: 100%; position: relative; }
        .qr-close { position: absolute; top: 1rem; right: 1rem; background: transparent; border: 1px solid #e0e0e0; width: 32px; height: 32px; cursor: pointer; font-size: 0.875rem; font-family: inherit; transition: border-color 0.2s; display: flex; align-items: center; justify-content: center; }
        .qr-close:hover { border-color: #000; }
        .qr-eyebrow { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-bottom: 1.5rem; }
        .qr-image { width: 100%; display: block; border: 1px solid #e0e0e0; }
        .qr-note { font-size: 0.72rem; color: #888; margin-top: 1.25rem; line-height: 1.7; }

        /* ── Responsive ── */
        @media (max-width: 640px) {
          .profile-hero { grid-template-columns: 1fr; justify-items: center; text-align: center; }
          .actions { grid-template-columns: 1fr; }
          .action-btn { border-right: none; border-bottom: 1px solid #e0e0e0; }
          .action-btn:last-child { border-bottom: none; }
          .profile-main { padding: 1.5rem 1rem; }
          .info-grid { grid-template-columns: 1fr 1fr; }
          .card-content embed, .card-content iframe { height: 300px; }
        }
      `}</style>

      <div>
        {/* Nav */}
        <nav className="profile-nav">
          <span className="nav-logo">Doctorassist.AI</span>
          <div className="nav-right">
            <span className="nav-tag">ABHA Profile</span>
            <button className="btn-logout" onClick={logout}>Logout</button>
          </div>
        </nav>

        <div className="profile-main">
          {profile && (
            <>
              {/* Hero */}
              <div className="profile-hero">
                <label className="avatar" style={{ cursor: "pointer" }}>
                  {profile.profilePhoto ? (
                    <img src={`data:image/jpeg;base64,${profile.profilePhoto}`} alt="Profile" />
                  ) : (
                    <span>{initials}</span>
                  )}
                  <span className="avatar-overlay">Change photo</span>
                  <input type="file" accept="image/*" hidden onChange={e => uploadPhoto(e.target.files[0])} />
                </label>
                <div>
                  <h1 className="profile-name">{profile.name}</h1>
                  <p className="abha-number">{profile.ABHANumber}</p>
                  <div className="verified-badge">
                    <span className="badge-dot" />
                    {profile.verificationStatus}
                  </div>
                </div>
              </div>

              {/* Info grid */}
              <p className="section-label">Personal details</p>
              <div className="info-grid">
                <InfoCell label="Gender" value={gender} />
                <InfoCell label="Date of birth" value={dob} />
                <InfoCell label="Mobile" value={profile.mobile} />
                <InfoCell label="ABHA address" value={profile.preferredAbhaAddress} />
                <InfoCell label="Verification type" value={profile.verificationType} />
                <InfoCell label="State" value={profile.stateName} />
                <InfoCell label="District" value={profile.districtName} />
                <InfoCell label="Town" value={profile.townName} />
                <InfoCell label="Pincode" value={profile.pincode} />
              </div>

              {/* Address */}
              <p className="section-label">Address</p>
              <div className="address-block">
                <p className="address-text">{profile.address || "—"}</p>
              </div>

              {/* ABHA Card Preview */}
              {abhaCardUrl && (
                <div className="card-preview">
                  <div className="card-header">
                    <h3>ABHA Card</h3>
                    <span className="card-badge">Downloaded</span>
                  </div>
                  <div className="card-content">
                    <embed 
                      src={`${abhaCardUrl}#toolbar=0&navpanes=0&scrollbar=0`} 
                      type="application/pdf"
                      width="100%"
                      height="500px"
                    />
                    <div>
                      <button 
                        className="card-download-btn" 
                        onClick={downloadAbhaCard}
                        disabled={isDownloading}
                      >
                        {isDownloading ? "Downloading..." : "Download ABHA Card ↓"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <p className="section-label">Actions</p>
              <div className="actions">
                <button className="action-btn" onClick={loadQrCode}>
                  <div className="action-btn-label">Share profile</div>
                  <div className="action-btn-title">Generate QR code</div>
                  <div className="action-btn-arrow">→</div>
                </button>
                <button className="action-btn" onClick={downloadAbhaCard} disabled={isDownloading}>
                  <div className="action-btn-label">Export</div>
                  <div className="action-btn-title">Download ABHA card again</div>
                  <div className="action-btn-arrow">→</div>
                </button>
              </div>

              {/* QR Modal */}
              {qrCode && showQr && (
                <div className="qr-overlay" onClick={() => setShowQr(false)}>
                  <div className="qr-modal" onClick={e => e.stopPropagation()}>
                    <button className="qr-close" onClick={() => setShowQr(false)}>✕</button>
                    <p className="qr-eyebrow">ABHA QR code</p>
                    <img
                      src={`data:image/png;base64,${qrCode}`}
                      alt="QR Code"
                      className="qr-image"
                    />
                    <p className="qr-note">Scan this code to share your health profile with any ABDM-registered provider.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}