import React, { useState } from 'react';

const QualityCheckerRegistration = () => {
  // Styles object
  const styles = {
    container: {
      maxWidth: '700px',
      margin: '2rem auto',
      padding: '2rem',
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    },
    header: {
      color: '#333',
      marginBottom: '0.5rem',
      fontSize: '2rem',
      textAlign: 'center'
    },
    description: {
      color: '#666',
      textAlign: 'center',
      marginBottom: '2rem',
      fontSize: '1rem'
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: '1.5rem'
    },
    section: {
      backgroundColor: '#f8f9fa',
      padding: '1.5rem',
      borderRadius: '8px',
      border: '1px solid #e9ecef'
    },
    sectionTitle: {
      color: '#495057',
      marginTop: 0,
      marginBottom: '1.5rem',
      fontSize: '1.3rem',
      borderBottom: '2px solid #dee2e6',
      paddingBottom: '0.5rem'
    },
    row: {
      display: 'flex',
      gap: '1rem',
      marginBottom: '1rem',
      flexWrap: 'wrap'
    },
    group: {
      flex: '1',
      minWidth: '250px',
      marginBottom: '1rem'
    },
    label: {
      display: 'block',
      marginBottom: '0.5rem',
      color: '#495057',
      fontWeight: 500,
      fontSize: '0.9rem'
    },
    input: {
      width: '100%',
      padding: '0.75rem',
      border: '1px solid #ced4da',
      borderRadius: '4px',
      fontSize: '1rem',
      transition: 'border-color 0.3s, box-shadow 0.3s',
      backgroundColor: 'white',
      boxSizing: 'border-box'
    },
    select: {
      width: '100%',
      padding: '0.75rem',
      border: '1px solid #ced4da',
      borderRadius: '4px',
      fontSize: '1rem',
      backgroundColor: 'white',
      cursor: 'pointer',
      appearance: 'none',
      backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e")',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 1rem center',
      backgroundSize: '1em'
    },
    inputError: {
      borderColor: '#dc3545'
    },
    errorMessage: {
      color: '#dc3545',
      fontSize: '0.85rem',
      marginTop: '0.25rem',
      display: 'block'
    },
    globalError: {
      backgroundColor: '#f8d7da',
      border: '1px solid #f5c6cb',
      color: '#721c24',
      padding: '0.75rem 1.25rem',
      borderRadius: '4px',
      marginBottom: '1rem'
    },
    submitButton: {
      backgroundColor: '#007bff',
      color: 'white',
      border: 'none',
      padding: '1rem 3rem',
      fontSize: '1.1rem',
      fontWeight: 600,
      borderRadius: '50px',
      cursor: 'pointer',
      transition: 'background-color 0.3s, transform 0.2s',
      boxShadow: '0 2px 4px rgba(0, 123, 255, 0.3)',
      width: '100%',
      maxWidth: '300px',
      margin: '0 auto'
    },
    submitButtonDisabled: {
      backgroundColor: '#6c757d',
      cursor: 'not-allowed',
      opacity: 0.65
    },
    requiredNote: {
      marginTop: '1rem',
      color: '#6c757d',
      fontSize: '0.9rem',
      fontStyle: 'italic',
      textAlign: 'center'
    },
    successContainer: {
      maxWidth: '500px',
      margin: '4rem auto',
      padding: '3rem',
      backgroundColor: '#d4edda',
      border: '1px solid #c3e6cb',
      borderRadius: '8px',
      textAlign: 'center'
    },
    successTitle: {
      color: '#155724',
      marginBottom: '1rem'
    },
    successText: {
      color: '#155724',
      marginBottom: '2rem',
      fontSize: '1.1rem'
    },
    successButton: {
      backgroundColor: '#155724',
      color: 'white',
      border: 'none',
      padding: '0.75rem 2rem',
      fontSize: '1rem',
      borderRadius: '4px',
      cursor: 'pointer'
    },
    roleBadge: {
      display: 'inline-block',
      padding: '0.25rem 0.75rem',
      backgroundColor: '#e7f3ff',
      color: '#007bff',
      borderRadius: '20px',
      fontSize: '0.85rem',
      fontWeight: 600,
      marginLeft: '0.5rem'
    }
  };

  // Initial form state - only requested fields
  const initialFormState = {
    // Personal Information
    fullName: '',
    username: '',
    email: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
    
    // Role
    role: 'quality-checker', // Default role
    
    // Company & Address
    companyName: '',
    streetAddress: '',
    city: '',
    state: '',
    postalCode: '',
    country: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  // Handle input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    
    setFormData({
      ...formData,
      [name]: value
    });

    // Clear error for this field
    if (errors[name]) {
      setErrors({
        ...errors,
        [name]: null
      });
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};

    // Personal Information
    if (!formData.fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!formData.username.trim()) newErrors.username = 'Username is required';
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }
    
    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = 'Phone number is required';
    } else if (!/^\+?[\d\s-]+$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Phone number is invalid';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    // Role validation (optional - uncomment if role is required)
    // if (!formData.role) newErrors.role = 'Role is required';

    // Company & Address
    if (!formData.companyName.trim()) newErrors.companyName = 'Company name is required';
    if (!formData.streetAddress.trim()) newErrors.streetAddress = 'Street address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.country.trim()) newErrors.country = 'Country is required';

    return newErrors;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const newErrors = validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);

    const response = await fetch("https://doctorassist.ai/api/hms/users/doctors/quality-checker/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(formData)
    });

    const result = await response.json();
    console.log("resultttt:", result);

    if (!response.ok) {
      setErrors({ submit: result.message });
    } else {
      setRegistrationSuccess(true);
    }
    setIsSubmitting(false);
  };

  if (registrationSuccess) {
    return (
      <div style={styles.successContainer}>
        <h2 style={styles.successTitle}>Registration Successful!</h2>
        <p style={styles.successText}>
          Thank you for registering as a{' '}
          {formData.role === 'quality-checker' ? 'Quality Checker' : 'Field Officer'}.
        </p>
        <button 
          style={styles.successButton}
          onClick={() => setRegistrationSuccess(false)}
        >
          Register Another User
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>
        User Registration
        <span style={styles.roleBadge}>
          {formData.role === 'quality-checker' ? 'Quality Checker' : 'Field Officer'}
        </span>
      </h1>
      <p style={styles.description}>Please fill in all required fields to register</p>
      
      <form style={styles.form} onSubmit={handleSubmit}>
        {/* Personal Information Section */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Personal Information</h2>
          
          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}>Full Name *</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                style={{...styles.input, ...(errors.fullName ? styles.inputError : {})}}
                placeholder="John Doe"
              />
              {errors.fullName && <span style={styles.errorMessage}>{errors.fullName}</span>}
            </div>

            <div style={styles.group}>
              <label style={styles.label}>Username *</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                style={{...styles.input, ...(errors.username ? styles.inputError : {})}}
                placeholder="johndoe"
              />
              {errors.username && <span style={styles.errorMessage}>{errors.username}</span>}
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}>Email Address *</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                style={{...styles.input, ...(errors.email ? styles.inputError : {})}}
                placeholder="john.doe@company.com"
              />
              {errors.email && <span style={styles.errorMessage}>{errors.email}</span>}
            </div>

            <div style={styles.group}>
              <label style={styles.label}>Phone Number *</label>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                style={{...styles.input, ...(errors.phoneNumber ? styles.inputError : {})}}
                placeholder="+1 234 567 8900"
              />
              {errors.phoneNumber && <span style={styles.errorMessage}>{errors.phoneNumber}</span>}
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}>Password *</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                style={{...styles.input, ...(errors.password ? styles.inputError : {})}}
                placeholder="Minimum 8 characters"
              />
              {errors.password && <span style={styles.errorMessage}>{errors.password}</span>}
            </div>

            <div style={styles.group}>
              <label style={styles.label}>Confirm Password *</label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                style={{...styles.input, ...(errors.confirmPassword ? styles.inputError : {})}}
                placeholder="Re-enter password"
              />
              {errors.confirmPassword && <span style={styles.errorMessage}>{errors.confirmPassword}</span>}
            </div>
          </div>
        </div>

        {/* Role Selection Section */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Role Selection</h2>
          
          <div style={styles.group}>
            <label style={styles.label}>Select User Role *</label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              style={{...styles.select, ...(errors.role ? styles.inputError : {})}}
            >
              <option value="quality-checker">Quality Checker</option>
              <option value="field-officer">Field Officer</option>
            </select>
            {errors.role && <span style={styles.errorMessage}>{errors.role}</span>}
          </div>

          {/* Role-specific description */}
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: formData.role === 'quality-checker' ? '#fff3cd' : '#cce5ff',
            borderRadius: '4px',
            color: formData.role === 'quality-checker' ? '#856404' : '#004085',
            fontSize: '0.9rem'
          }}>
            {formData.role === 'quality-checker' 
              ? '🔍 As a Quality Checker, you will be responsible for inspecting and verifying product quality, conducting tests, and ensuring compliance with standards.'
              : '📋 As a Field Officer, you will be responsible for on-site inspections, data collection, and coordinating with teams in the field.'}
          </div>
        </div>

        {/* Company & Address Section */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Company & Address Information</h2>
          
          <div style={styles.group}>
            <label style={styles.label}>Company Name *</label>
            <input
              type="text"
              name="companyName"
              value={formData.companyName}
              onChange={handleChange}
              style={{...styles.input, ...(errors.companyName ? styles.inputError : {})}}
              placeholder="ABC Manufacturing Ltd."
            />
            {errors.companyName && <span style={styles.errorMessage}>{errors.companyName}</span>}
          </div>

          <div style={styles.group}>
            <label style={styles.label}>Street Address *</label>
            <input
              type="text"
              name="streetAddress"
              value={formData.streetAddress}
              onChange={handleChange}
              style={{...styles.input, ...(errors.streetAddress ? styles.inputError : {})}}
              placeholder="123 Industrial Avenue"
            />
            {errors.streetAddress && <span style={styles.errorMessage}>{errors.streetAddress}</span>}
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}>City *</label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleChange}
                style={{...styles.input, ...(errors.city ? styles.inputError : {})}}
                placeholder="New York"
              />
              {errors.city && <span style={styles.errorMessage}>{errors.city}</span>}
            </div>

            <div style={styles.group}>
              <label style={styles.label}>State/Province</label>
              <input
                type="text"
                name="state"
                value={formData.state}
                onChange={handleChange}
                style={styles.input}
                placeholder="NY"
              />
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}>Postal/Zip Code</label>
              <input
                type="text"
                name="postalCode"
                value={formData.postalCode}
                onChange={handleChange}
                style={styles.input}
                placeholder="10001"
              />
            </div>

            <div style={styles.group}>
              <label style={styles.label}>Country *</label>
              <input
                type="text"
                name="country"
                value={formData.country}
                onChange={handleChange}
                style={{...styles.input, ...(errors.country ? styles.inputError : {})}}
                placeholder="United States"
              />
              {errors.country && <span style={styles.errorMessage}>{errors.country}</span>}
            </div>
          </div>
        </div>

        {/* Submit Section */}
        <div style={{ textAlign: 'center' }}>
          {errors.submit && <div style={styles.globalError}>{errors.submit}</div>}
          
          <button 
            type="submit" 
            disabled={isSubmitting}
            style={{...styles.submitButton, ...(isSubmitting ? styles.submitButtonDisabled : {})}}
          >
            {isSubmitting ? 'Registering...' : 'Register'}
          </button>
          
          <p style={styles.requiredNote}>* Required fields</p>
        </div>
      </form>
    </div>
  );
};

export default QualityCheckerRegistration;