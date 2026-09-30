import React from "react";

/**
 * Section Component
 * Renders a styled section container matching Nephrology Section design system exactly.
 */
const Section = ({ id, title, note, variant = "dark", children, style = {} }) => {
  const isDark = variant === "dark";

  return (
    <div
      id={id}
      style={{
        border: "1px solid #e0e0e0",
        marginBottom: "16px",
        background: "#ffffff",
        scrollMarginTop: "24px",
        ...style,
      }}
    >
      {/* Section Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "10px 20px",
          background: isDark ? "#000000" : "#f5f5f5",
          color: isDark ? "#ffffff" : "#000000",
          borderBottom: isDark ? "none" : "1px solid #e0e0e0",
        }}
      >
        <h3
          style={{
            fontSize: isDark ? "14px" : "13px",
            fontWeight: 500,
            letterSpacing: "0.02em",
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
              fontSize: "10.5px",
              color: isDark ? "#888888" : "#666666",
              fontWeight: 300,
            }}
          >
            {note}
          </span>
        )}
      </div>

      {/* Section Body */}
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
};

export default Section;
