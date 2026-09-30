import React, { useEffect } from "react";
import { usePulmonology } from "../context/PulmonologyContext";

/**
 * FormField Component
 * Reusable field component matching Nephrology FormField design system exactly.
 * Automatically self-registers with the dynamic voice dictation registry on mount.
 */
const FormField = ({
  label,
  name,
  type = "text", // 'text', 'select', 'date', 'derived', 'textarea'
  options = [],
  value: explicitValue,
  onChange: explicitOnChange,
  derivedValue,
  placeholder,
  unit = "",
  hint = "",
  subFields = [],
  style = {},
  inputStyle = {},
}) => {
  const { formData, updateField, registerField } = usePulmonology();

  // Auto-register this FormField with the dynamic voice dictation registry on mount
  useEffect(() => {
    if (!name || type === "derived" || !registerField) return undefined;
    const cleanOptions = (options || [])
      .map((opt) => (typeof opt === "object" ? opt.value : opt))
      .filter((opt) => opt !== undefined && opt !== null && String(opt).trim());

    return registerField({
      k: name,
      name,
      label: label || name,
      type,
      options: cleanOptions,
      unit,
      placeholder,
      hint,
      subFields,
    });
  }, [name, label, type, options, unit, placeholder, hint, registerField]);

  // If explicit value/onChange passed, use them; otherwise bind to Context formData[name]
  const val = explicitValue !== undefined ? explicitValue : (name ? formData[name] || "" : "");

  const handleChange = (e) => {
    const newVal = e.target.value;
    if (explicitOnChange) {
      explicitOnChange(newVal);
    } else if (name) {
      updateField(name, newVal);
    }
  };

  const commonInputStyle = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: '"Open Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: "13px",
    padding: "8px 10px",
    height: type === "textarea" ? "auto" : "36px",
    border: "1px solid #d0d0d0",
    borderRadius: "2px",
    background: "#ffffff",
    color: "#000000",
    outline: "none",
    transition: "border-color 0.15s ease",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", ...style }}>
      {label && (
        <label
          style={{
            fontSize: "10.5px",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "#666666",
            minHeight: "26px", // Guarantees inputs align even with 2-line labels
            display: "flex",
            alignItems: "flex-end",
            lineHeight: "1.25",
          }}
        >
          {label}
        </label>
      )}

      {type === "derived" ? (
        <div
          style={{
            ...commonInputStyle,
            display: "flex",
            alignItems: "center",
            background: "#f7f7f7",
            borderColor: "#e0e0e0",
            color: "#333333",
            fontWeight: 500,
          }}
        >
          {derivedValue || val}
        </div>
      ) : type === "select" ? (
        <select
          value={val}
          onChange={handleChange}
          style={{
            ...commonInputStyle,
            cursor: "pointer",
            color: val ? "#000000" : "#888888",
          }}
        >
          {!options.some((opt) => (typeof opt === "object" ? opt.value === "" : opt === "")) && (
            <option value="">{placeholder || "-- Select --"}</option>
          )}
          {options.map((opt, i) => {
            const optVal = typeof opt === "object" ? opt.value : opt;
            const optLabel = typeof opt === "object" ? opt.label : opt;
            return (
              <option key={i} value={optVal}>
                {optLabel}
              </option>
            );
          })}
        </select>
      ) : type === "checkbox" ? (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: "36px",
            cursor: "pointer",
            fontSize: "12.5px",
            color: "#222222",
            userSelect: "none",
            ...inputStyle,
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(val)}
            onChange={(e) => {
              const checked = e.target.checked;
              if (explicitOnChange) {
                explicitOnChange(checked);
              } else if (name) {
                updateField(name, checked);
              }
            }}
            style={{
              width: "16px",
              height: "16px",
              cursor: "pointer",
              accentColor: "#000000",
            }}
          />
          <span>{placeholder || "Yes / Confirmed"}</span>
        </label>
      ) : type === "textarea" ? (
        <textarea
          value={val}
          onChange={handleChange}
          placeholder={placeholder}
          style={{
            ...commonInputStyle,
            minHeight: "80px",
            resize: "vertical",
            ...inputStyle,
          }}
        />
      ) : (
        <input
          type={type}
          value={val}
          onChange={handleChange}
          placeholder={placeholder}
          style={commonInputStyle}
        />
      )}
    </div>
  );
};

export default FormField;
