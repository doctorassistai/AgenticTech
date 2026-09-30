import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useLocation } from "react-router-dom";

import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  Alert,
} from "@mui/material";

import {
  RefreshRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
  AutoAwesomeRounded,
  ArticleOutlined,
} from "@mui/icons-material";

import DoctorSkillSection from "./DoctorSkillSection";

/* ============================================================
   CONFIGURATION
   ============================================================ */

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "";

/*
 * Backend router prefix: /pre-treatment-assessment-new
 *   POST /pre-treatment-assessment-new/generate/new
 *   GET  /pre-treatment-assessment-new/latest
 */
const PRETREATMENT_MOUNT =
  "hms/users/ai-legacy/pre-treatment-assessment-new";

const buildGenerateUrl = () =>
  `${API_BASE_URL}${PRETREATMENT_MOUNT}/generate/new`;

const buildLatestUrl = (patientId, doctorId, encounterId) => {
  const params = new URLSearchParams();

  params.set("patient_id", patientId);
  params.set("doctor_id", doctorId);

  if (encounterId) {
    params.set("encounter_id", encounterId);
  }

  return `${API_BASE_URL}${PRETREATMENT_MOUNT}/latest?${params.toString()}`;
};

/* ============================================================
   DESIGN TOKENS
   ============================================================ */

const FONT = '"Open Sans", sans-serif';

const M = {
  white: "#ffffff",
  paper: "#fafafa",
  fog: "#f3f3f3",
  mist: "#e8e8e8",
  border: "#d5d5d5",
  darkBorder: "#bdbdbd",

  ink: "#111111",
  charcoal: "#333333",
  smoke: "#5f5f5f",
  ash: "#858585",
  silver: "#aaaaaa",

  black: "#000000",
};

const page = {
  background: M.paper,
  minHeight: "100%",
};

const card = {
  background: M.white,
  border: `1px solid ${M.mist}`,
  borderRadius: "6px",
};

const os = (extra = {}) => ({
  fontFamily: FONT,
  ...extra,
});

const microLabel = os({
  fontSize: 10,
  fontWeight: 600,
  color: M.ash,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
});

/* ============================================================
   GENERIC VALUE HELPERS

   No clinical knowledge lives here. These helpers only
   inspect the *shape* of the data (string / number / array /
   object) and turn it into readable UI.
   ============================================================ */

const humanize = (value) => {
  if (value === null || value === undefined || value === "") {
    return "Not documented";
  }

  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value);

/*
 * Recursive: null, blank strings, empty arrays/objects, and
 * containers whose contents are all empty count as "no data".
 * Numbers (including 0) and booleans are real values.
 */
const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.every(isEmpty);
  if (isPlainObject(value)) return Object.values(value).every(isEmpty);
  return false;
};

/*
 * Stricter check used only to decide whether a whole section is
 * worth showing: a lone 0 / false (e.g. "needs_review: 0") is
 * not a reason to render a section by itself.
 */
const hasSignal = (value) => {
  if (isEmpty(value)) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(hasSignal);
  if (isPlainObject(value)) return Object.values(value).some(hasSignal);
  return true;
};

const sectionHasContent = (data) => {
  if (isPlainObject(data)) {
    const hasSummary =
      typeof data.summary === "string" && data.summary.trim() !== "";
    return (
      hasSummary ||
      Object.entries(data).some(
        ([key, val]) => key !== "summary" && hasSignal(val)
      )
    );
  }
  return hasSignal(data);
};

const isPrimitive = (value) =>
  value === null ||
  value === undefined ||
  ["string", "number", "boolean"].includes(typeof value);

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return "Not documented";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(", ");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, val]) => `${humanize(key)}: ${formatValue(val)}`)
      .join(" • ");
  }

  return String(value);
};

