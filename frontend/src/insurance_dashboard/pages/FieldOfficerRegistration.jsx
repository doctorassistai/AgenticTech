import { useState, useEffect } from "react";

export default function FieldOfficerRegistration({ onClose }) {

  const generatePassword = () => {
    return "FO@" + Math.random().toString(36).slice(2, 8).toUpperCase();
  };

  const generateUsername = (fullName, mobile) => {
    const namePart = fullName.replace(/\s+/g, "").toLowerCase().slice(0, 5);
    return namePart + mobile.slice(-4);
  };

  const [form, setForm] = useState({
    fullName: "",
    mobile: "",
    email: "",
    location: "",
    address: "",
    skills: [],
    experience: "",
    status: "Unavailable",
    idProofType: "",
    idProofNumber: "",
    username: "",
    password: "",
    role: "field-officer",
pincode: "",
district: ""
  });

  useEffect(() => {
    setForm(prev => ({ ...prev, password: generatePassword() }));
  }, []);

  const skillOptions = ["Motor", "Health", "Fire", "Life", "Marine", "Burglary"];

  const handleChange = (e) => {
    const updated = { ...form, [e.target.name]: e.target.value };
    if (e.target.name === "fullName" || e.target.name === "mobile") {
      updated.username = generateUsername(updated.fullName, updated.mobile);
    }
    setForm(updated);
  };
const [createdCredentials, setCreatedCredentials] = useState(null);
  const toggleSkill = (skill) => {
    if (form.skills.includes(skill)) {
      setForm({ ...form, skills: form.skills.filter(s => s !== skill) });
    } else {
      setForm({ ...form, skills: [...form.skills, skill] });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = {
      fullName: form.fullName,
      username: form.username,
      email: form.email,
      phoneNumber: form.mobile,
      password: form.password,
      confirmPassword: form.password,
      role: "field-officer",
      companyName: "Self",
      streetAddress: form.address,
      city: form.location,
      state: "",
      postalCode: "",
      country: "India",
      pincode: form.pincode,
      district: form.district || "",
      initialStatus: form.status
    };

    const res = await fetch("https://doctorassist.ai/api/hms/users/doctors/quality-checker/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (!res.ok) {
  alert(
  "Error: " +
  (
    result.message ||
    result.detail ||
    JSON.stringify(result)
  )
);
  return;
}
setCreatedCredentials({ username: form.username, password: form.password });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh", overflowY: "auto" }}>

        <div className="panel-header">
  <div className="panel-title">Register Field Officer</div>
  <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
</div>

       <div className="panel-body">
  <form onSubmit={handleSubmit} className="form-grid cols-2">

          <div className="field">
            <label>Full Name *</label>
            <input name="fullName" value={form.fullName} onChange={handleChange} required />
          </div>

          <div className="field">
            <label>Mobile *</label>
            <input name="mobile" value={form.mobile} onChange={handleChange} required />
          </div>

          <div className="field">
            <label>Email</label>
            <input name="email" value={form.email} onChange={handleChange} />
          </div>

          <div className="field">
            <label>Location *</label>
            <select name="location" value={form.location} onChange={handleChange} required>
              <option value="">Select Location</option>
              <option>Bengaluru</option>
              <option>Mysuru</option>
              <option>Tumakuru</option>
            </select>
          </div>
          <div className="field">
  <label>Service Pincode *</label>
  <input
    name="pincode"
    value={form.pincode}
    onChange={handleChange}
    placeholder="6-digit service area pincode"
    maxLength={6}
    required
  />
</div>

<div className="field">
  <label>District</label>
  <input
    name="district"
    value={form.district}
    onChange={handleChange}
    placeholder="e.g. Ernakulam"
  />
</div>

          <div className="field">
            <label>Address</label>
            <textarea name="address" value={form.address} onChange={handleChange} />
          </div>

          <div className="field">
            <label>Skills *</label>
            <div className="filter-row">
              {skillOptions.map(skill => (
                <button
                  key={skill}
                  type="button"
                  onClick={() => toggleSkill(skill)}
                  className={`btn ${form.skills.includes(skill) ? "btn-primary" : "btn-secondary"}`}
                >
                  {skill}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Experience (Years)</label>
            <input type="number" name="experience" value={form.experience} onChange={handleChange} min="0" />
          </div>

          <div className="field">
            <label>Status</label>
            <select name="status" value={form.status} onChange={handleChange}>
              <option>Available</option>
              <option>Unavailable</option>
            </select>
          </div>

          <div className="field">
            <label>ID Proof Type</label>
            <select name="idProofType" value={form.idProofType} onChange={handleChange}>
              <option value="">Select</option>
              <option>Aadhaar</option>
              <option>PAN</option>
              <option>Driving License</option>
            </select>
          </div>

          <div className="field">
            <label>ID Proof Number</label>
            <input name="idProofNumber" value={form.idProofNumber} onChange={handleChange} />
          </div>

{createdCredentials && (
  <div style={{
    gridColumn: '1 / -1',
    background: 'color-mix(in srgb, var(--green) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)',
    borderRadius: 10, padding: 16,
    display: 'flex', flexDirection: 'column', gap: 12,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 18 }}>✅</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>Registration Successful</span>
    </div>

    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
      Share these credentials with the field officer securely.
    </div>

    {[
      { label: 'Username', value: createdCredentials.username },
      { label: 'Password', value: createdCredentials.password },
    ].map(({ label, value }) => (
      <div key={label} style={{
        background: 'var(--bg1)',
        border: '1px solid var(--border)',
        borderRadius: 8, padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>
            {label}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)', wordBreak: 'break-all' }}>
            {value}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value)
            // brief visual feedback
            const btn = document.getElementById(`copy-${label}`)
            if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '⎘' }, 1500) }
          }}
          id={`copy-${label}`}
          title={`Copy ${label}`}
          style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: 7,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            cursor: 'pointer', fontSize: 16, color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >
          ⎘
        </button>
      </div>
    ))}

    <button
      type="button"
      onClick={() => {
        const text = `Username: ${createdCredentials.username}\nPassword: ${createdCredentials.password}`
        navigator.clipboard.writeText(text)
      }}
      style={{
        padding: '8px 14px', borderRadius: 7,
        background: 'var(--bg2)', border: '1px solid var(--border)',
        color: 'var(--text)', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        alignSelf: 'flex-start',
      }}
    >
      ⎘ Copy Both
    </button>

    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ alignSelf: 'flex-end', marginTop: 4 }}
      onClick={onClose}
    >
      Close
    </button>
  </div>
)}

{/* Hide submit button after success */}
{!createdCredentials && (
  <button className="btn btn-primary" type="submit">Register Officer</button>
)}

        </form>
        </div>
      </div>
    </div>
  );
}