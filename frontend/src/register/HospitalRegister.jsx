import React, { useState, useMemo } from "react";
import Select from "react-select";
import countryList from "react-select-country-list";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const S = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f4f3ef",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2.5rem",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
  },
  wrap: {
    maxWidth: "1080px",
    width: "100%",
    display: "flex",
    boxShadow: "0 24px 80px rgba(0,0,0,0.12)",
    overflow: "hidden",
  },

  // ── Left panel (black branding)
  left: {
    width: "320px",
    flexShrink: 0,
    backgroundColor: "#0a0a0a",
    display: "flex",
    flexDirection: "column",
    padding: "3rem 2.25rem",
    position: "relative",
    overflow: "hidden",
  },
  leftNoise: {
    position: "absolute",
    inset: 0,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
    opacity: 0.6,
    pointerEvents: "none",
  },
  leftAccentLine: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "3px",
    height: "100%",
    backgroundColor: "#ffffff",
    opacity: 0.12,
  },
  brandSection: {
    position: "relative",
    zIndex: 1,
    marginBottom: "auto",
  },
  brandMark: {
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "2.5rem",
  },
  brandIcon: {
    width: "32px",
    height: "32px",
    border: "1.5px solid rgba(255,255,255,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    fontSize: "0.95rem",
    fontWeight: 500,
    color: "#ffffff",
    letterSpacing: "-0.01em",
  },
  leftDivider: {
    width: "32px",
    height: "1px",
    backgroundColor: "rgba(255,255,255,0.2)",
    marginBottom: "2rem",
  },
  leftTitle: {
    fontSize: "1.65rem",
    fontWeight: 300,
    color: "#ffffff",
    letterSpacing: "-0.03em",
    lineHeight: 1.25,
    marginBottom: "1rem",
  },
  leftTitleBold: {
    fontWeight: 500,
    display: "block",
  },
  leftBody: {
    fontSize: "0.8rem",
    color: "rgba(255,255,255,0.45)",
    lineHeight: 1.8,
    fontWeight: 300,
  },
  leftStats: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
    marginTop: "3rem",
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    paddingBottom: "1.25rem",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  statNum: {
    fontSize: "1.5rem",
    fontWeight: 500,
    color: "#ffffff",
    letterSpacing: "-0.04em",
  },
  statLabel: {
    fontSize: "0.7rem",
    color: "rgba(255,255,255,0.35)",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    fontWeight: 400,
  },
  leftFooter: {
    position: "relative",
    zIndex: 1,
    marginTop: "2.5rem",
    paddingTop: "1.5rem",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    fontSize: "0.68rem",
    color: "rgba(255,255,255,0.2)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    fontWeight: 400,
  },

  // ── Right panel
  right: {
    flex: 1,
    padding: "3rem 3rem 2.5rem",
    overflowY: "auto",
    backgroundColor: "#ffffff",
  },
  formHeader: {
    marginBottom: "2.25rem",
  },
  headerEyebrow: {
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#aaaaaa",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    marginBottom: "0.5rem",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  eyebrowLine: {
    display: "inline-block",
    width: "20px",
    height: "1px",
    backgroundColor: "#cccccc",
  },
  formTitle: {
    fontSize: "1.75rem",
    fontWeight: 300,
    color: "#0a0a0a",
    letterSpacing: "-0.04em",
    marginBottom: "0.4rem",
    lineHeight: 1.15,
  },
  formTitleBold: {
    fontWeight: 500,
  },
  formSub: {
    fontSize: "0.82rem",
    color: "#999999",
    fontWeight: 300,
  },

  // ── Progress strip
  progressStrip: {
    display: "flex",
    gap: "4px",
    marginBottom: "2rem",
  },
  progressSegment: (active) => ({
    height: "2px",
    flex: 1,
    backgroundColor: active ? "#0a0a0a" : "#e8e8e8",
  }),

  // ── Sections
  sectionTitle: {
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#bbbbbb",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginBottom: "1rem",
    marginTop: "1.75rem",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  sectionLine: {
    flex: 1,
    height: "1px",
    backgroundColor: "#eeeeee",
  },

  // ── Grid
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1rem",
    marginBottom: "1rem",
  },
  grid3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "0.75rem",
    marginBottom: "1rem",
  },

  // ── Field
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  label: {
    fontSize: "0.68rem",
    fontWeight: 600,
    color: "#aaaaaa",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  input: {
    padding: "0.7rem 0.875rem",
    border: "1px solid #ebebeb",
    backgroundColor: "#fafafa",
    fontSize: "0.85rem",
    color: "#0a0a0a",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s, background-color 0.15s",
    borderRadius: "2px",
  },

  // ── Account type buttons
  typeBtn: (active) => ({
    padding: "0.7rem 0.5rem",
    border: active ? "1.5px solid #0a0a0a" : "1px solid #e8e8e8",
    backgroundColor: active ? "#0a0a0a" : "#fafafa",
    color: active ? "#ffffff" : "#555555",
    fontSize: "0.75rem",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: active ? 500 : 300,
    cursor: "pointer",
    transition: "all 0.15s",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    borderRadius: "2px",
    letterSpacing: "0.01em",
  }),
  typeHint: {
    fontSize: "0.72rem",
    color: "#aaaaaa",
    fontWeight: 300,
    marginTop: "0.35rem",
  },

  // ── Terms
  termsRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
    marginBottom: "1.5rem",
    marginTop: "1.75rem",
  },
  termsText: {
    fontSize: "0.78rem",
    color: "#777777",
    fontWeight: 300,
    lineHeight: 1.6,
  },
  termsLink: {
    color: "#0a0a0a",
    fontWeight: 500,
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },

  // ── Submit
  submitBtn: (hovered) => ({
    width: "100%",
    padding: "0.95rem",
    backgroundColor: hovered ? "#ffffff" : "#0a0a0a",
    color: hovered ? "#0a0a0a" : "#ffffff",
    border: "1.5px solid #0a0a0a",
    fontSize: "0.85rem",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderRadius: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  }),

  // ── Message
  messageBox: (isError) => ({
    marginTop: "1rem",
    padding: "0.875rem 1rem",
    border: "1px solid #ebebeb",
    borderLeft: `3px solid ${isError ? "#cc3333" : "#22aa66"}`,
    backgroundColor: isError ? "#fff8f8" : "#f6fdf9",
    fontSize: "0.8rem",
    color: isError ? "#aa2222" : "#226644",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: "0 2px 2px 0",
  }),

  // ── Footer
  formFooter: {
    marginTop: "1.5rem",
    paddingTop: "1.25rem",
    borderTop: "1px solid #f0f0f0",
    fontSize: "0.78rem",
    color: "#aaaaaa",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerLink: {
    color: "#0a0a0a",
    fontWeight: 500,
    textDecoration: "none",
    fontSize: "0.78rem",
  },
  footerSecure: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "0.68rem",
    color: "#cccccc",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
};

const selectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: "#fafafa",
    border: state.isFocused ? "1px solid #0a0a0a" : "1px solid #ebebeb",
    borderRadius: "2px",
    minHeight: "40px",
    boxShadow: "none",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "0.85rem",
    fontWeight: 300,
    "&:hover": { borderColor: "#aaaaaa" },
  }),
  menu: (base) => ({
    ...base,
    borderRadius: "2px",
    border: "1px solid #e0e0e0",
    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "0.82rem",
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "#0a0a0a" : state.isFocused ? "#f5f5f5" : "#ffffff",
    color: state.isSelected ? "#ffffff" : "#0a0a0a",
    fontWeight: 300,
    padding: "9px 12px",
  }),
  placeholder: (base) => ({ ...base, color: "#bbbbbb", fontWeight: 300 }),
  singleValue: (base) => ({ ...base, color: "#0a0a0a", fontWeight: 300 }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base) => ({ ...base, color: "#aaaaaa", padding: "0 8px" }),
};

function HospitalRegister() {
  const [formData, setFormData] = useState({
    name: "", address: "", headquarters: "", username: "", email: "",
    password: "", phone_number: "", no_of_staff: "", no_of_beds: "",
    country_code: "IN", hospital_user_type: "da_user",
  });
  const [message, setMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [hoveredSubmit, setHoveredSubmit] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const countryOptions = useMemo(() => countryList().getData(), []);
  const [selectedCountry, setSelectedCountry] = useState(
    countryOptions.find((o) => o.value === "IN")
  );

  const handleCountryChange = (opt) => {
    setSelectedCountry(opt);
    setFormData((p) => ({ ...p, country_code: opt ? opt.value : "IN" }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "no_of_staff" || name === "no_of_beds") {
      setFormData((p) => ({ ...p, [name]: value === "" ? "" : parseInt(value) }));
    } else {
      setFormData((p) => ({ ...p, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!termsAccepted) return setMessage("Please accept the terms and conditions.");
    if (!formData.no_of_staff || formData.no_of_staff <= 0)
      return setMessage("Please enter a valid staff count (minimum 1).");
    if (!formData.no_of_beds || formData.no_of_beds <= 0)
      return setMessage("Please enter a valid bed count (minimum 1).");

    const payload = {
      name: formData.name, address: formData.address || null,
      headquarters: formData.headquarters || null, username: formData.username,
      password: formData.password, email: formData.email,
      phone_number: formData.phone_number,
      no_of_staff: parseInt(formData.no_of_staff),
      no_of_beds: parseInt(formData.no_of_beds),
      country_code: formData.country_code,
      hospital_user_type: formData.hospital_user_type,
    };

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/hospitals/hospitaladd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error registering hospital");
      setMessage(data.message || "Hospital registered successfully.");
      setFormData({
        name: "", address: "", headquarters: "", username: "", email: "",
        password: "", phone_number: "", no_of_staff: "", no_of_beds: "",
        country_code: "IN", hospital_user_type: "da_user",
      });
      setSelectedCountry(countryOptions.find((o) => o.value === "IN"));
      setTermsAccepted(false);
    } catch (err) {
      setMessage(err.message || "An error occurred during registration.");
    }
  };

  const isError = message.toLowerCase().includes("error") || message.toLowerCase().includes("please");

  const accountTypes = [
    {
      key: "hms_integration", label: "HMS Integration",
      hint: "Connect with existing HMS",
      icon: (
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      ),
    },
    {
      key: "da_user", label: "Digital Access",
      hint: "Direct platform access",
      icon: (
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      key: "iframe_user", label: "iFrame Embed",
      hint: "Embedded integration",
      icon: (
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  const inputFocusStyle = { borderColor: "#0a0a0a", backgroundColor: "#ffffff" };
  const inputBlurStyle = { borderColor: "#ebebeb", backgroundColor: "#fafafa" };

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />
      <div style={S.page}>
        <div style={S.wrap}>

          {/* ── Left Panel ── */}
          <div style={S.left}>
            <div style={S.leftNoise} />
            <div style={S.leftAccentLine} />

            <div style={S.brandSection}>
              {/* Brand mark */}
              <div style={S.brandMark}>
                <span style={S.brandName}>DoctorAssist.AI</span>
              </div>

              <div style={S.leftDivider} />

              <h2 style={S.leftTitle}>
                Institution
                <span style={S.leftTitleBold}>Network Portal</span>
              </h2>
              <p style={S.leftBody}>
                A unified platform for managing clinical operations, patient data, and staff coordination across your institution.
              </p>
            </div>

            {/* Stats */}
            <div style={S.leftStats}>
              {[
                { num: "98.9%", label: "Platform uptime" },
                { num: "24/7", label: "Support availability" },
              ].map(({ num, label }) => (
                <div key={label} style={S.statItem}>
                  <span style={S.statNum}>{num}</span>
                  <span style={S.statLabel}>{label}</span>
                </div>
              ))}
            </div>

            <div style={S.leftFooter}>© 2025 DoctorAssist.AI</div>
          </div>

          {/* ── Right Panel ── */}
          <div style={S.right}>
            {/* Header */}
            <div style={S.formHeader}>
              <div style={S.headerEyebrow}>
                <span style={S.eyebrowLine} />
                New Institution
              </div>
              <h1 style={S.formTitle}>
                Institution Registration{" "}
              </h1>
              <p style={S.formSub}>Complete the form below to create your institution's account</p>
            </div>

            {/* Progress strip */}
            <div style={S.progressStrip}>
              {[true, false, false].map((active, i) => (
                <div key={i} style={S.progressSegment(active)} />
              ))}
            </div>

            <form onSubmit={handleSubmit}>

              {/* Section: Institution Details */}
              <div style={S.sectionTitle}>
                Institution Details
                <span style={S.sectionLine} />
              </div>

              <div style={S.grid2}>
                <div style={S.field}>
                  <label style={S.label}>Institution  Name *</label>
                  <input style={S.input} type="text" name="name" placeholder="e.g. abc Hospital"
                    value={formData.name} onChange={handleChange} required
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
                <div style={S.field}>
                  <label style={S.label}>Headquarters</label>
                  <input style={S.input} type="text" name="headquarters" placeholder="e.g. Mumbai, India"
                    value={formData.headquarters} onChange={handleChange}
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
              </div>

              <div style={{ ...S.grid2, gridTemplateColumns: "2fr 1fr" }}>
                <div style={S.field}>
                  <label style={S.label}>Address</label>
                  <input style={S.input} type="text" name="address" placeholder="Street address"
                    value={formData.address} onChange={handleChange}
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
                <div style={S.field}>
                  <label style={S.label}>Country *</label>
                  <Select options={countryOptions} value={selectedCountry}
                    onChange={handleCountryChange} styles={selectStyles}
                    isSearchable placeholder="Select" />
                </div>
              </div>

              {/* Section: Capacity */}
              <div style={S.sectionTitle}>
                Capacity & Contact
                <span style={S.sectionLine} />
              </div>

              <div style={S.grid2}>
                <div style={S.field}>
                  <label style={S.label}>Email Address *</label>
                  <input style={S.input} type="email" name="email" placeholder="admin@hospital.com"
                    value={formData.email} onChange={handleChange}
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
                <div style={S.field}>
                  <label style={S.label}>Phone Number *</label>
                  <input style={S.input} type="tel" name="phone_number" placeholder="1234567890"
                    value={formData.phone_number} onChange={handleChange} required
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
              </div>

              <div style={{ ...S.grid2, gridTemplateColumns: "1fr 1fr" }}>
                <div style={S.field}>
                  <label style={S.label}>Number of Staff *</label>
                  <input style={S.input} type="number" name="no_of_staff" placeholder="e.g. 150"
                    value={formData.no_of_staff} onChange={handleChange} required min="1"
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
                <div style={S.field}>
                  <label style={S.label}>Number of Beds *</label>
                  <input style={S.input} type="number" name="no_of_beds" placeholder="e.g. 300"
                    value={formData.no_of_beds} onChange={handleChange} required min="1"
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
              </div>

              {/* Section: Account Setup */}
              <div style={S.sectionTitle}>
                Account Setup
                <span style={S.sectionLine} />
              </div>

              <div style={S.grid2}>
                <div style={S.field}>
                  <label style={S.label}>Username *</label>
                  <input style={S.input} type="text" name="username" placeholder="Choose a username"
                    value={formData.username} onChange={handleChange} required
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                </div>
                <div style={S.field}>
                  <label style={S.label}>Password *</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input style={{ ...S.input, flex: 1 }} type={showPassword ? "text" : "password"} name="password" placeholder="Create a secure password"
                      value={formData.password} onChange={handleChange} required
                      onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                      onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)} />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        padding: "0.7rem 0.875rem",
                        border: "1px solid #ebebeb",
                        backgroundColor: "#fafafa",
                        cursor: "pointer",
                        borderRadius: "2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {showPassword ? (
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Account Type */}
              <div style={{ marginBottom: "0.25rem" }}>
                <label style={S.label}>Integration Type *</label>
                <div style={{ ...S.grid3, marginTop: "0.5rem" }}>
                  {accountTypes.map(({ key, label, icon }) => (
                    <button key={key} type="button"
                      style={S.typeBtn(formData.hospital_user_type === key)}
                      onClick={() => setFormData((p) => ({ ...p, hospital_user_type: key }))}>
                      {icon}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <p style={S.typeHint}>
                  {accountTypes.find((t) => t.key === formData.hospital_user_type)?.hint}
                </p>
              </div>

              {/* Terms */}
              <div style={S.termsRow}>
                <input type="checkbox" id="terms" checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  style={{ marginTop: "3px", width: "14px", height: "14px", accentColor: "#0a0a0a", cursor: "pointer" }} />
                <label htmlFor="terms" style={S.termsText}>
                  I agree to the{" "}
                  <a href="#" style={S.termsLink}>Terms of Service</a>{" "}&{" "}
                  <a href="#" style={S.termsLink}>Privacy Policy</a>
                </label>
              </div>

              {/* Submit */}
              <button type="submit" style={S.submitBtn(hoveredSubmit)}
                onMouseEnter={() => setHoveredSubmit(true)}
                onMouseLeave={() => setHoveredSubmit(false)}>
                Create Institution Account
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </button>
            </form>

            {/* Message */}
            {message && (
              <div style={S.messageBox(isError)}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isError
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />}
                </svg>
                {message}
              </div>
            )}

            {/* Footer */}
            <div style={S.formFooter}>
              <span>Already registered?{" "}<a href="https://doctorassist.ai/login" style={S.footerLink}>Sign in →</a></span>
              <div style={S.footerSecure}>
                <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                256-bit SSL secured
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

export default HospitalRegister;