const formatDateTime = (value) => {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/* Returns the first non-empty value from a list of field names. */
const pickFirst = (obj, keys) => {
  for (const key of keys) {
    if (!isEmpty(obj?.[key])) return obj[key];
  }
  return "";
};

/* Union of keys across rows, minus columns that are empty in every row. */
const deriveColumns = (rows) => {
  const seen = [];

  rows.forEach((row) => {
    if (isPlainObject(row)) {
      Object.keys(row).forEach((key) => {
        if (!seen.includes(key)) seen.push(key);
      });
    }
  });

  return seen.filter((key) =>
    rows.some((row) => !isEmpty(row?.[key]))
  );
};

/* ============================================================
   GENERIC BADGE
   ============================================================ */

const DataBadge = ({ children }) => (
  <Chip
    label={children}
    size="small"
    variant="outlined"
    sx={{
      ...os({
        fontSize: 10.5,
        color: M.smoke,
      }),
      height: 26,
      borderColor: M.border,
      background: M.white,
      "& .MuiChip-label": {
        px: 1.1,
      },
    }}
  />
);

/* ============================================================
   EMPTY STATE
   ============================================================ */

const EmptyState = ({
  title,
  description,
  action,
  loading = false,
}) => (
  <Box
    sx={{
      ...card,
      minHeight: 300,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      p: 4,
    }}
  >
    <Box
      sx={{
        maxWidth: 600,
        width: "100%",
        textAlign: "center",
      }}
    >
      {loading ? (
        <CircularProgress
          size={30}
          thickness={2}
          sx={{
            color: M.black,
            mb: 2,
          }}
        />
      ) : (
        <Box
          sx={{
            width: 52,
            height: 52,
            mx: "auto",
            mb: 2,
            border: `1px solid ${M.border}`,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArticleOutlined
            sx={{
              fontSize: 24,
              color: M.smoke,
            }}
          />
        </Box>
      )}

      <Typography
        sx={{
          ...os({
            fontSize: 17,
            fontWeight: 500,
            color: M.ink,
            mb: 1,
          }),
        }}
      >
        {title}
      </Typography>

      <Typography
        sx={{
          ...os({
            fontSize: 12.5,
            color: M.ash,
            lineHeight: 1.7,
            mb: 2.5,
          }),
        }}
      >
        {description}
      </Typography>

      {action}
    </Box>
  </Box>
);

/* ============================================================
   ASSESSMENT POINT (existing behaviour preserved)

   Only addition: the backend "status" field is shown as a
   badge when present. Everything displayed comes from data.
   ============================================================ */

const AssessmentPointCard = ({ point, index }) => {
  const [expanded, setExpanded] = useState(true);

  const category = point?.category || "Assessment";

  const assessmentText =
    point?.point ||
    point?.assessment ||
    point?.finding ||
    point?.description ||
    "";

  const significance =
    point?.clinical_significance ||
    point?.significance ||
    point?.reason ||
    "";

  const supportingEvidence = Array.isArray(point?.supporting_evidence)
    ? point.supporting_evidence
    : [];

  const sources = Array.isArray(point?.source)
    ? point.source
    : point?.source
      ? [point.source]
      : [];

  const status = point?.status;

  const expandable = !isEmpty(significance);

  if (isEmpty(assessmentText) && !expandable) return null;

  return (
    <Box
      sx={{
        border: `1px solid ${M.mist}`,
        borderRadius: "6px",
        background: M.white,
        overflow: "hidden",
      }}
    >
      <Box
        onClick={
          expandable ? () => setExpanded((previous) => !previous) : undefined
        }
        sx={{
          px: { xs: 1.5, sm: 2 },
          py: 1,
          cursor: expandable ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          "&:hover": {
            background: expandable ? M.paper : "transparent",
          },
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              mb: 0.35,
              flexWrap: "wrap",
            }}
          >
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: M.ink,
                color: M.white,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Typography sx={{ ...os({ fontSize: 10, fontWeight: 600 }) }}>
                {index + 1}
              </Typography>
            </Box>

            <Typography
              sx={{
                ...os({
                  fontSize: 12,
                  fontWeight: 600,
                  color: M.ink,
                  letterSpacing: "0.02em",
                }),
              }}
            >
              {category}
            </Typography>

            {!isEmpty(status) && <DataBadge>{humanize(status)}</DataBadge>}
          </Box>

          {assessmentText && (
            <Typography
              sx={{
                ...os({
                  fontSize: 12.5,
                  color: M.charcoal,
                  lineHeight: 1.45,
                }),
              }}
            >
              {assessmentText}
            </Typography>
          )}
        </Box>

        {expandable && (
          <IconButton
            size="small"
            aria-label={expanded ? "Collapse assessment" : "Expand assessment"}
            sx={{ color: M.smoke, flexShrink: 0 }}
          >
            {expanded ? <ExpandLessRounded /> : <ExpandMoreRounded />}
          </IconButton>
        )}
      </Box>

      {expanded && expandable && (
        <Box
          sx={{
            borderTop: `1px solid ${M.mist}`,
            px: { xs: 1.5, sm: 2 },
            py: 1.25,
          }}
        >
          {significance && (
            <Box sx={{ mb: 1.25 }}>
              <Typography sx={{ ...microLabel, mb: 0.35 }}>
                Clinical Significance
              </Typography>

              <Typography
                sx={{
                  ...os({
                    fontSize: 12,
                    color: M.charcoal,
                    lineHeight: 1.45,
                  }),
                }}
              >
                {significance}
              </Typography>
            </Box>
          )}

        </Box>
      )}
    </Box>
  );
};

/* ============================================================
   GENERIC METADATA ROW
   ============================================================ */

const MetadataItem = ({ label, value }) => (
  <Box
    sx={{
      minWidth: 0,
      flex: 1,
      px: 2,
      py: 1.5,
      borderRight: `1px solid ${M.mist}`,
      "&:last-child": {
        borderRight: "none",
      },
    }}
  >
    <Typography sx={{ ...microLabel, fontSize: 9.5, mb: 0.45 }}>
      {label}
    </Typography>

    <Typography
      sx={{
        ...os({
          fontSize: 12,
          color: M.ink,
          lineHeight: 1.4,
          wordBreak: "break-word",
        }),
      }}
    >
      {formatValue(value)}
    </Typography>
  </Box>
);

/* ============================================================
   PREVISIT INSIGHTS — SCHEMA-DRIVEN RENDERERS

   Nothing below knows about a disease, a drug, a toxicity, a
   severity word or a status word. Layout decisions are made
   only from the SHAPE of the data:

     primitive        -> text
     array of prims   -> badges
     array of objects -> table (columns = union of keys)
     object           -> labelled key/value blocks (recursive)

   Whatever the backend adds later is rendered automatically.
   ============================================================ */

/* ---------- collapsible container ---------- */

const Collapsible = ({ title, count, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box
      sx={{
        border: `1px solid ${M.mist}`,
        borderRadius: "5px",
        overflow: "hidden",
      }}
    >
      <Box
        onClick={() => setOpen((previous) => !previous)}
        sx={{
          px: 1.5,
          py: 0.75,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          cursor: "pointer",
          background: M.paper,
          "&:hover": { background: M.fog },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography
            sx={{
              ...os({
                fontSize: 11.5,
                fontWeight: 600,
                color: M.charcoal,
              }),
            }}
          >
            {title}
          </Typography>

          {count !== undefined && count !== null && (
            <DataBadge>{count}</DataBadge>
          )}
        </Box>

        {open ? (
          <ExpandLessRounded sx={{ fontSize: 20, color: M.smoke }} />
        ) : (
          <ExpandMoreRounded sx={{ fontSize: 20, color: M.smoke }} />
        )}
      </Box>

      {open && (
        <Box sx={{ p: 1.25, borderTop: `1px solid ${M.mist}` }}>
          {children}
        </Box>
      )}
    </Box>
  );
};

/* ---------- table for an array of objects ---------- */

const DataTable = ({ rows: allRows }) => {
  const rows = allRows.filter((row) => !isEmpty(row));
  const columns = deriveColumns(rows);

  if (columns.length === 0) return null;

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box
        component="table"
        sx={{
          width: "100%",
          borderCollapse: "collapse",
          ...os({ fontSize: 12 }),
        }}
      >
        <Box component="thead">
          <Box component="tr">
            {columns.map((column) => (
              <Box
                component="th"
                key={column}
                sx={{
                  ...microLabel,
                  textAlign: "left",
                  px: 1.25,
                  py: 0.85,
                  background: M.paper,
                  borderBottom: `1px solid ${M.mist}`,
                  whiteSpace: "nowrap",
                }}
              >
                {humanize(column)}
              </Box>
            ))}
          </Box>
        </Box>

        <Box component="tbody">
          {rows.map((row, rowIndex) => (
            <Box
              component="tr"
              key={rowIndex}
              sx={{
                "&:last-child td": { borderBottom: "none" },
              }}
            >
              {columns.map((column) => (
                <Box
                  component="td"
                  key={column}
                  sx={{
                    px: 1.25,
                    py: 1,
                    color: M.charcoal,
                    lineHeight: 1.45,
                    verticalAlign: "top",
                    borderBottom: `1px solid ${M.mist}`,
                  }}
                >
                  {isEmpty(row?.[column]) ? (
                    <Box component="span" sx={{ color: M.silver }}>
                      —
                    </Box>
                  ) : (
                    formatValue(row[column])
                  )}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

/* ---------- universal renderer ---------- */

const GenericBlock = ({ value: rawValue, depth = 0 }) => {
  if (isEmpty(rawValue)) return null;

  const value = Array.isArray(rawValue)
    ? rawValue.filter((item) => !isEmpty(item))
    : rawValue;

  if (isPrimitive(value)) {
    return (
      <Typography
        sx={{
          ...os({
            fontSize: 12.5,
            color: M.charcoal,
            lineHeight: 1.55,
          }),
        }}
      >
        {formatValue(value)}
      </Typography>
    );
  }

  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) {
      return (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {value.map((item, itemIndex) => (
            <DataBadge key={itemIndex}>{formatValue(item)}</DataBadge>
          ))}
        </Box>
      );
    }

    if (value.every(isPlainObject)) {
      return <DataTable rows={value} />;
    }

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {value.map((item, itemIndex) => (
          <Typography
            key={itemIndex}
            sx={{ ...os({ fontSize: 12, color: M.charcoal }) }}
          >
            {formatValue(item)}
          </Typography>
        ))}
      </Box>
    );
  }

  /* plain object -> labelled blocks */
  const entries = Object.entries(value).filter(([, val]) => !isEmpty(val));

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        ...(depth > 0 && {
          pl: 1.5,
          borderLeft: `2px solid ${M.mist}`,
        }),
      }}
    >
      {entries.map(([key, val]) => (
        <Box key={key}>
          <Typography sx={{ ...microLabel, mb: 0.5 }}>
            {humanize(key)}
          </Typography>
          <GenericBlock value={val} depth={depth + 1} />
        </Box>
      ))}
    </Box>
  );
};

/* ---------- section shell ---------- */

const InsightSection = ({ title, subtitle, badges = [], children }) => (
  <Box sx={{ ...card, overflow: "hidden" }}>
    <Box
      sx={{
        px: { xs: 2, sm: 2.5 },
        py: 1.5,
        background: M.paper,
        borderBottom: `1px solid ${M.mist}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        flexWrap: "wrap",
      }}
    >
      <Box>
        <Typography
          sx={{
            ...os({
              fontSize: 13,
              fontWeight: 600,
              color: M.ink,
            }),
          }}
        >
          {title}
        </Typography>

        {subtitle && (
          <Typography
            sx={{
              ...os({
                fontSize: 11,
                color: M.ash,
                mt: 0.35,
              }),
            }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>

      {badges.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          {badges.map((badge, badgeIndex) => (
            <DataBadge key={badgeIndex}>{badge}</DataBadge>
          ))}
        </Box>
      )}
    </Box>

    <Box sx={{ p: { xs: 1.5, sm: 2 } }}>{children}</Box>
  </Box>
);

/* ---------- stat cards ---------- */

const visibleStatCards = (items) =>
  (Array.isArray(items) ? items : []).filter(
    (item) =>
      isPlainObject(item) &&
      !isEmpty(pickFirst(item, ["value", "text"]))
  );

const visibleAlerts = (items) =>
  (Array.isArray(items) ? items : []).filter(
    (item) =>
      isPlainObject(item) &&
      (!isEmpty(pickFirst(item, ["title", "label", "category"])) ||
        !isEmpty(pickFirst(item, ["text", "description", "message"])))
  );

const StatCards = ({ items }) => {
  const cards = visibleStatCards(items);
  if (cards.length === 0) return null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 1.25,
      }}
    >
      {cards.map((item, itemIndex) => {
        const label = pickFirst(item, ["label", "title", "name"]);
        const value = pickFirst(item, ["value", "text"]);
        const trend = item.trend;

        return (
          <Box key={itemIndex} sx={{ ...card, px: 2, py: 1.5 }}>
            <Typography sx={{ ...microLabel, fontSize: 9.5, mb: 0.6 }}>
              {label ? humanize(label) : "Metric"}
            </Typography>

            <Typography
              sx={{
                ...os({
                  fontSize: 15,
                  fontWeight: 600,
                  color: M.ink,
                  lineHeight: 1.35,
                  wordBreak: "break-word",
                }),
              }}
            >
              {formatValue(value)}
            </Typography>

            {!isEmpty(trend) && (
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: M.smoke,
                    mt: 0.5,
                  }),
                }}
              >
                {formatValue(trend)}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

/* ---------- alerts ---------- */

const AlertList = ({ items }) => {
  const alerts = visibleAlerts(items);
  if (alerts.length === 0) return null;

  return (
    <InsightSection
      title="Alerts"
      subtitle="Items flagged for review before the visit."
      badges={[`${alerts.length} ${alerts.length === 1 ? "alert" : "alerts"}`]}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {alerts.map((item, itemIndex) => {
          const title = pickFirst(item, ["title", "label", "category"]);
          const text = pickFirst(item, ["text", "description", "message"]);
          const severity = item.severity;
          const source = item.source;

          return (
            <Box
              key={itemIndex}
              sx={{
                border: `1px solid ${M.mist}`,
                borderLeft: `3px solid ${M.black}`,
                borderRadius: "4px",
                px: 1.75,
                py: 1.25,
                background: M.white,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  flexWrap: "wrap",
                  mb: 0.5,
                }}
              >
                <Typography
                  sx={{
                    ...os({
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: M.ink,
                    }),
                  }}
                >
                  {title || "Alert"}
                </Typography>

                {!isEmpty(severity) && (
                  <DataBadge>{humanize(severity)}</DataBadge>
                )}
              </Box>

              {text && (
                <Typography
                  sx={{
                    ...os({
                      fontSize: 12,
                      color: M.charcoal,
                      lineHeight: 1.5,
                    }),
                  }}
                >
                  {text}
                </Typography>
              )}

              {!isEmpty(source) && (
                <Typography
                  sx={{
                    ...os({
                      fontSize: 10.5,
                      color: M.ash,
                      mt: 0.75,
                    }),
                  }}
                >
                  Source: {formatValue(source)}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </InsightSection>
  );
};

/* ---------- next best action (single emphasised block) ---------- */

const NextBestAction = ({ data }) => {
  if (isEmpty(data)) return null;

  const text = isPrimitive(data)
    ? data
    : pickFirst(data, ["text", "action", "summary", "description"]);
  const source = isPlainObject(data) ? data.source : "";

  if (isEmpty(text)) {
    return (
      <InsightSection title="Next Best Action">
        <GenericBlock value={data} />
      </InsightSection>
    );
  }

  return (
    <Box
      sx={{
        borderRadius: "6px",
        background: M.black,
        color: M.white,
        px: { xs: 2, sm: 2.5 },
        py: 2,
      }}
    >
      <Typography
        sx={{
          ...os({
            fontSize: 9.5,
            color: "#c8c8c8",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            mb: 0.75,
          }),
        }}
      >
        Next Best Action
      </Typography>

      <Typography
        sx={{
          ...os({
            fontSize: 13.5,
            fontWeight: 500,
            lineHeight: 1.55,
            color: M.white,
          }),
        }}
      >
        {formatValue(text)}
      </Typography>

      {!isEmpty(source) && (
        <Typography
          sx={{
            ...os({
              fontSize: 10.5,
              color: "#a8a8a8",
              mt: 1,
            }),
          }}
        >
          Source: {formatValue(source)}
        </Typography>
      )}
    </Box>
  );
};


/* ============================================================
   CURRENT VISIT — COMPACT SHAPE-DRIVEN LAYOUT

   The backend remains the source of truth. No clinical field names
   are hardcoded here. The layout is selected only from the shape
   of each value:

     scalar              -> compact metadata cell
     primitive array     -> chips
     object              -> responsive key/value grid
     object array        -> compact data table

   This keeps Current Visit compact while remaining fully dynamic.
   ============================================================ */

const CompactScalarGrid = ({ entries }) => {
  if (!entries?.length) return null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr 1fr",
          sm: "repeat(3, minmax(0, 1fr))",
          md: "repeat(4, minmax(0, 1fr))",
        },
        gap: 0.75,
      }}
    >
      {entries.map(([key, value]) => (
        <Box
          key={key}
          sx={{
            minWidth: 0,
            px: 1.15,
            py: 0.9,
            border: `1px solid ${M.mist}`,
            borderRadius: "4px",
            background: M.white,
          }}
        >
          <Typography
            sx={{
              ...microLabel,
              fontSize: 8.5,
              mb: 0.35,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {humanize(key)}
          </Typography>

          <Typography
            sx={{
              ...os({
                fontSize: 12,
                fontWeight: 600,
                color: M.ink,
                lineHeight: 1.35,
                wordBreak: "break-word",
              }),
            }}
          >
            {formatValue(value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

const CompactLeaf = ({ label, value }) => {
  if (isEmpty(value)) return null;

  return (
    <Box
      sx={{
        minWidth: 0,
        px: 1,
        py: 0.65,
        border: `1px solid ${M.mist}`,
        borderRadius: "4px",
        background: M.white,
      }}
    >
      <Typography sx={{ ...microLabel, fontSize: 8.5, mb: 0.25 }}>
        {humanize(label)}
      </Typography>
      <Typography
        sx={{
          ...os({
            fontSize: 11.5,
            fontWeight: 500,
            color: M.ink,
            lineHeight: 1.3,
            wordBreak: "break-word",
          }),
        }}
      >
        {formatValue(value)}
      </Typography>
    </Box>
  );
};

const CompactNestedValue = ({ value }) => {
  if (isEmpty(value)) return null;

  if (isPrimitive(value)) {
    return (
      <Typography
        sx={{
          ...os({
            fontSize: 11.5,
            color: M.ink,
            lineHeight: 1.35,
            wordBreak: "break-word",
          }),
        }}
      >
        {formatValue(value)}
      </Typography>
    );
  }

  if (Array.isArray(value)) {
    const items = value.filter((item) => !isEmpty(item));
    if (!items.length) return null;

    if (items.every(isPrimitive)) {
      return (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.4 }}>
          {items.map((item, index) => (
            <DataBadge key={index}>{formatValue(item)}</DataBadge>
          ))}
        </Box>
      );
    }

    if (items.every(isPlainObject)) {
      return <DataTable rows={items} />;
    }

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.35 }}>
        {items.map((item, index) => (
          <Typography
            key={index}
            sx={{
              ...os({ fontSize: 11, color: M.charcoal, lineHeight: 1.35 }),
            }}
          >
            {formatValue(item)}
          </Typography>
        ))}
      </Box>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, val]) => !isEmpty(val));
    if (!entries.length) return null;

    return (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
          },
          gap: 0.4,
        }}
      >
        {entries.map(([key, val]) => (
          <CompactLeaf key={key} label={key} value={val} />
        ))}
      </Box>
    );
  }

  return null;
};

const CompactVisitField = ({ label, value }) => {
  if (isEmpty(value)) return null;

  const primitive = isPrimitive(value);
  const primitiveArray =
    Array.isArray(value) &&
    value.every((item) => isPrimitive(item));

  return (
    <Box
      sx={{
        minWidth: 0,
        px: 0,
        py: 0.45,
        borderBottom: `1px solid ${M.mist}`,
        "&:last-child": {
          borderBottom: "none",
        },
      }}
    >
      <Typography
        sx={{
          ...microLabel,
          fontSize: 9.5,
          lineHeight: 1.2,
          mb: primitive || primitiveArray ? 0.2 : 0.45,
        }}
      >
        {humanize(label)}
      </Typography>

      <CompactNestedValue value={value} />
    </Box>
  );
};


/*
 * Current Visit
 *
 * Keep the original clinical-summary visual language:
 * - simple section headings
 * - subtle left accent
 * - no large individual cards
 * - compact values
 *
 * Layout is still completely data-driven.
 */
const CurrentVisitLayout = ({ data }) => {
  if (!isPlainObject(data)) return null;

  const entries = Object.entries(data).filter(
    ([, value]) => !isEmpty(value)
  );

  if (!entries.length) return null;

  return (
    <Box
      sx={{
        border: `1px solid ${M.mist}`,
        background: M.white,
        overflow: "hidden",
      }}
    >
      {/* Header — deliberately similar to the existing section */}
      <Box
        sx={{
          px: 1.25,
          py: 0.65,
          minHeight: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${M.mist}`,
        }}
      >
        <Typography
          sx={{
            ...os({
              fontSize: 13,
              fontWeight: 600,
              color: M.ink,
            }),
          }}
        >
          Current Visit
        </Typography>

        <DataBadge>{entries.length}</DataBadge>
      </Box>

      <Box
        sx={{
          px: { xs: 1.1, sm: 1.35 },
          py: 0.55,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          {entries.map(([key, value]) => {
            const isNestedObject =
              isPlainObject(value) ||
              (
                Array.isArray(value) &&
                value.length > 0 &&
                value.every(isPlainObject)
              );

            return (
              <Box
                key={key}
                sx={{
                  py: 0.5,
                  borderLeft: `2px solid ${M.border}`,
                  pl: 1.05,
                }}
              >
                {/* Section heading */}
                <Typography
                  sx={{
                    ...os({
                      fontSize: 11,
                      letterSpacing: "0.09em",
                      textTransform: "uppercase",
                      color: M.charcoal,
                      fontWeight: 500,
                      lineHeight: 1.2,
                    }),
                  }}
                >
                  {humanize(key)}
                </Typography>

                {/* Content */}
                <Box
                  sx={{
                    mt: 0.35,
                    /*
                     * Primitive top-level values stay inline.
                     * Nested objects get a compact responsive grid.
                     */
                    ...(isNestedObject
                      ? {
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "1fr",
                            sm: "repeat(2, minmax(0, 1fr))",
                            lg: "repeat(3, minmax(0, 1fr))",
                          },
                          columnGap: 1.4,
                          rowGap: 0.15,
                        }
                      : {}),
                  }}
                >
                  {isPlainObject(value) ? (
                    Object.entries(value)
                      .filter(([, child]) => !isEmpty(child))
                      .map(([childKey, childValue]) => (
                        <Box
                          key={childKey}
                          sx={{
                            minWidth: 0,
                            py: 0.3,
                            borderBottom: {
                              xs: `1px solid ${M.mist}`,
                              sm: "none",
                            },
                          }}
                        >
                          <Typography
                            sx={{
                              ...microLabel,
                              fontSize: 8.8,
                              mb: 0.1,
                            }}
                          >
                            {humanize(childKey)}
                          </Typography>

                          <CompactNestedValue value={childValue} />
                        </Box>
                      ))
                  ) : (
                    <CompactNestedValue value={value} />
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};


const SinceLastVisitLayout = ({ data }) => {
  if (!isPlainObject(data)) return null;

  const currentVisit = isPlainObject(data.current_visit)
    ? data.current_visit
    : {};
  const previousVisit = isPlainObject(data.previous_visit)
    ? data.previous_visit
    : {};
  const changes = Array.isArray(data.changes) ? data.changes : [];

  const otherEntries = Object.entries(data).filter(
    ([key, value]) =>
      !["current_visit", "previous_visit", "changes"].includes(key) &&
      !isEmpty(value)
  );

  const hasCurrent = Object.keys(currentVisit).some(
    (key) => !isEmpty(currentVisit[key])
  );
  const hasPrevious = Object.keys(previousVisit).some(
    (key) => !isEmpty(previousVisit[key])
  );
  const hasChanges = changes.some((item) => !isEmpty(item));

  if (!hasCurrent && !hasPrevious && !hasChanges && !otherEntries.length) {
    return null;
  }

  return (
    <InsightSection
      title="Since Last Visit"
      subtitle="Current visit information and documented changes from the supplied record."
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
        }}
      >
        {hasCurrent && <CurrentVisitLayout data={currentVisit} />}

        {hasChanges && (
          <Collapsible
            title="Changes"
            count={changes.length}
            defaultOpen={true}
          >
            <DataTable rows={changes} />
          </Collapsible>
        )}

        {hasPrevious && (
          <Collapsible
            title="Previous Visit"
            defaultOpen={false}
          >
            <CompactNestedValue value={previousVisit} />
          </Collapsible>
        )}

        {otherEntries.map(([key, value]) => (
          <Collapsible
            key={key}
            title={humanize(key)}
            count={Array.isArray(value) ? value.filter((item) => !isEmpty(item)).length : undefined}
            defaultOpen={false}
          >
            <CompactNestedValue value={value} />
          </Collapsible>
        ))}
      </Box>
    </InsightSection>
  );
};

/* ---------- generic "summary + counts + lists" section ----------

   Used for since_last_visit, toxicity_prediction, epro_inbox,
   trial_eligibility, collapsed_parameters and any section the
   backend adds later.

   - "summary" string          -> lead paragraph
   - other scalar fields       -> badges in the header
   - first non-empty list      -> shown open
   - every other list/object   -> collapsible, with item count
   ------------------------------------------------------------- */

const SummarySection = ({ title, data, sectionKey }) => {
  if (!sectionHasContent(data)) return null;

  if (sectionKey === "since_last_visit" && isPlainObject(data)) {
    return <SinceLastVisitLayout data={data} />;
  }

  if (isPrimitive(data)) {
    return (
      <InsightSection title={title}>
        <GenericBlock value={data} />
      </InsightSection>
    );
  }

  if (Array.isArray(data)) {
    return (
      <InsightSection title={title}>
        <GenericBlock value={data} />
      </InsightSection>
    );
  }

  const summary =
    typeof data.summary === "string" ? data.summary.trim() : "";

  const entries = Object.entries(data).filter(
    ([key, val]) =>
      !(key === "summary" && typeof val === "string") && !isEmpty(val)
  );

  const scalarEntries = entries.filter(([, val]) => isPrimitive(val));
  const structuredEntries = entries.filter(([, val]) => !isPrimitive(val));

  const primaryKey = structuredEntries.find(([, val]) =>
    Array.isArray(val)
  )?.[0];

  const primary = structuredEntries.filter(([key]) => key === primaryKey);
  const secondary = structuredEntries.filter(([key]) => key !== primaryKey);

  const badges = scalarEntries.map(
    ([key, val]) => `${humanize(key)}: ${formatValue(val)}`
  );

  return (
    <InsightSection title={title} badges={badges}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        {summary && (
          <Typography
            sx={{
              ...os({
                fontSize: 12.5,
                color: M.charcoal,
                lineHeight: 1.55,
              }),
            }}
          >
            {summary}
          </Typography>
        )}

        {primary.map(([key, val]) => (
          <GenericBlock key={key} value={val} />
        ))}

        {secondary.map(([key, val]) => (
          <Collapsible
            key={key}
            title={humanize(key)}
            count={
              Array.isArray(val)
                ? val.filter((item) => !isEmpty(item)).length
                : undefined
            }
          >
            <GenericBlock value={val} />
          </Collapsible>
        ))}

      </Box>
    </InsightSection>
  );
};

/* ---------- layout order only; contains no clinical meaning ---------- */

const KNOWN_INSIGHT_KEYS = [
  "stat_cards",
  "alerts",
  "next_best_action",
  "since_last_visit",
  "toxicity_prediction",
  "epro_inbox",
  "trial_eligibility",
  "collapsed_parameters",
];

const getPrevisitView = (insights) => {
  if (!isPlainObject(insights)) return null;

  const statCards = visibleStatCards(insights.stat_cards);
  const alerts = visibleAlerts(insights.alerts);

  /* any section the backend adds in future renders automatically */
  const extraKeys = Object.keys(insights).filter(
    (key) => !KNOWN_INSIGHT_KEYS.includes(key)
  );

  const summarySections = [
    "since_last_visit",
    "toxicity_prediction",
    "epro_inbox",
    "trial_eligibility",
    "collapsed_parameters",
    ...extraKeys,
  ].filter((key) => sectionHasContent(insights[key]));

  const hasNextAction = hasSignal(insights.next_best_action);

  if (
    statCards.length === 0 &&
    alerts.length === 0 &&
    !hasNextAction &&
    summarySections.length === 0
  ) {
    return null;
  }

  return { statCards, alerts, summarySections };
};

const PrevisitInsights = ({ view, insights }) => {
  if (!view) return null;

  const { statCards, alerts, summarySections } = view;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography
          sx={{
            ...os({
              fontSize: 15,
              fontWeight: 600,
              color: M.ink,
            }),
          }}
        >
          Previsit Insights
        </Typography>

        <Typography
          sx={{
            ...os({
              fontSize: 11.5,
              color: M.ash,
              mt: 0.35,
            }),
          }}
        >
          Summary of the current record, prepared before the visit.
        </Typography>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <StatCards items={statCards} />

        <AlertList items={alerts} />

        <NextBestAction data={insights.next_best_action} />

        {summarySections.map((key) => (
          <SummarySection
            key={key}
            sectionKey={key}
            title={humanize(key)}
            data={insights[key]}
          />
        ))}
      </Box>
    </Box>
  );
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function PreTreatmentAssessmentPanel({
  doctorId: doctorIdProp,
  patientId: patientIdProp,
  encounterId: encounterIdProp,
}) {
  const location = useLocation();

  const query = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );

  const doctorId = doctorIdProp || query.get("doctor_id");
  const patientId = patientIdProp || query.get("patient_id");
  const encounterId = encounterIdProp || query.get("encounter_id");

  /* ==========================================================
     STATE
     ========================================================== */

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [lastActionAt, setLastActionAt] = useState(null);
  const [skillOpen, setSkillOpen] = useState(false);

  /* ==========================================================
     EXTRACT SAVED ASSESSMENT (GET and POST shapes)
     ========================================================== */

  const savedAssessment = useMemo(() => {
    if (!payload) return null;

    /* GET: payload.data */
    if (payload.data && payload.data.assessment) {
      return payload.data;
    }

    /* POST: payload.assessment */
    if (payload.assessment) {
      return {
        patient_id: payload.patient_id,
        doctor_id: payload.doctor_id,
        encounter_id: payload.encounter_id,
        generated_at: payload.execution?.finished_at,
        execution: payload.execution,
        assessment: payload.assessment,
      };
    }

    return null;
  }, [payload]);

  const assessment = savedAssessment?.assessment || null;

  const assessmentPoints = (
    Array.isArray(assessment?.assessment_points)
      ? assessment.assessment_points
      : []
  ).filter(
    (point) =>
      isPlainObject(point) &&
      (!isEmpty(
        pickFirst(point, ["point", "assessment", "finding", "description"])
      ) ||
        !isEmpty(
          pickFirst(point, ["clinical_significance", "significance", "reason"])
        ))
  );

  /* NEW: previsit insights come from the same endpoint/response */
  const previsitInsights = useMemo(() => {
    const insights = assessment?.previsit_insights;
    return isPlainObject(insights) ? insights : null;
  }, [assessment]);

  /* what will actually be shown (null when there is nothing to show) */
  const previsitView = useMemo(
    () => getPrevisitView(previsitInsights),
    [previsitInsights]
  );

  /* ==========================================================
     GET LATEST SAVED ASSESSMENT (does NOT run AI)
     ========================================================== */

  const fetchSavedAssessment = useCallback(async () => {
    if (!doctorId || !patientId) {
      setLoading(false);
      setError("Patient and doctor identifiers are required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = buildLatestUrl(patientId, doctorId, encounterId);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(
          json?.message || `Request failed (${response.status})`
        );
      }

      /* No saved assessment yet. */
      if (json.status === "success" && json.found === false) {
        setPayload(null);
        return;
      }

      if (json.status === "error") {
        throw new Error(
          json.message || "Failed to retrieve assessment."
        );
      }

      setPayload(json);
      setLastActionAt(new Date());
    } catch (err) {
      console.error("Saved pre-treatment assessment fetch failed:", err);

      setPayload(null);

      setError(
        err?.message || "Unable to retrieve the saved assessment."
      );
    } finally {
      setLoading(false);
    }
  }, [doctorId, patientId, encounterId]);

  /* INITIAL PAGE LOAD — GET ONLY */
  useEffect(() => {
    fetchSavedAssessment();
  }, [fetchSavedAssessment]);

  /* ==========================================================
     POST GENERATION — only when the user clicks Generate
     ========================================================== */

  const generateAssessment = useCallback(async () => {
    if (!doctorId || !patientId) {
      setError("Patient and doctor identifiers are required.");
      return;
    }

    if (generating) {
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const requestBody = {
        patient_id: patientId,
        doctor_id: doctorId,
      };

      if (encounterId) {
        requestBody.encounter_id = encounterId;
      }

      const response = await fetch(buildGenerateUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(
          json?.message ||
            json?.reason ||
            `Generation failed (${response.status})`
        );
      }

      if (json.status === "error") {
        throw new Error(
          json.message || "Failed to generate assessment."
        );
      }

      /* POST already returns the new assessment; show it directly. */
      setPayload(json);
      setLastActionAt(new Date());
    } catch (err) {
      console.error("Pre-treatment assessment generation failed:", err);

      /* Keep any previous assessment visible if regeneration fails. */
      setError(err?.message || "Unable to generate the assessment.");
    } finally {
      setGenerating(false);
    }
  }, [doctorId, patientId, encounterId, generating]);

  /* ==========================================================
     INVALID IDENTIFIERS
     ========================================================== */

  if (!doctorId || !patientId) {
    return (
      <Box sx={{ ...page, p: 2 }}>
        <Alert severity="error" sx={{ ...os({ fontSize: 12 }) }}>
          Patient and doctor identifiers are required to load the
          assessment.
        </Alert>
      </Box>
    );
  }

  /* ==========================================================
     INITIAL LOADING
     ========================================================== */

  if (loading && !payload) {
    return (
      <Box sx={{ ...page, p: 2 }}>
        <EmptyState
          loading
          title="Loading Pre-Treatment Assessment"
          description="Retrieving the latest saved assessment."
        />
      </Box>
    );
  }

  /* ==========================================================
     NO SAVED ASSESSMENT
     ========================================================== */

  if (!savedAssessment) {
    return (
      <Box sx={{ ...page, p: 2 }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography
            sx={{
              ...os({
                fontSize: 20,
                fontWeight: 500,
                color: M.ink,
                mb: 0.5,
              }),
            }}
          >
            Pre-Treatment Assessment
          </Typography>

          <Typography sx={{ ...os({ fontSize: 12, color: M.ash }) }}>
            Patient-specific assessment generated from the available
            clinical record.
          </Typography>
        </Box>

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2, ...os({ fontSize: 12 }) }}
          >
            {error}
          </Alert>
        )}

        <EmptyState
          title="No Assessment Available"
          description="No previously generated assessment was found for this patient and doctor. Generate an assessment to create the first saved result."
          action={
            <>
              <Box
                component="button"
                type="button"
                onClick={() => setSkillOpen(true)}
                disabled={generating || !doctorId}
                sx={{
                  ...os({ fontSize: 11.5, fontWeight: 600 }),
                  px: 1.75,
                  py: 1,
                  mr: 1,
                  background: M.white,
                  color: M.black,
                  border: `1px solid ${M.border}`,
                  borderRadius: "4px",
                  cursor:
                    generating || !doctorId ? "not-allowed" : "pointer",
                  opacity: generating || !doctorId ? 0.55 : 1,
                  "&:hover": {
                    background: M.fog,
                  },
                }}
              >
                Skill View
              </Box>

              <Box
                component="button"
                type="button"
                onClick={generateAssessment}
                disabled={generating}
                sx={{
                  ...os({ fontSize: 12.5, fontWeight: 600 }),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  px: 2.75,
                  py: 1.25,
                  background: M.black,
                  color: M.white,
                  border: "none",
                  borderRadius: "4px",
                  cursor: generating ? "not-allowed" : "pointer",
                  opacity: generating ? 0.6 : 1,
                  "&:hover": {
                    background: M.charcoal,
                  },
                }}
              >
                {generating ? (
                  <>
                    <CircularProgress size={15} sx={{ color: M.white }} />
                    Generating Assessment…
                  </>
                ) : (
                  <>
                    <AutoAwesomeRounded sx={{ fontSize: 17 }} />
                    Generate Assessment
                  </>
                )}
              </Box>
            </>
          }
        />

        {/* keep the skill dialog reachable from the empty state too */}
        <DoctorSkillSection
          doctorId={doctorId}
          open={skillOpen}
          onClose={() => setSkillOpen(false)}
        />
      </Box>
    );
  }

  /* ==========================================================
     MAIN ASSESSMENT VIEW
     ========================================================== */

  return (
    <Box
      sx={{
        ...page,
        p: {
          xs: 1.5,
          sm: 2,
          md: 2.5,
        },
      }}
    >
      {/* ======================================================
          PAGE HEADER
          ====================================================== */}

      <Box
        sx={{
          ...card,
          mb: 2.5,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            px: { xs: 2, sm: 2.5 },
            py: 2.25,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 1,
            flexWrap: "wrap",
            background: M.black,
            color: M.white,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                ...os({
                  fontSize: 9.5,
                  color: "#c8c8c8",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  mb: 0.5,
                }),
              }}
            >
              Clinical Assessment
            </Typography>

            <Typography
              sx={{
                ...os({
                  fontSize: { xs: 17, sm: 19 },
                  fontWeight: 500,
                  color: M.white,
                  lineHeight: 1.3,
                }),
              }}
            >
              Pre-Treatment Assessment
            </Typography>

            {savedAssessment?.generated_at && (
              <Typography
                sx={{
                  ...os({
                    fontSize: 10.5,
                    color: "#a8a8a8",
                    mt: 0.5,
                  }),
                }}
              >
                Generated {formatDateTime(savedAssessment.generated_at)}
              </Typography>
            )}
          </Box>

          {/* Skill view / regenerate */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box
              component="button"
              type="button"
              onClick={() => setSkillOpen(true)}
              disabled={generating || !doctorId}
              sx={{
                ...os({ fontSize: 11.5, fontWeight: 600 }),
                px: 1.75,
                py: 1,
                background: M.white,
                color: M.black,
                border: "none",
                borderRadius: "4px",
                cursor:
                  generating || !doctorId ? "not-allowed" : "pointer",
                opacity: generating || !doctorId ? 0.55 : 1,
                "&:hover": {
                  background: M.fog,
                },
              }}
            >
              Skill View
            </Box>

            <Tooltip title="Generate a new assessment">
              <span>
                <IconButton
                  onClick={generateAssessment}
                  disabled={generating}
                  sx={{
                    width: 40,
                    height: 40,
                    border: "1px solid #666",
                    color: M.white,
                    borderRadius: "4px",
                    "&:hover": {
                      background: "#222",
                    },
                    "&.Mui-disabled": {
                      color: "#777",
                      borderColor: "#444",
                    },
                  }}
                >
                  {generating ? (
                    <CircularProgress size={18} sx={{ color: M.white }} />
                  ) : (
                    <RefreshRounded sx={{ fontSize: 20 }} />
                  )}
                </IconButton>
              </span>
            </Tooltip>

            <Box
              component="button"
              type="button"
              onClick={generateAssessment}
              disabled={generating}
              sx={{
                ...os({ fontSize: 11.5, fontWeight: 600 }),
                px: 1.75,
                py: 1,
                background: M.white,
                color: M.black,
                border: "none",
                borderRadius: "4px",
                cursor: generating ? "not-allowed" : "pointer",
                opacity: generating ? 0.55 : 1,
                "&:hover": {
                  background: M.fog,
                },
              }}
            >
              {generating ? "Generating…" : "Generate New Assessment"}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ======================================================
          ERROR DURING REGENERATION
          ====================================================== */}

      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 2.5,
            ...os({ fontSize: 12 }),
          }}
        >
          {error}
        </Alert>
      )}

      {/* ======================================================
          GENERATION STATUS
          ====================================================== */}

      {generating && (
        <Box
          sx={{
            mb: 2.5,
            px: 2,
            py: 1.25,
            border: `1px solid ${M.border}`,
            borderRadius: "5px",
            background: M.white,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <CircularProgress
            size={15}
            thickness={3}
            sx={{ color: M.black }}
          />

          <Typography sx={{ ...os({ fontSize: 11.5, color: M.smoke }) }}>
            A new assessment is being generated. The current saved
            assessment remains available until the new result is ready.
          </Typography>
        </Box>
      )}

      {/* ======================================================
          PREVISIT INSIGHTS (new)
          ====================================================== */}

      <PrevisitInsights view={previsitView} insights={previsitInsights} />

      {!previsitView && assessmentPoints.length === 0 && (
        <Box sx={{ ...card, p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 12.5, color: M.ash }) }}>
            This assessment has no displayable content.
          </Typography>
        </Box>
      )}

      {/* ======================================================
          ASSESSMENT POINTS
          ====================================================== */}

      {assessmentPoints.length > 0 && (
      <Box
        sx={{
          ...card,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            px: { xs: 2, sm: 2.5 },
            py: 1.75,
            background: M.paper,
            borderBottom: `1px solid ${M.mist}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Box>
            <Typography
              sx={{
                ...os({
                  fontSize: 13,
                  fontWeight: 600,
                  color: M.ink,
                }),
              }}
            >
              Assessment Findings
            </Typography>

            <Typography
              sx={{
                ...os({
                  fontSize: 11,
                  color: M.ash,
                  mt: 0.35,
                }),
              }}
            >
              Clinically relevant assessment points supported by the
              available record.
            </Typography>
          </Box>

          <DataBadge>
            {assessmentPoints.length}{" "}
            {assessmentPoints.length === 1 ? "item" : "items"}
          </DataBadge>
        </Box>

        <Box sx={{ p: { xs: 1, sm: 1.5 } }}>
          {assessmentPoints.length === 0 ? (
            <Box sx={{ py: 5, textAlign: "center" }}>
              <Typography sx={{ ...os({ fontSize: 12.5, color: M.ash }) }}>
                No assessment points were returned.
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 0.75,
              }}
            >
              {assessmentPoints.map((point, index) => (
                <AssessmentPointCard
                  key={`${index}-${point?.category || "assessment"}`}
                  point={point}
                  index={index}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>
      )}

      {/* ======================================================
          SKILL DIALOG + FOOTER
          ====================================================== */}

      <DoctorSkillSection
        doctorId={doctorId}
        open={skillOpen}
        onClose={() => setSkillOpen(false)}
      />

      {lastActionAt && (
        <Box
          sx={{
            mt: 1.5,
            mb: 2,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <Typography sx={{ ...os({ fontSize: 10, color: M.silver }) }}>
            Last retrieved/generated: {lastActionAt.toLocaleString()}
          </Typography>
        </Box>
      )}
    </Box>
  );
}