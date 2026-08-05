import { useState, useEffect } from "react";

export default function DoctorRegistration({ onClose }) {

  const generatePassword = () => {
    return "DOC@" + Math.random().toString(36).slice(2, 8).toUpperCase();
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
    specialization: "",
    qualification: "",
    registrationNumber: "",
    experience: "",
    status: "Active",
    username: "",
    password: "",
    role: "auditing-doctor-new"
  });

  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copied, setCopied] = useState(false);

  const copyCredentials = async () => {
    const text = `Username: ${createdCredentials.username}\nPassword: ${createdCredentials.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert("Failed to copy: " + err.message);
    }
  };

  useEffect(() => {
    setForm(prev => ({ ...prev, password: generatePassword() }));
  }, []);

  const handleChange = (e) => {
    const updated = { ...form, [e.target.name]: e.target.value };
    if (e.target.name === "fullName" || e.target.name === "mobile") {
      updated.username = generateUsername(updated.fullName, updated.mobile);
    }
    setForm(updated);
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
      role: "auditing-doctor-new",
      companyName: "Self",
      streetAddress: form.address,
      city: form.location,
      state: "",
      postalCode: "",
      country: "India",
      specialization: form.specialization,
      qualification: form.qualification,
      registrationNumber: form.registrationNumber,
      experience: form.experience,
    };

const res = await fetch("https://doctorassist.ai/api/hms/users/auth/register-auditing-doctor", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-User-Id": localStorage.getItem("user_id"),
    "X-User-Role": localStorage.getItem("role"),
  },
  body: JSON.stringify(payload)
});

    const result = await res.json();

    if (!res.ok) {
      alert(
        "Error: " +
        (result.message || result.detail || JSON.stringify(result))
      );
      return;
    }

    setCreatedCredentials({ username: form.username, password: form.password });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh", overflowY: "auto" }}>

        <div className="panel-header">
          <div className="panel-title">Register Doctor</div>
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
              <label>Specialization *</label>
              <select name="specialization" value={form.specialization} onChange={handleChange} required>
                <option value="">Select Specialization</option>
                <option>General Medicine</option>
                <option>Cardiology</option>
                <option>Orthopedics</option>
                <option>Neurology</option>
                <option>Oncology</option>
                <option>Pediatrics</option>
                <option>Gynecology</option>
                <option>Radiology</option>
                <option>Pathology</option>
                <option>Other</option>
              </select>
            </div>

            <div className="field">
              <label>Qualification *</label>
              <input
                name="qualification"
                placeholder="e.g. MBBS, MD"
                value={form.qualification}
                onChange={handleChange}
                required
              />
            </div>

            <div className="field">
              <label>Medical Registration Number *</label>
              <input
                name="registrationNumber"
                value={form.registrationNumber}
                onChange={handleChange}
                required
              />
            </div>

            <div className="field">
              <label>Experience (Years)</label>
              <input
                type="number"
                name="experience"
                value={form.experience}
                onChange={handleChange}
                min="0"
              />
            </div>

            <div className="field">
              <label>Address</label>
              <textarea name="address" value={form.address} onChange={handleChange} />
            </div>

            <div className="field">
              <label>Status</label>
              <select name="status" value={form.status} onChange={handleChange}>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </div>

            {createdCredentials && (
  <div style={{ background: "#f0f9ff", padding: "12px", borderRadius: "8px", border: "1px solid #bae6fd", gridColumn: "span 2" }}>
    <p>✅ <strong>Registration Successful!</strong></p>
    <p><strong>Username:</strong> {createdCredentials.username}</p>
    <p><strong>System Password:</strong> {createdCredentials.password}</p>
    <small style={{ color: "#666" }}>Share these credentials with the doctor</small>
    <br />
    <button
      className="btn btn-secondary"
      style={{ marginTop: "8px", marginRight: "8px" }}
      onClick={copyCredentials}
      type="button"
    >
      {copied ? "✓ Copied!" : "Copy Credentials"}
    </button>
    <button className="btn btn-secondary" style={{ marginTop: "8px" }} onClick={onClose} type="button">
      Close
    </button>
  </div>
)}

            {!createdCredentials && (
              <button className="btn btn-primary" type="submit">Register Doctor</button>
            )}

          </form>
        </div>
      </div>
    </div>
  );
}