import React, { useState } from "react";

const fields = [
  "NO",
  "Manager Name",
  "Claim Received through",
  "State",
  "State Manager",
  "ALLOCATION RECEIVED FROM COMPANY",
  "CLAIM NUMBER",
  "COMPANY name",
  "TYPE OF CLAIM",
  "ALLOCATION TYPE",
  "NUM",
  "Name",
  "CLAIM VALUE",
  "HOSPITAL NAME",
  "STATE",
  "Allocated Date",
  "Month",
  "ALLOCATED BY (EXECUTIVES)",
  "ALLOCATION TAT",
  "ALLOCATED STATUS",
  "Remarks if Any"
];

// 🔽 Initial dropdown options
const initialDropdowns = {
  State: ["Karnataka", "Maharashtra", "Tamil Nadu", "Delhi"],
  "Claim Received through": ["Email", "Portal", "Manual"],
  "TYPE OF CLAIM": ["Cashless", "Reimbursement"],
  "ALLOCATION TYPE": ["Auto", "Manual"],
  "ALLOCATED STATUS": ["Pending", "Allocated", "Completed"],
  Month: [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ]
};

const getQcIdFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("qc_id");
};

export default function AllocationForm() {
  const [formData, setFormData] = useState({});
  const [dropdownOptions, setDropdownOptions] = useState(initialDropdowns);
  const [otherInput, setOtherInput] = useState({});

  const handleChange = (e, field) => {
    setFormData({
      ...formData,
      [field]: e.target.value
    });
  };

  const handleOtherSelect = (field) => {
    setFormData({
      ...formData,
      [field]: "Other"
    });
  };

  const addNewOption = (field) => {
    const newValue = otherInput[field];
    if (!newValue || !newValue.trim()) return;

    setDropdownOptions((prev) => ({
      ...prev,
      [field]: [...prev[field], newValue.trim()]
    }));

    setFormData({
      ...formData,
      [field]: newValue.trim()
    });

    setOtherInput({
      ...otherInput,
      [field]: ""
    });
  };

  const handleSubmit = async (e) => {
  e.preventDefault();

  try {
    const qc_id = getQcIdFromUrl();

    // ✅ Combine form data + qc_id
    const payload = {
      ...formData,
      qc_id: qc_id
    };

    console.log("Submitting to backend...");
    console.log(JSON.stringify(payload, null, 2));

    const response = await fetch("https://doctorassist.ai/api/hms/users/data/context/allocation/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    console.log("Backend Response:", result);

    if (response.ok) {
      alert("Form submitted successfully!");
      setFormData({});
    } else {
      alert("Error submitting form");
    }

  } catch (error) {
    console.error("Submission Error:", error);
    alert("Something went wrong!");
  }
};

  const getInputType = (field) => {
    if (field.toLowerCase().includes("date")) return "date";
    if (field.toLowerCase().includes("value") || field === "NUM") return "number";
    return "text";
  };

  const getFieldCategory = (field) => {
    if (["NO", "NUM"].includes(field)) return "id";
    if (["Manager Name", "State Manager", "ALLOCATED BY (EXECUTIVES)"].includes(field)) return "person";
    if (["CLAIM NUMBER", "CLAIM VALUE", "TYPE OF CLAIM"].includes(field)) return "claim";
    if (["COMPANY name", "HOSPITAL NAME"].includes(field)) return "organization";
    if (["Allocated Date", "Month", "ALLOCATION TAT"].includes(field)) return "date";
    return "general";
  };

  const getFieldColor = (category) => {
    const colors = {
      id: "bg-purple-50 border-purple-200",
      person: "bg-blue-50 border-blue-200",
      claim: "bg-green-50 border-green-200",
      organization: "bg-orange-50 border-orange-200",
      date: "bg-pink-50 border-pink-200",
      general: "bg-gray-50 border-gray-200"
    };
    return colors[category] || colors.general;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Central Allocation Form</h1>
              <p className="text-gray-600 mt-2">Manage and track claim allocations efficiently</p>
            </div>
            <div className="bg-white px-6 py-3 rounded-lg shadow-sm">
              <span className="text-sm text-gray-600">Total Fields</span>
              <span className="ml-2 text-2xl font-bold text-blue-600">{fields.length}</span>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="mt-6 bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Form Progress</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full">
                <div 
                  className="h-2 bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${(Object.keys(formData).length / fields.length) * 100}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600">
                {Object.keys(formData).length}/{fields.length} fields filled
              </span>
            </div>
          </div>
        </div>

        {/* Form Section */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {fields.map((field, index) => {
              const category = getFieldCategory(field);
              const bgColor = getFieldColor(category);
              
              return (
                <div 
                  key={index} 
                  className={`group relative bg-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 border ${bgColor}`}
                >
                  <div className="p-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      {field}
                      {formData[field] && (
                        <span className="ml-2 text-green-500">✓</span>
                      )}
                    </label>

                    {/* Dropdown fields */}
                    {dropdownOptions[field] ? (
                      <div className="space-y-2">
                        <select
                          value={formData[field] || ""}
                          onChange={(e) =>
                            e.target.value === "Other"
                              ? handleOtherSelect(field)
                              : handleChange(e, field)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                        >
                          <option value="">Select {field}</option>
                          {dropdownOptions[field].map((opt, i) => (
                            <option key={i} value={opt}>
                              {opt}
                            </option>
                          ))}
                          <option value="Other" className="text-blue-600">+ Add New</option>
                        </select>

                        {/* "Other" input section */}
                        {formData[field] === "Other" && (
                          <div className="flex gap-2 animate-fadeIn">
                            <input
                              type="text"
                              placeholder={`Enter new ${field}`}
                              value={otherInput[field] || ""}
                              onChange={(e) =>
                                setOtherInput({
                                  ...otherInput,
                                  [field]: e.target.value
                                })
                              }
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => addNewOption(field)}
                              disabled={!otherInput[field]?.trim()}
                              className={`px-4 py-2 rounded-md font-medium transition-all duration-200 ${
                                otherInput[field]?.trim()
                                  ? "bg-green-600 text-white hover:bg-green-700"
                                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
                              }`}
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Manual input fields */
                      <input
                        type={getInputType(field)}
                        value={formData[field] || ""}
                        onChange={(e) => handleChange(e, field)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                        placeholder={`Enter ${field.toLowerCase()}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setFormData({})}
              className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200"
            >
              Clear All
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 flex items-center gap-2"
            >
              <span>Submit Form</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </form>

        {/* Summary Section (Optional) */}
        {Object.keys(formData).length > 0 && (
          <div className="mt-8 bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Form Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-blue-50 rounded-lg">
                <span className="text-xs text-blue-600 font-medium">TOTAL FIELDS</span>
                <p className="text-xl font-bold text-blue-700">{fields.length}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <span className="text-xs text-green-600 font-medium">FILLED</span>
                <p className="text-xl font-bold text-green-700">{Object.keys(formData).length}</p>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <span className="text-xs text-yellow-600 font-medium">PENDING</span>
                <p className="text-xl font-bold text-yellow-700">{fields.length - Object.keys(formData).length}</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <span className="text-xs text-purple-600 font-medium">COMPLETION</span>
                <p className="text-xl font-bold text-purple-700">
                  {Math.round((Object.keys(formData).length / fields.length) * 100)}%
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add custom animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}