import React from "react";
import { useNephrology } from "../context/NephrologyContext";

/**
 * FormField Component
 * Reusable field component that handles labels, standard text/date inputs, dropdowns, and derived values.
 * Ensures consistent input heights (36px) and label alignments across all columns.
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
  style = {},
  inputStyle = {},
}) => {
  const { formData, updateField, sessionStatus } = useNephrology();
  const isReadOnly = sessionStatus === "completed";

  // If explicit value/onChange passed, use them; otherwise bind to Context formData[name]
  const val = explicitValue !== undefined ? explicitValue : formData[name] || "";

  const handleChange = (e) => {
    if (isReadOnly) return;
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
    fontSize: "13.5px",
    padding: "8px 12px",
    height: type === "textarea" ? "auto" : "40px",
    border: "1px solid #d1d5db",
    borderRadius: "3px",
    background: "#ffffff",
    color: "#111827",
    outline: "none",
    transition: "border-color 0.15s ease",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", ...style }}>
      {label && (
        <label
          style={{
            fontSize: "11.5px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "#374151",
            minHeight: "22px", // Guarantees inputs align even with 2-line labels
            display: "flex",
            alignItems: "flex-end",
            lineHeight: "1.3",
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
          disabled={isReadOnly}
          style={{
            ...commonInputStyle,
            cursor: "pointer",
          }}
        >
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
      ) : type === "textarea" ? (
        <textarea
          value={val}
          onChange={handleChange}
          disabled={isReadOnly}
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
          disabled={isReadOnly}
          placeholder={placeholder}
          style={commonInputStyle}
        />
      )}
    </div>
  );
};

export default FormField;

