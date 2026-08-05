// synoptic/schemas/colorectal.js — CAP Colorectal Carcinoma Synoptic Schema
//
// Defines the field structure for the Synoptic Report tab. The renderer consumes
// this schema to generate sections + fields dynamically. Each section has a
// title and fields array; each field specifies type, label, options, etc.
//
// Based on CAP Colorectal Carcinoma Protocol v4.2.0.0 + WHO 5th Edition.

export const colorectalSchema = {
  site: "colorectal",
  version: "4.2.0.0",
  title: "CAP Synoptic Report - Colon & Rectum",

  sections: [
    {
      id: "procedure",
      title: "Procedure & Specimen Type",
      fields: [
        {
          key: "procedure",
          label: "Procedure",
          type: "select",
          required: true,
          options: [
            "Right hemicolectomy",
            "Left hemicolectomy",
            "Sigmoid colectomy",
            "Transverse colectomy",
            "Total colectomy",
            "High anterior resection",
            "Low anterior resection",
            "Proctocolectomy",
          ],
        },
        {
          key: "tumor_site",
          label: "Tumor Site",
          type: "select",
          required: true,
          fromGross: "tumor_location",
          options: [
            "Cecum",
            "Ascending colon",
            "Hepatic flexure",
            "Transverse colon",
            "Splenic flexure",
            "Descending colon",
            "Sigmoid colon",
            "Rectosigmoid",
            "Rectum",
          ],
        },
      ],
    },

    {
      id: "who_classification",
      title: "Tumor Type & Classification (WHO 5th Edition)",
      fields: [
        {
          key: "histologic_type",
          label: "Histologic Type",
          type: "text",
          required: true,
          placeholder: "e.g. Adenocarcinoma, NOS",
        },
        {
          key: "icdo_code",
          label: "ICD-O Code",
          type: "text",
          placeholder: "e.g. 8140/3",
        },
        {
          key: "clinical_findings",
          label: "Clinical Findings",
          type: "textarea",
          rows: 2,
          placeholder: "Pre-operative clinical context, symptoms, imaging...",
        },
        {
          key: "pathological_findings",
          label: "Pathological Findings",
          type: "textarea",
          rows: 3,
          placeholder: "Gross + microscopic diagnostic findings...",
        },
      ],
    },

    {
      id: "histologic_grade",
      title: "Histologic Grade",
      fields: [
        {
          key: "grade",
          label: "Grade",
          type: "select",
          required: true,
          options: [
            "G1: Well differentiated",
            "G2: Moderately differentiated",
            "G3: Poorly differentiated",
            "G4: Undifferentiated",
            "GX: Cannot be assessed",
          ],
        },
      ],
    },

    {
      id: "tumor_extent",
      title: "Tumor Size & Extent of Invasion",
      fields: [
        {
          key: "tumor_greatest_dimension_cm",
          label: "Greatest Dimension (cm)",
          type: "number",
          step: 0.1,
          required: true,
          fromGross: "tumor_greatest_dimension",
        },
        {
          key: "tumor_additional_dimensions",
          label: "Additional Dimensions",
          type: "text",
          placeholder: "e.g. 4.5 x 3.2",
          fromGross: "additional_dimensions",
        },
        {
          key: "depth_of_invasion",
          label: "Depth of Invasion (pT)",
          type: "select",
          required: true,
          options: [
            "Lamina propria",
            "Muscularis mucosae",
            "Submucosa (pT1)",
            "Muscularis propria (pT2)",
            "Subserosa / Pericolic fat (pT3)",
            "Visceral peritoneum penetration (pT4a)",
            "Adjacent organ involvement (pT4b)",
          ],
        },
      ],
    },

    {
      id: "margins",
      title: "Surgical Margins",
      note: "CAP requires documentation of all margin statuses and closest distance.",
      fields: [
        {
          key: "proximal_margin_status",
          label: "Proximal Margin Status",
          type: "select",
          required: true,
          options: [
            "Uninvolved by invasive carcinoma",
            "Involved by invasive carcinoma",
            "Cannot be assessed",
          ],
        },
        {
          key: "proximal_margin_distance_cm",
          label: "Proximal Margin Distance (cm)",
          type: "number",
          step: 0.1,
          fromGross: "proximal_margin",
        },
        {
          key: "distal_margin_status",
          label: "Distal Margin Status",
          type: "select",
          required: true,
          options: [
            "Uninvolved by invasive carcinoma",
            "Involved by invasive carcinoma",
            "Cannot be assessed",
          ],
        },
        {
          key: "distal_margin_distance_cm",
          label: "Distal Margin Distance (cm)",
          type: "number",
          step: 0.1,
          fromGross: "distal_margin",
        },
        {
          key: "circumferential_margin_status",
          label: "Circumferential (Radial) Margin Status",
          type: "select",
          options: [
            "Not applicable",
            "Uninvolved by invasive carcinoma",
            "Involved by invasive carcinoma",
            "Cannot be assessed",
          ],
        },
        {
          key: "circumferential_margin_distance_cm",
          label: "Circumferential Margin Distance (cm)",
          type: "number",
          step: 0.1,
          fromGross: "radial_margin",
        },
      ],
    },

    {
      id: "lymph_nodes",
      title: "Regional Lymph Nodes",
      note: "CAP requires ≥12 lymph nodes for adequate colorectal staging.",
      fields: [
        {
          key: "total_nodes_examined",
          label: "Total Lymph Nodes Examined",
          type: "number",
          required: true,
          min: 0,
          fromGross: "total_lymph_nodes",
        },
        {
          key: "positive_nodes",
          label: "Number of Positive Nodes",
          type: "number",
          required: true,
          min: 0,
        },
        {
          key: "lymph_node_stations",
          label: "Lymph Node Stations/Groups",
          type: "text",
          placeholder: "e.g. pericolic, inferior mesenteric",
          fromGross: "lymph_node_stations",
        },
      ],
    },

    {
      id: "additional_findings",
      title: "Additional Pathologic Findings (Optional)",
      fields: [
        {
          key: "lymphovascular_invasion",
          label: "Lymphovascular Invasion",
          type: "select",
          options: [
            "Not identified",
            "Present",
            "Indeterminate",
          ],
        },
        {
          key: "perineural_invasion",
          label: "Perineural Invasion",
          type: "select",
          options: [
            "Not identified",
            "Present",
            "Indeterminate",
          ],
        },
        {
          key: "tumor_deposits",
          label: "Tumor Deposits (Satellite Nodules)",
          type: "select",
          options: [
            "Not identified",
            "Present",
            "Cannot be determined",
          ],
        },
        {
          key: "tumor_deposits_number",
          label: "Number of Tumor Deposits",
          type: "number",
          min: 0,
        },
      ],
    },
  ],
};
