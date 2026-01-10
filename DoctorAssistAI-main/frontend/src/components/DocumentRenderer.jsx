import React from "react";
import {
  Box,
  Typography,
  Divider
} from "@mui/material";

import SectionCard from "./SectionCard";
import KeyValueTable from "./KeyValueTable";

/**
 * DocumentRenderer
 * ------------------------------------
 * Universal medical document renderer
 *
 * Supports:
 * - Discharge Summary
 * - Referral Letter
 * - Clinical Notes
 * - Progress Notes
 *
 * Doctor selects DATA
 * System selects COMPONENT
 */

export default function DocumentRenderer({ document }) {
  if (!document) return null;

  const { title, meta, sections } = document;

  return (
    <Box
      sx={{
        maxWidth: 900,
        mx: "auto",
        pb: 4,
        fontFamily: "'Inter', sans-serif"
      }}
    >
      {/* ================= HEADER ================= */}
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{
            fontSize: "20px",
            fontWeight: 800,
            letterSpacing: "-0.02em"
          }}
        >
          {title}
        </Typography>

        {meta && (
          <Typography
            sx={{
              mt: 0.5,
              fontSize: "12px",
              color: "#64748b"
            }}
          >
            {meta}
          </Typography>
        )}
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* ================= SECTIONS ================= */}
      {sections.map((section, index) => (
        <RenderSection key={index} section={section} />
      ))}
    </Box>
  );
}

/* ================================================= */
/* ================= SECTION LOGIC ================= */
/* ================================================= */

function RenderSection({ section }) {
  const { title, type, data } = section;

  /**
   * REAL-WORLD RULE ENGINE
   * ----------------------
   * Decide UI based on DATA SHAPE
   */

  // 1️⃣ TABLE (Labs, Medication lists, Vitals history)
  if (type === "table" || isTabularData(data)) {
    return <KeyValueTable title={title} data={data} />;
  }

  // 2️⃣ TEXT / NARRATIVE (Discharge notes, referral letter)
  if (type === "text") {
    return (
      <SectionCard title={title}>
        <Typography sx={{ fontSize: "14px", lineHeight: 1.7 }}>
          {data}
        </Typography>
      </SectionCard>
    );
  }

  // 3️⃣ DEFAULT → SMART OBJECT VIEW
  return (
    <SectionCard title={title} data={data} />
  );
}

/* ================================================= */
/* ================= SMART HELPERS ================= */
/* ================================================= */

function isTabularData(data) {
  /**
   * Detects if data SHOULD be a table
   *
   * ✔ Array of objects
   * ✔ All rows have similar keys
   */
  if (!Array.isArray(data)) return false;
  if (typeof data[0] !== "object") return false;

  const keys = Object.keys(data[0]);
  return data.every(
    row =>
      typeof row === "object" &&
      Object.keys(row).length === keys.length
  );
}
