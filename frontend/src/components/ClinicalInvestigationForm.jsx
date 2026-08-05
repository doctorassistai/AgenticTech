import React, { useState, useRef, useEffect } from "react";

const ClinicalInvestigationPage = () => {
  const [formSchema, setFormSchema] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const [customFieldCounter, setCustomFieldCounter] = useState(0);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  

  const inputRefs = useRef({});

  // Add CSS styles on component mount
  useEffect(() => {
    // Create and add CSS rules
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .suggestion-hint {
        color: #94a3b8;
        font-size: 13px;
        font-style: italic;
        margin-top: 4px;
        display: block;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  //////////////////////////////////////////////////////
  // 🔥 Fetch AI Form
  //////////////////////////////////////////////////////
  const fetchForm = async () => {
    setLoading(true);
    setError(null);
    setSubmitted(false);

    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

      const response = await fetch(
        `${API_BASE_URL}hms/users/orchestration/clinical-investigation-form-workflow`,
        {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
                    doctor_id,
                    patient_id,
                    investigation: {
                      investigation_type,
                      intent,
                    },
                  }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Handle different response structures
      let sections = [];
      
      if (data.finaloutput?.sections) {
        sections = data.finaloutput.sections;
      } else if (data.sections) {
        sections = data.sections;
      } else if (Array.isArray(data)) {
        sections = data;
      } else {
        sections = [{
          section_id: "order_documentation",
          title: "Investigation Order Details",
          fields: [
            {
              field_id: "clinical_indication",
              label: "Primary Clinical Question/Indication",
              type: "text",
              suggested_value: "Baseline hematological evaluation and monitoring for cytopenias"
            }
          ]
        }];
      }

      // Filter out unwanted fields and convert types
      const convertedSections = sections.map((section) => ({
        ...section,
        fields: (section.fields || [])
          .filter((f) => f.type !== "custom_field_builder" && f.type !== "builder")
          .map((field) => ({
            ...field,
            type: field.type === "textarea" ? "textarea" : "text",
            editable: true,
            // Get the actual value to pre-fill
            prefill_value: getPrefillValueFromField(field)
          })) || [],
      }));

      setFormSchema(convertedSections);

      // Initialize form data with suggested/default values AS ACTUAL VALUES
      const initialData = {};
      convertedSections.forEach((section) => {
        section.fields.forEach((field) => {
          // Pre-fill with the actual suggested value
          initialData[field.field_id] = field.prefill_value || "";
        });
      });

      setFormData(initialData);
      
    } catch (err) {
      console.error("Form generation error:", err);
      setError(`Failed to generate form: ${err.message}`);
      alert(`Failed to generate form. ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get pre-fill value from field suggestions
  const getPrefillValueFromField = (field) => {
    if (field.suggested_value) {
      return field.suggested_value;
    }
    if (field.default_value) {
      return field.default_value;
    }
    if (field.default_suggestion) {
      return field.default_suggestion;
    }
    if (field.options && Array.isArray(field.options)) {
      // Take the first option as default
      const firstOption = field.options[0];
      return typeof firstOption === 'object' ? firstOption.label || firstOption.value : firstOption;
    }
    return "";
  };

  // Helper function to get hint text (what used to be placeholder)
  const getHintFromField = (field) => {
    if (field.description) {
      return field.description;
    }
    if (field.rationale) {
      return field.rationale;
    }
    if (field.options && Array.isArray(field.options)) {
      const optionLabels = field.options.map(opt => 
        typeof opt === 'object' ? opt.label || opt.value : opt
      );
      return `Options: ${optionLabels.slice(0, 3).join(', ')}${optionLabels.length > 3 ? '...' : ''}`;
    }
    return "";
  };

  //////////////////////////////////////////////////////
  // 🔥 Handle Value Change
  //////////////////////////////////////////////////////
  const handleChange = (id, value) => {
    setFormData((prev) => ({
      ...prev,
      [id]: value,
    }));
  };

  //////////////////////////////////////////////////////
  // 🔥 Rename Field
  //////////////////////////////////////////////////////
  const renameField = (sectionId, fieldId) => {
    const currentField = formSchema
      .find(s => s.section_id === sectionId)
      ?.fields.find(f => f.field_id === fieldId);
    
    const newLabel = prompt("Enter new field name:", currentField?.label || "");
    if (!newLabel?.trim()) return;

    setFormSchema((prev) =>
      prev.map((section) =>
        section.section_id === sectionId
          ? {
              ...section,
              fields: section.fields.map((field) =>
                field.field_id === fieldId
                  ? { ...field, label: newLabel }
                  : field
              ),
            }
          : section
      )
    );
  };

  //////////////////////////////////////////////////////
  // 🔥 Delete Field
  //////////////////////////////////////////////////////
  const deleteField = (sectionId, fieldId) => {
    if (!window.confirm("Are you sure you want to delete this field?")) return;

    setFormSchema((prev) =>
      prev.map((section) =>
        section.section_id === sectionId
          ? {
              ...section,
              fields: section.fields.filter(
                (f) => f.field_id !== fieldId
              ),
            }
          : section
      )
    );

    setFormData((prev) => {
      const updated = { ...prev };
      delete updated[fieldId];
      return updated;
    });
  };

  //////////////////////////////////////////////////////
  // 🔥 Add Custom Field
  //////////////////////////////////////////////////////
  const addCustomFieldToSection2 = () => {
    const label = prompt("Enter custom field label:");
    if (!label?.trim()) return;

    const id = `custom_${Date.now()}_${customFieldCounter}`;

    const newField = {
      field_id: id,
      label: label.trim(),
      suggested_value: "",
      type: "text",
      custom: true, // Mark as custom field
      prefill_value: ""
    };

    setFormSchema((prev) =>
      prev.map((section) =>
        section.section_id === "order_documentation"
          ? { 
              ...section, 
              fields: [...section.fields, newField] 
            }
          : section
      )
    );

    setFormData((prev) => ({ ...prev, [id]: "" }));
    setCustomFieldCounter((p) => p + 1);
  };

  //////////////////////////////////////////////////////
  // 🔥 Clear Field Value (Reset to suggestion)
  //////////////////////////////////////////////////////
  const clearToSuggestion = (fieldId, field) => {
    if (window.confirm("Clear to AI suggestion?")) {
      const suggestion = getPrefillValueFromField(field);
      handleChange(fieldId, suggestion);
    }
  };

  //////////////////////////////////////////////////////
  // 🔥 Submit Form
  //////////////////////////////////////////////////////
  const submitForm = () => {
    console.log("Submitted Form Data:", formData);
    console.log("Form Schema:", formSchema);
    
    // Basic validation
    const requiredFields = formSchema?.flatMap(section => 
      section.fields?.filter(f => f.required) || []
    );
    
    const missingFields = requiredFields.filter(field => 
      !formData[field.field_id]?.trim()
    );
    
    if (missingFields.length > 0) {
      alert(`Please fill in required fields: ${missingFields.map(f => f.label).join(', ')}`);
      return;
    }
    
    // Here you would typically send to backend
    alert("Investigation submitted successfully!");
    setSubmitted(true);
  };

  //////////////////////////////////////////////////////
  // 🔥 Reset Form
  //////////////////////////////////////////////////////
  const resetForm = () => {
    if (window.confirm("Are you sure you want to reset the form?")) {
      setFormSchema(null);
      setFormData({});
      setSubmitted(false);
      setError(null);
    }
  };

  //////////////////////////////////////////////////////
  // 🔥 Focus on first field
  //////////////////////////////////////////////////////
  useEffect(() => {
    if (formSchema && formSchema.length > 0) {
      const firstFieldId = formSchema[0]?.fields?.[0]?.field_id;
      if (firstFieldId && inputRefs.current[firstFieldId]) {
        inputRefs.current[firstFieldId].focus();
      }
    }
  }, [formSchema]);

  //////////////////////////////////////////////////////
  // UI
  //////////////////////////////////////////////////////
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Clinical Investigation Form</h1> 
          <p style={styles.subtitle}></p>
        </div>
        
        <div style={styles.headerButtons}>
          {formSchema && (
            <button 
              style={styles.resetBtn} 
              onClick={resetForm}
            >
              Reset Form
            </button>
          )}
          <button 
            style={styles.generateBtn} 
            onClick={fetchForm}
            disabled={loading}
          >
            {loading ? "Generating..." : "Generate AI Form"}
          </button>
        </div>
      </div>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      {submitted && (
        <div style={styles.success}>
          Form submitted successfully! Check console for data.
        </div>
      )}

      {loading && (
        <div style={styles.loaderContainer}>
          <div style={styles.loader}></div>
          <p>Generating AI-powered clinical form...</p>
        </div>
      )}

      {formSchema && !loading && (
        <div style={styles.formContainer}>
          {formSchema.map((section) => (
            <div key={section.section_id} style={styles.section}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>{section.title}</h2>
                {section.description && (
                  <p style={styles.sectionDescription}>{section.description}</p>
                )}
              </div>

              {section.fields.length === 0 ? (
                <p style={styles.noFields}>No fields in this section</p>
              ) : (
                section.fields.map((field) => {
                  const hint = getHintFromField(field);
                  const hasSuggestion = field.suggested_value || field.default_value || field.default_suggestion;
                  
                  return (
                    <div key={field.field_id} style={styles.field}>
                      <div style={styles.fieldHeader}>
                        <div style={styles.fieldLabelContainer}>
                          <label style={styles.label}>
                            {field.label}
                            {field.required && <span style={styles.required}> *</span>}
                          </label>
                          {field.custom && (
                            <span style={styles.customBadge}>Custom</span>
                          )}
                          {hasSuggestion && (
                            <span style={styles.aiBadge}>AI Suggested</span>
                          )}
                        </div>

                        <div style={styles.fieldActions}>
                          {hasSuggestion && (
                            <button
                              style={styles.clearBtn}
                              onClick={() => clearToSuggestion(field.field_id, field)}
                              title="Reset to AI suggestion"
                            >
                              ↩️
                            </button>
                          )}
                          <button
                            style={styles.renameBtn}
                            onClick={() =>
                              renameField(
                                section.section_id,
                                field.field_id
                              )
                            }
                            title="Rename field"
                          >
                            ✏️
                          </button>

                          <button
                            style={styles.deleteBtn}
                            onClick={() =>
                              deleteField(
                                section.section_id,
                                field.field_id
                              )
                            }
                            title="Delete field"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {field.type === "textarea" ? (
                        <textarea
                          ref={(el) =>
                            (inputRefs.current[field.field_id] = el)
                          }
                          value={formData[field.field_id] || ""}
                          onChange={(e) =>
                            handleChange(field.field_id, e.target.value)
                          }
                          style={styles.textarea}
                          rows={4}
                        />
                      ) : (
                        <input
                          ref={(el) =>
                            (inputRefs.current[field.field_id] = el)
                          }
                          value={formData[field.field_id] || ""}
                          onChange={(e) =>
                            handleChange(field.field_id, e.target.value)
                          }
                          style={styles.input}
                          type={field.type === "number" ? "number" : "text"}
                        />
                      )}
                      
                      {hint && (
                        <span style={styles.hintText}>{hint}</span>
                      )}
                    </div>
                  );
                })
              )}

              {section.section_id === "order_documentation" && (
                <button
                  style={styles.addBtn}
                  onClick={addCustomFieldToSection2}
                >
                  ➕ Add Custom Field
                </button>
              )}
            </div>
          ))}

          <div style={styles.submitContainer}>
            <button style={styles.submitBtn} onClick={submitForm}>
              Submit Investigation Order
            </button>
            <p style={styles.submitNote}>
              AI suggestions are pre-filled. Edit as needed before submission.
            </p>
          </div>
        </div>
      )}

      {!formSchema && !loading && (
        <div style={styles.placeholder}>
          <div style={styles.placeholderIcon}>🩺</div>
          <h3>No Form Generated Yet</h3>
          <p>Click "Generate AI Form" to create a clinical investigation form with pre-filled AI suggestions.</p>
        </div>
      )}
    </div>
  );
};

export default ClinicalInvestigationPage;

////////////////////////////////////////////////////////
// 🎨 WHITE + CYAN GRADIENT MEDICAL UI
////////////////////////////////////////////////////////

const CYAN = "#06b6d4";
const CYAN_LIGHT = "#22d3ee";
const CYAN_SOFT = "#ecfeff";
const CYAN_DARK = "#0891b2";
const RED = "#ef4444";
const GREEN = "#10b981";
const CYAN_GRADIENT = `linear-gradient(135deg, ${CYAN_LIGHT}, ${CYAN})`;
const PURPLE = "#8b5cf6";
const PURPLE_GRADIENT = "linear-gradient(135deg, #a78bfa, #8b5cf6)";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: "40px 20px",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    maxWidth: "1200px",
    margin: "0 auto",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 40,
    flexWrap: "wrap",
    gap: "20px",
  },

  title: {
    fontSize: "32px",
    fontWeight: 700,
    color: "#1e293b",
    margin: 0,
    background: CYAN_GRADIENT,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },

  subtitle: {
    fontSize: "14px",
    color: "#64748b",
    margin: "8px 0 0 0",
    fontStyle: "italic",
  },

  headerButtons: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },

  generateBtn: {
    background: CYAN_GRADIENT,
    color: "#fff",
    border: "none",
    padding: "12px 24px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "14px",
    transition: "all 0.3s ease",
    minWidth: "160px",
    boxShadow: "0 4px 6px -1px rgba(6, 182, 212, 0.3)",
  },

  resetBtn: {
    background: "#f1f5f9",
    color: "#64748b",
    border: "1px solid #cbd5e1",
    padding: "12px 24px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "14px",
    transition: "all 0.2s",
  },

  loaderContainer: {
    textAlign: "center",
    padding: "60px 20px",
  },

  loader: {
    border: `4px solid ${CYAN_SOFT}`,
    borderTop: `4px solid ${CYAN}`,
    borderRadius: "50%",
    width: "40px",
    height: "40px",
    animation: "spin 1s linear infinite",
    margin: "0 auto 20px",
  },

  error: {
    background: "linear-gradient(135deg, #fee2e2, #fecaca)",
    color: RED,
    padding: "16px",
    borderRadius: "8px",
    marginBottom: "20px",
    border: `1px solid ${RED}20`,
  },

  success: {
    background: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
    color: GREEN,
    padding: "16px",
    borderRadius: "8px",
    marginBottom: "20px",
    border: `1px solid ${GREEN}20`,
  },

  formContainer: {
    background: "#fff",
    borderRadius: "12px",
    padding: "30px",
    border: `1px solid ${CYAN_SOFT}`,
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
  },

  section: {
    marginBottom: "40px",
    paddingBottom: "30px",
    borderBottom: `1px solid #e2e8f0`,
  },

  sectionHeader: {
    marginBottom: "24px",
  },

  sectionTitle: {
    background: CYAN_GRADIENT,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    fontSize: "20px",
    fontWeight: 600,
    margin: "0 0 8px 0",
  },

  sectionDescription: {
    color: "#64748b",
    fontSize: "14px",
    margin: 0,
  },

  field: {
    marginBottom: "24px",
    background: "linear-gradient(to right, #f8fafc, #f0f9ff)",
    padding: "20px",
    borderRadius: "8px",
    border: `1px solid #e2e8f0`,
    transition: "all 0.3s ease",
  },

  fieldHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
  },

  fieldLabelContainer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },

  label: {
    fontWeight: 600,
    color: "#1e293b",
    fontSize: "15px",
  },

  required: {
    color: RED,
  },

  customBadge: {
    background: CYAN_GRADIENT,
    color: "#fff",
    fontSize: "12px",
    padding: "2px 8px",
    borderRadius: "12px",
    fontWeight: 500,
  },

  aiBadge: {
    background: PURPLE_GRADIENT,
    color: "#fff",
    fontSize: "12px",
    padding: "2px 8px",
    borderRadius: "12px",
    fontWeight: 500,
  },

  fieldActions: {
    display: "flex",
    gap: "8px",
  },

  clearBtn: {
    background: "#f0f9ff",
    color: CYAN_DARK,
    border: `1px solid ${CYAN_LIGHT}`,
    padding: "6px 10px",
    cursor: "pointer",
    borderRadius: "6px",
    fontSize: "14px",
    transition: "all 0.2s",
  },

  renameBtn: {
    background: CYAN_SOFT,
    color: CYAN_DARK,
    border: `1px solid ${CYAN_LIGHT}`,
    padding: "6px 10px",
    cursor: "pointer",
    borderRadius: "6px",
    fontSize: "14px",
    transition: "all 0.2s",
  },

  deleteBtn: {
    background: "#fee2e2",
    color: RED,
    border: `1px solid #fca5a5`,
    padding: "6px 10px",
    cursor: "pointer",
    borderRadius: "6px",
    fontSize: "14px",
    transition: "all 0.2s",
  },

  input: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: "8px",
    border: `1px solid #cbd5e1`,
    fontSize: "15px",
    transition: "all 0.3s ease",
    boxSizing: "border-box",
    background: "#fff",
    color: "#1e293b", // Real text color
    "&:focus": {
      outline: "none",
      borderColor: CYAN,
      boxShadow: `0 0 0 3px rgba(6, 182, 212, 0.1)`,
    }
  },

  textarea: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: "8px",
    border: `1px solid #cbd5e1`,
    fontSize: "15px",
    fontFamily: "inherit",
    resize: "vertical",
    minHeight: "100px",
    boxSizing: "border-box",
    background: "#fff",
    color: "#1e293b", // Real text color
    "&:focus": {
      outline: "none",
      borderColor: CYAN,
      boxShadow: `0 0 0 3px rgba(6, 182, 212, 0.1)`,
    }
  },

  hintText: {
    color: "#94a3b8",
    fontSize: "13px",
    margin: "8px 0 0 0",
    fontStyle: "italic",
    display: "block",
  },

  noFields: {
    color: "#94a3b8",
    fontStyle: "italic",
    textAlign: "center",
    padding: "20px",
  },

  addBtn: {
    marginTop: "16px",
    background: CYAN_SOFT,
    color: CYAN_DARK,
    border: `2px dashed ${CYAN}`,
    padding: "12px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 500,
    width: "100%",
    fontSize: "14px",
    transition: "all 0.3s ease",
  },

  submitContainer: {
    textAlign: "center",
    marginTop: "40px",
    paddingTop: "30px",
    borderTop: `1px solid #e2e8f0`,
  },

  submitBtn: {
    background: CYAN_GRADIENT,
    color: "#fff",
    border: "none",
    padding: "16px 40px",
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "16px",
    transition: "all 0.3s ease",
    marginBottom: "12px",
    boxShadow: "0 4px 6px -1px rgba(6, 182, 212, 0.3)",
  },

  submitNote: {
    color: "#64748b",
    fontSize: "14px",
    margin: 0,
  },

  placeholder: {
    textAlign: "center",
    padding: "80px 20px",
    color: "#94a3b8",
  },

  placeholderIcon: {
    fontSize: "48px",
    marginBottom: "20px",
    background: CYAN_GRADIENT,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
};