import React, { useState, useMemo } from "react";
import Select from 'react-select';
import countryList from 'react-select-country-list';
// Update this path to your actual doctor laptop image
import doctorLaptopImage from '../assets/Gemini_Generated_Image_xijnbxijnbxijnbx.png';
import logoImage from "../assets/lodo_only.png";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function HospitalRegister() {
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    headquarters: "",
    username: "",
    email: "",
    password: "",
    phone_number: "",
    no_of_staff: "",
    no_of_beds: "",
    country_code: "IN",
    hospital_user_type: "da_user", // 'hms_integration', 'da_user', 'iframe_user'
  });

  const [message, setMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Setup for the country selector
  const countryOptions = useMemo(() => countryList().getData(), []);
  const [selectedCountry, setSelectedCountry] = useState(
    countryOptions.find(option => option.value === 'IN') // Default to India
  );

  const handleCountryChange = (selectedOption) => {
    setSelectedCountry(selectedOption);
    // Update the formData with the selected country's code
    setFormData(prevData => ({
      ...prevData,
      country_code: selectedOption ? selectedOption.value : 'IN'
    }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    
    // Convert numeric fields to numbers
    if (name === 'no_of_staff' || name === 'no_of_beds') {
      const numValue = value === '' ? '' : parseInt(value);
      setFormData({ ...formData, [name]: numValue });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleHospitalUserType = (type) => {
    setFormData({ ...formData, hospital_user_type: type });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!termsAccepted) {
      setMessage("Please accept the terms and conditions");
      return;
    }

    // Validate numeric fields
    if (!formData.no_of_staff || formData.no_of_staff <= 0) {
      setMessage("Please enter a valid staff count (minimum 1)");
      return;
    }

    if (!formData.no_of_beds || formData.no_of_beds <= 0) {
      setMessage("Please enter a valid bed count (minimum 1)");
      return;
    }

    // Prepare data for submission
    const submissionData = {
      name: formData.name,
      address: formData.address || null,
      headquarters: formData.headquarters || null,
      username: formData.username,
      password: formData.password,
      email: formData.email,
      phone_number: formData.phone_number,
      no_of_staff: parseInt(formData.no_of_staff),
      no_of_beds: parseInt(formData.no_of_beds),
      country_code: formData.country_code,
      hospital_user_type: formData.hospital_user_type,
    };
console.log("Submitting data:", submissionData);
    try {
      const res = await fetch(`${API_BASE_URL}/hms/users/hospitals/hospitaladd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Error registering hospital");
      }

      setMessage(data.message || "Hospital registered successfully!");

      // Reset form
      setFormData({
        name: "",
        address: "",
        headquarters: "",
        username: "",
        email: "",
        password: "",
        phone_number: "",
        no_of_staff: "",
        no_of_beds: "",
        country_code: "IN",
        hospital_user_type: "da_user",
      });
      setSelectedCountry(countryOptions.find(option => option.value === 'IN'));
      setTermsAccepted(false);
    } catch (err) {
      setMessage(err.message || "An error occurred during registration");
    }
  };

  // Custom styles for the react-select component
  const customSelectStyles = {
    control: (base) => ({
      ...base,
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(5px)',
      border: '1px solid rgba(209, 213, 219, 0.4)',
      borderRadius: '12px',
      minHeight: '52px',
      boxShadow: 'none',
      '&:hover': {
        borderColor: 'rgba(59, 130, 246, 0.5)',
      }
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: 'rgba(255, 255, 255, 0.98)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(209, 213, 219, 0.4)',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(31, 38, 135, 0.08)',
      overflow: 'hidden',
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected ? 'rgba(219, 234, 254, 0.7)' : 
                      state.isFocused ? 'rgba(219, 234, 254, 0.4)' : 
                      'transparent',
      color: '#1f2937',
      padding: '12px 16px',
    }),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4 font-sans">
      {/* CSS Styles remain the same */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        .glass-morphism { background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.4); box-shadow: 0 8px 32px rgba(31, 38, 135, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.3); }
        .glass-card { background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border: 1px solid rgba(209, 213, 219, 0.3); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04); }
        .input-glass { background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(5px); border: 1px solid rgba(209, 213, 219, 0.4); transition: all 0.2s ease; }
        .input-glass:focus { background: rgba(255, 255, 255, 1); border-color: rgba(59, 130, 246, 0.5); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        body { font-family: 'Inter', sans-serif; }
      `}</style>

      <div className="glass-morphism rounded-3xl overflow-hidden max-w-6xl w-full flex flex-col md:flex-row shadow-xl">
        
        {/* Left Side - Doctor Illustration (unchanged) */}
        <div className="md:w-2/5 relative overflow-hidden bg-gradient-to-b from-blue-100/20 to-blue-50/20">
          <div className="absolute inset-0 opacity-5">
            <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-300 rounded-full"></div>
            <div className="absolute -bottom-20 -right-20 w-80 h-80 bg-blue-200 rounded-full"></div>
          </div>
          
          <div className="relative z-10 h-full flex flex-col p-8 md:p-10">
            {/* Logo */}
            {/* Logo */}
<div className="flex items-center gap-3 mb-10">
  <div className="glass-card w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm">
    <div className="w-8 h-8 bg-gradient-to-br from-white-500 to-white-600 rounded-xl flex items-center justify-center">
      <img 
        src={logoImage} 
        alt="Logo" 
        className="w-7 h-7 object-contain"
      />
    </div>
  </div>

  <div>
    <div className="text-lg font-semibold text-gray-900 tracking-tight">
      DoctorAssist.AI
    </div>
    <div className="text-xs text-blue-500 font-medium">
      HOSPITAL NETWORK
    </div>
  </div>
</div>

            
            {/* Doctor Image */}
            <div className="flex-1 flex flex-col justify-center items-center text-center">
              <div className="relative mb-8 w-full max-w-xs">
                <div className="glass-card rounded-3xl p-4 relative overflow-hidden">
                  <div className="w-full aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-white to-blue-50/50">
                    <img 
                      src={doctorLaptopImage} 
                      alt="Healthcare professional using digital platform" 
                      className="w-full h-full object-cover object-center"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        const parentDiv = e.target.parentElement;
                        parentDiv.innerHTML = `
                          <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
                            <div class="text-center p-6">
                              <svg class="w-24 h-24 text-blue-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              <p class="text-blue-800 font-medium">Digital Healthcare Platform</p>
                            </div>
                          </div>
                        `;
                      }}
                    />
                  </div>
                </div>
              </div>
              
              <h2 className="text-2xl font-semibold text-gray-900 mb-3">Modern Healthcare Management</h2>
              <p className="text-gray-600 max-w-xs mb-8">Streamline operations with our integrated digital platform designed for medical institutions.</p>
            </div>
            
            <div className="text-center text-sm text-gray-500 mt-10 pt-6 border-t border-blue-200/30">
              <p>Join hundreds of institutions providing better care</p>
            </div>
          </div>
        </div>

        {/* Right Side - Form Section */}
        <div className="md:w-3/5 p-8 md:p-10">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Hospital Registration</h1>
            <p className="text-gray-600 text-sm">Complete your hospital details to get started</p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Column 1 */}
              <div className="space-y-5">
                <div>
                  <label className="block text-gray-700 mb-2 text-sm font-medium">
                    Hospital Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    placeholder="Enter hospital name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>

                
 <div>
                <label className="block text-gray-700 mb-2 text-sm font-medium">
                  Headquarters
                </label>
                <input
                  type="text"
                  name="headquarters"
                  placeholder="Headquarters location"
                  value={formData.headquarters}
                  onChange={handleChange}
                  className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
                <div>
                  <label className="block text-gray-700 mb-2 text-sm font-medium">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    name="email"
                    placeholder="hospital@example.com"
                    value={formData.email}
                    onChange={handleChange}
                    
                    className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 mb-2 text-sm font-medium">
                    Country Code *
                  </label>
                  <Select
                    options={countryOptions}
                    value={selectedCountry}
                    onChange={handleCountryChange}
                    styles={customSelectStyles}
                    className="text-sm"
                    isSearchable
                    placeholder="Select country"
                  />
                </div>
              </div>

              {/* Column 2 */}
              <div className="space-y-5">
                <div>
                  <label className="block text-gray-700 mb-2 text-sm font-medium">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    name="phone_number"
                    placeholder="123 456 7890"
                    value={formData.phone_number}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 mb-2 text-sm font-medium">
                    Address
                  </label>
                  <input
                    type="text"
                    name="address"
                    placeholder="Street address"
                    value={formData.address}
                    onChange={handleChange}
                    className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 mb-2 text-sm font-medium">
                      Staff Count *
                    </label>
                    <input
                      type="number"
                      name="no_of_staff"
                      placeholder="e.g., 150"
                      value={formData.no_of_staff}
                      onChange={handleChange}
                      required
                      min="1"
                      className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-2 text-sm font-medium">
                      Bed Count *
                    </label>
                    <input
                      type="number"
                      name="no_of_beds"
                      placeholder="e.g., 300"
                      value={formData.no_of_beds}
                      onChange={handleChange}
                      required
                      min="1"
                      className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                </div>

                {/* Hospital User Type Selection */}
                <div>
                  <label className="block text-gray-700 mb-2 text-sm font-medium">
                    Account Type *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleHospitalUserType("hms_integration")}
                      className={`px-3 py-3 rounded-xl border text-sm font-medium transition-all duration-200 flex items-center justify-center gap-1 ${
                        formData.hospital_user_type === "hms_integration"
                          ? "bg-blue-50 border-blue-400 text-blue-700 shadow-sm"
                          : "input-glass text-gray-600 hover:bg-blue-50/50"
                      }`}
                    >
                      <svg className={`w-4 h-4 ${formData.hospital_user_type === "hms_integration" ? "text-blue-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <span className="truncate">HMS</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleHospitalUserType("da_user")}
                      className={`px-3 py-3 rounded-xl border text-sm font-medium transition-all duration-200 flex items-center justify-center gap-1 ${
                        formData.hospital_user_type === "da_user"
                          ? "bg-blue-50 border-blue-400 text-blue-700 shadow-sm"
                          : "input-glass text-gray-600 hover:bg-blue-50/50"
                      }`}
                    >
                      <svg className={`w-4 h-4 ${formData.hospital_user_type === "da_user" ? "text-blue-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span className="truncate">Digital</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleHospitalUserType("iframe_user")}
                      className={`px-3 py-3 rounded-xl border text-sm font-medium transition-all duration-200 flex items-center justify-center gap-1 ${
                        formData.hospital_user_type === "iframe_user"
                          ? "bg-blue-50 border-blue-400 text-blue-700 shadow-sm"
                          : "input-glass text-gray-600 hover:bg-blue-50/50"
                      }`}
                    >
                      <svg className={`w-4 h-4 ${formData.hospital_user_type === "iframe_user" ? "text-blue-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z" />
                      </svg>
                      <span className="truncate">iFrame</span>
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {formData.hospital_user_type === "hms_integration" 
                      ? "Connect with existing Hospital Management System"
                      : formData.hospital_user_type === "da_user"
                      ? "Direct access to DoctorAssist.AI platform"
                      : "Embedded iFrame integration"}
                  </p>
                </div>
              </div>
            </div>

            {/* Additional Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div>
                  <label className="block text-gray-700 mb-2 text-sm font-medium">
                    Username *
                  </label>
                  <input
                    type="text"
                    name="username"
                    placeholder="Choose a username"
                    value={formData.username}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              <div>
                <label className="block text-gray-700 mb-2 text-sm font-medium">
                  Password *
                </label>
                <input
                  type="password"
                  name="password"
                  placeholder="Create a secure password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 input-glass rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              
            </div>

            {/* Terms and Conditions */}
            <div className="flex items-start space-x-3 pt-2">
              <input
                type="checkbox"
                id="terms"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-1 h-5 w-5 text-blue-500 rounded focus:ring-blue-300 focus:ring-offset-2 border-gray-300"
              />
              <label htmlFor="terms" className="text-gray-700 text-sm">
                I accept the{" "}
                <a href="#" className="text-blue-600 hover:text-blue-800 font-medium">
                  Terms and Conditions
                </a>{" "}
                &{" "}
                <a href="#" className="text-blue-600 hover:text-blue-800 font-medium">
                  Privacy Policy
                </a>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5"
            >
              Complete Registration
            </button>
          </form>

          {/* Message Display */}
          {message && (
            <div className={`mt-6 p-4 rounded-xl text-center font-medium ${
              message.includes("Error") || message.includes("Please") 
                ? "bg-red-50 text-red-600 border border-red-100" 
                : "bg-green-50 text-green-600 border border-green-100"
            }`}>
              <div className="flex items-center justify-center gap-2">
                {message.includes("Error") || message.includes("Please") ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span>{message}</span>
              </div>
            </div>
          )}

          {/* Footer Links */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <p className="text-gray-600 text-sm">
                Already have an account?{" "}
                <a href="#" className="text-blue-600 hover:text-blue-800 font-medium">
                  Sign in here
                </a>
              </p>
              
              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HospitalRegister;