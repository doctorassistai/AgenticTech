import React from "react";

/**
 * Section Component
 * Renders a styled section container with a header (dark or light variant) and body.
 */
const Section = ({ title, note, section, variant = "dark", children, style = {}, historyProps, historyKeys = [] }) => {
  const isDark = variant === "dark";

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        marginBottom: "16px",
        background: "#ffffff",
        ...style,
      }}
    >
      {/* Section Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 24px",
          background: isDark ? "#000000" : "#f5f5f5",
          color: isDark ? "#ffffff" : "#000000",
          borderBottom: isDark ? "none" : "1px solid #e0e0e0",
        }}
      >
        <h3
          style={{
            fontSize: isDark ? "14.5px" : "13.5px",
            fontWeight: 600,
            letterSpacing: "0.03em",
            textTransform: isDark ? "uppercase" : "none",
            margin: 0,
          }}
        >
          {title}
        </h3>
        {note && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: "11.5px",
              color: isDark ? "#9ca3af" : "#6b7280",
              fontWeight: 400,
            }}
          >
            {note}
          </span>
        )}
      </div>

      {/* Section Body */}
      <div style={{ padding: "20px 24px" }}>
        {children}
      </div>
    </div>
  );
};

export default Section;
