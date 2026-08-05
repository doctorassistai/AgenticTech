// synoptic/schemaRegistry.js — Schema registry for site-specific synoptic reports
//
// Maps anatomic site identifiers to their respective synoptic schemas. Each
// schema defines the field structure for that site's CAP protocol. The renderer
// (SynopticReportTab.jsx) consumes these schemas to generate the form dynamically.
//
// USER-OWNED: This registry and the schemas/ directory are intentionally designed
// for user extension. To add a new site (e.g., breast, prostate, lung):
//   1. Create synoptic/schemas/<site>.js following the colorectal.js format.
//   2. Import and register it below.
//   3. No changes to SynopticReportTab.jsx are needed—it's schema-driven.

import { colorectalSchema } from "./schemas/colorectal";

// ─── Schema Format ───────────────────────────────────────────────────────────
// Each schema exports an object with:
//   {
//     site: "string",               // Unique identifier (used as the registry key)
//     version: "string",            // CAP protocol version
//     title: "string",              // Display title for the tab header
//     sections: [                   // Array of section definitions
//       {
//         id: "string",             // Unique section identifier
//         title: "string",          // Section heading
//         note: "string",           // Optional explanatory note (displayed below title)
//         fields: [                 // Array of field definitions
//           {
//             key: "string",        // Field key (saved to backend; must be unique within schema)
//             label: "string",      // Field label shown to the user
//             type: "text" | "textarea" | "select" | "number",
//             required: boolean,    // Optional; default false
//             placeholder: "string", // Optional
//             options: [string],    // Required for type: "select"
//             rows: number,         // Optional; for type: "textarea"
//             step: number,         // Optional; for type: "number"
//             min: number,          // Optional; for type: "number"
//             fromGross: "string",  // Optional; maps to a grossing field key for Import-from-Gross
//           },
//           ...
//         ],
//       },
//       ...
//     ],
//   }
//
// ─── Import-from-Gross Mapping ───────────────────────────────────────────────
// When a field includes `fromGross: "<grossing_key>"`, the "Import from Gross"
// button will auto-populate that synoptic field from the grossing data's
// corresponding key. Example:
//   Synoptic field `tumor_greatest_dimension_cm` with `fromGross: "tumor_greatest_dimension"`
//   imports the value from `grossing.tumor_greatest_dimension`.

export const schemaRegistry = {
  colorectal: colorectalSchema,
  // Add future sites here:
  // breast: breastSchema,
  // prostate: prostateSchema,
  // lung: lungSchema,
};

// ─── Default Site ────────────────────────────────────────────────────────────
// When no site is specified or the user's case doesn't indicate a site yet,
// fall back to this schema. Change this to match your institution's most common
// surgical pathology case type.
export const DEFAULT_SITE = "colorectal";

// ─── getSynopticSchema ───────────────────────────────────────────────────────
// Looks up a schema by site identifier; returns the default if not found.
export function getSynopticSchema(site) {
  return schemaRegistry[site] || schemaRegistry[DEFAULT_SITE];
}
