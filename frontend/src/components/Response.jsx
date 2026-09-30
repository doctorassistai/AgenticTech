import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Brand tokens — matched to Response.jsx                             */
/* ------------------------------------------------------------------ */
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = {
  black: "#000000",
  charcoal: "#444444",
  ash: "#888888",
  mist: "#e0e0e0",
  ghost: "#fafafa",
  white: "#ffffff",
};
const os = (x = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...x,
});

/* ------------------------------------------------------------------ */
/*  Structural helpers                                                 */
/* ------------------------------------------------------------------ */
const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isEmpty = (v) => {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (isObject(v)) return Object.keys(v).every((k) => isEmpty(v[k]));
  return false;
};

const asArray = (v) => {
  if (isEmpty(v)) return [];
  return Array.isArray(v) ? v : [v];
};

const prettyLabel = (key) =>
  String(key)
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const toText = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(", ");
  if (isObject(v)) {
    return Object.entries(v)
      .filter(([, x]) => !isEmpty(x))
      .map(([k, x]) => `${prettyLabel(k)}: ${toText(x)}`)
      .join(" · ");
  }
  return String(v);
};

const unionKeys = (rows) => {
  const keys = [];
  rows.forEach((row) => {
    if (!isObject(row)) return;
    Object.keys(row).forEach((k) => {
      if (!keys.includes(k)) keys.push(k);
    });
  });
  return keys;
};

const numericValue = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const pick = (src, keys) => {
  if (!isObject(src)) return undefined;
  for (const k of keys) if (!isEmpty(src[k])) return src[k];
  return undefined;
};

const SOURCE_KEY = /^(event_id|source_event_id|document_id|id)$/i;

/* ------------------------------------------------------------------ */
/*  Shared theme helpers                                               */
/* ------------------------------------------------------------------ */
const SectionLabel = ({ children, sx = {} }) => (
  <Typography
    sx={{
      ...os({
        fontSize: 11,
        color: C.black,
        fontWeight: FW_REGULAR,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        mb: 1.5,
      }),
      ...sx,
    }}
  >
    {children}
  </Typography>
);

const SubNote = ({ children, sx = {} }) => (
  <Typography
    sx={{
      ...os({ fontSize: 11, color: C.ash, mb: 1.5, lineHeight: 1.6 }),
      ...sx,
    }}
  >
    {children}
  </Typography>
);

/** A card container that matches the Response.jsx visual language. */
const PanelCard = ({ title, sub, children, sx = {} }) => (
  <Box
    sx={{
      mb: 4,
      ...sx,
    }}
  >
    {title && (
      <Box
        sx={{
          pb: 1.25,
          mb: 1.5,
          borderBottom: `1px solid ${C.mist}`,
        }}
      >
        <Typography
          sx={{
            ...os({
              fontSize: 11,
              color: C.black,
              fontWeight: FW_REGULAR,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }),
          }}
        >
          {title}
        </Typography>
        {sub && (
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>
            {sub}
          </Typography>
        )}
      </Box>
    )}
    {children}
  </Box>
);

/** Themed table for arbitrary object rows. */
const ThemedTable = ({ columns, rows, renderCell }) => (
  <Box
    component="table"
    sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}
  >
    <Box component="thead">
      <Box component="tr">
        {columns.map((c) => (
          <Box
            component="th"
            key={c}
            sx={{
              textAlign: "left",
              fontWeight: FW_LIGHT,
              fontSize: 10,
              color: C.ash,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              py: 1,
              pr: 2,
              borderBottom: `1px solid ${C.black}`,
              whiteSpace: "nowrap",
            }}
          >
            {c === "percentage_score" ? "Percentage / Score" : prettyLabel(c)}
          </Box>
        ))}
      </Box>
    </Box>
    <Box component="tbody">
      {rows.map((row, i) => (
        <Box component="tr" key={i}>
          {columns.map((c) => (
            <Box
              component="td"
              key={c}
              sx={{
                fontSize: 12,
                color: C.black,
                fontWeight: FW_REGULAR,
                py: 1.2,
                pr: 2,
                borderBottom: `1px solid ${C.mist}`,
                verticalAlign: "top",
                whiteSpace: "pre-wrap",
              }}
            >
              {renderCell ? renderCell(row, c) : toText(row[c])}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  </Box>
);

/** Recursive value renderer for nested objects / arrays. */
function Value({ value, depth = 0 }) {
  if (isEmpty(value))
    return <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>—</Typography>;

  if (Array.isArray(value)) {
    if (!value.length) return null;
    // Array of scalars
    if (value.every((v) => !isObject(v) && !Array.isArray(v))) {
      return (
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {value.map((v, i) => (
            <Box
              component="li"
              key={i}
              sx={{ ...os({ fontSize: 12, color: C.black, mb: 0.5 }) }}
            >
              {toText(v)}
            </Box>
          ))}
        </Box>
      );
    }
    // Array of objects — one table per shape.
    const objects = value.filter(isObject);
    if (objects.length) {
      const cols = unionKeys(objects).filter((k) =>
        objects.some((r) => !isEmpty(r[k]))
      );
      return <ThemedTable columns={cols} rows={objects} />;
    }
    return null;
  }

  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => !isEmpty(v));
    if (!entries.length) return null;
    return (
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
        <Box component="tbody">
          {entries.map(([k, v]) => (
            <Box component="tr" key={k}>
              <Box
                component="td"
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.ash,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    width: "30%",
                    py: 0.8,
                    pr: 2,
                    verticalAlign: "top",
                    borderBottom: `1px solid ${C.mist}`,
                  }),
                }}
              >
                {prettyLabel(k)}
              </Box>
              <Box
                component="td"
                sx={{
                  ...os({ fontSize: 12, color: C.black }),
                  py: 0.8,
                  borderBottom: `1px solid ${C.mist}`,
                  verticalAlign: "top",
                }}
              >
                {isObject(v) || Array.isArray(v) ? (
                  <Value value={v} depth={depth + 1} />
                ) : (
                  toText(v)
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Typography sx={{ ...os({ fontSize: 12, color: C.black, lineHeight: 1.6 }) }}>
      {toText(value)}
    </Typography>
  );
}

/* ------------------------------------------------------------------ */
/*  Marker (square / circle) matching Response.jsx                     */
/* ------------------------------------------------------------------ */
const Marker = ({ s = "in" }) => {
  const M = {
    ok: { borderRadius: "50%", background: C.black },
    rv: {
      borderRadius: "50%",
      border: `1.5px solid ${C.black}`,
      background: `linear-gradient(90deg, ${C.black} 50%, transparent 50%)`,
    },
    cr: { transform: "rotate(45deg)", background: C.black },
    in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
  };
  return <Box sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...M[s] }} />;
};

/* ------------------------------------------------------------------ */
/*  Status card grid (matches Response.jsx typography)                 */
/* ------------------------------------------------------------------ */
function StatusCardGrid({ cards }) {
  const items = asArray(cards)
    .filter((c) => isObject(c) && !isEmpty(c))
    .map((c) => ({
      key: c.id || pick(c, ["label", "title", "name"]),
      label: pick(c, ["label", "title", "name"]),
      status: pick(c, ["status", "value", "verdict"]),
      explanation: pick(c, [
        "explanation",
        "description",
        "detail",
        "note",
        "content",
      ]),
    }))
    .filter(
      (c) => !isEmpty(c.label) || !isEmpty(c.status) || !isEmpty(c.explanation)
    );

  if (!items.length) return null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        gap: 2,
        mb: 4,
      }}
    >
      {items.map((c, i) => (
        <Box
          key={c.key || i}
          sx={{
            border: `1px solid ${C.mist}`,
            background: C.ghost,
            p: 2,
          }}
        >
          {!isEmpty(c.label) && (
            <Typography
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  mb: 1,
                }),
              }}
            >
              {toText(c.label)}
            </Typography>
          )}
          <Box
            sx={{
              display: "flex",
              gap: 1,
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            {!isEmpty(c.status) && (
              <Typography
                sx={{
                  ...os({
                    fontSize: 12,
                    color: C.black,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    border: `1px solid ${C.black}`,
                    px: 1,
                    py: 0.25,
                  }),
                }}
              >
                {toText(c.status)}
              </Typography>
            )}
            {!isEmpty(c.explanation) && (
              <Typography
                sx={{ ...os({ fontSize: 12, color: C.black, lineHeight: 1.6 }) }}
              >
                {toText(c.explanation)}
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline card                                                      */
/* ------------------------------------------------------------------ */
function timelineMeta(row) {
  const metaKeys = [];
  const bodyKeys = [];
  Object.keys(row).forEach((k) => {
    if (SOURCE_KEY.test(k)) return;
    const val = row[k];
    if (isEmpty(val)) return;
    const flat = !isObject(val) && !Array.isArray(val);
    const text = flat ? String(toText(val)) : "";
    const looksLikeDate = /date/i.test(k) || /^\d{4}-\d{2}-\d{2}/.test(text);
    const looksLikeVisit = /visit|cycle|number/i.test(k);
    if (flat && text.length <= 24 && (looksLikeDate || looksLikeVisit)) {
      metaKeys.push(k);
    } else {
      bodyKeys.push(k);
    }
  });
  return { metaKeys, bodyKeys };
}

function TimelineList({ rows }) {
  const items = asArray(rows).filter((r) => isObject(r) && !isEmpty(r));
  if (!items.length) return null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {items.map((row, i) => {
        const { metaKeys, bodyKeys } = timelineMeta(row);
        return (
          <Box
            key={i}
            sx={{ borderLeft: `2px solid ${C.mist}`, pl: 1.5 }}
          >
            {metaKeys.length > 0 && (
              <Box
                sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 0.75 }}
              >
                {metaKeys.map((k) => (
                  <Typography
                    key={k}
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.charcoal,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        border: `1px solid ${C.mist}`,
                        px: 0.75,
                        py: 0.25,
                        background: C.white,
                      }),
                    }}
                  >
                    {toText(row[k])}
                  </Typography>
                ))}
              </Box>
            )}
            <Box>
              {bodyKeys.map((k) => (
                <Box key={k} sx={{ mb: 0.5 }}>
                  {bodyKeys.length > 1 && (
                    <Typography
                      component="span"
                      sx={{
                        ...os({
                          fontSize: 11,
                          color: C.ash,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          mr: 0.5,
                        }),
                      }}
                    >
                      {prettyLabel(k)}:
                    </Typography>
                  )}
                  {isObject(row[k]) || Array.isArray(row[k]) ? (
                    <Value value={row[k]} depth={1} />
                  ) : (
                    <Typography
                      component="span"
                      sx={{ ...os({ fontSize: 12, color: C.black }) }}
                    >
                      {toText(row[k])}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function TimelineCard({ title, rows }) {
  const items = asArray(rows).filter((r) => isObject(r) && !isEmpty(r));
  if (!items.length) return null;
  return (
    <PanelCard title={title}>
      <TimelineList rows={items} />
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Pivoted flowsheet (renders visit-matrix rows)                      */
/* ------------------------------------------------------------------ */
function hasUsablePivotedData(pivoted) {
  if (!isObject(pivoted)) return false;
  return Object.values(pivoted).some((bucket) => {
    if (!isObject(bucket)) return false;
    return asArray(bucket.rows).some(
      (row) =>
        isObject(row) &&
        asArray(row.cells).some(
          (cell) =>
            isObject(cell) &&
            (!isEmpty(cell.value) ||
              !isEmpty(cell.status) ||
              asArray(cell.event_ids).length > 0)
        )
    );
  });
}

function PivotedFlowsheet({ title, sub, pivoted }) {
  const buckets = useMemo(() => {
    if (!isObject(pivoted)) return {};
    const out = {};
    Object.entries(pivoted).forEach(([key, value]) => {
      if (
        isObject(value) &&
        Array.isArray(value.visit_axis) &&
        Array.isArray(value.rows) &&
        value.rows.length
      ) {
        out[key] = value;
      }
    });
    return out;
  }, [pivoted]);

  const categories = Object.keys(buckets);
  const [active, setActive] = useState("all");

  useEffect(() => {
    if (active !== "all" && !Object.prototype.hasOwnProperty.call(buckets, active)) {
      setActive("all");
    }
  }, [active, buckets]);

  if (!categories.length) return null;

  const trendGlyph = { up: "↑", down: "↓", flat: "→", mixed: "↕" };
  const visitLabel = (v) =>
    v.visit_number === 1 ? "Baseline" : `Visit ${v.visit_number}`;

  const renderBucketTable = (data, keyPrefix = "") => {
    if (!isObject(data)) return null;
    const visitAxis = Array.isArray(data.visit_axis) ? data.visit_axis : [];
    const rows = Array.isArray(data.rows)
      ? data.rows.filter((r) => isObject(r) && !isEmpty(r))
      : [];
    if (!rows.length) return null;

    return (
      <Box sx={{ overflowX: "auto", width: "100%" }}>
        <Box
          component="table"
          sx={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box
                component="th"
                sx={{
                  textAlign: "left",
                  fontWeight: FW_LIGHT,
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  py: 1,
                  pr: 2,
                  borderBottom: `1px solid ${C.black}`,
                  whiteSpace: "nowrap",
                }}
              >
                Parameter
              </Box>
              {visitAxis.map((visit) => (
                <Box
                  component="th"
                  key={visit.visit_number}
                  sx={{
                    textAlign: "left",
                    fontWeight: FW_LIGHT,
                    fontSize: 10,
                    color: C.ash,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    py: 1,
                    pr: 2,
                    borderBottom: `1px solid ${C.black}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {visitLabel(visit)}
                </Box>
              ))}
              <Box
                component="th"
                sx={{
                  textAlign: "left",
                  fontWeight: FW_LIGHT,
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  py: 1,
                  pr: 2,
                  borderBottom: `1px solid ${C.black}`,
                  whiteSpace: "nowrap",
                }}
              >
                Trend
              </Box>
              <Box
                component="th"
                sx={{
                  textAlign: "left",
                  fontWeight: FW_LIGHT,
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  py: 1,
                  borderBottom: `1px solid ${C.black}`,
                  whiteSpace: "nowrap",
                }}
              >
                Status
              </Box>
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map((row, index) => {
              const cells = Array.isArray(row.cells) ? row.cells : [];
              const lastStatus = [...cells]
                .reverse()
                .find((c) => !isEmpty(c?.status));
              return (
                <Box component="tr" key={`${keyPrefix}-${row.series_id || index}`}>
                  <Box
                    component="td"
                    sx={{
                      ...os({ fontSize: 12, color: C.black }),
                      py: 1.2,
                      pr: 2,
                      borderBottom: `1px solid ${C.mist}`,
                      verticalAlign: "top",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {toText(row.parameter)}
                    {!isEmpty(row.unit) ? ` (${toText(row.unit)})` : ""}
                  </Box>
                  {visitAxis.map((visit) => {
                    const cell = cells.find(
                      (c) => c?.visit_number === visit.visit_number
                    );
                    const blank = !cell || isEmpty(cell.value);
                    return (
                      <Box
                        component="td"
                        key={visit.visit_number}
                        sx={{
                          ...os({
                            fontSize: 12,
                            color: blank ? C.ash : C.black,
                          }),
                          py: 1.2,
                          pr: 2,
                          borderBottom: `1px solid ${C.mist}`,
                          verticalAlign: "top",
                        }}
                      >
                        {blank ? "—" : toText(cell.value)}
                      </Box>
                    );
                  })}
                  <Box
                    component="td"
                    sx={{
                      ...os({ fontSize: 12, color: C.charcoal }),
                      py: 1.2,
                      pr: 2,
                      borderBottom: `1px solid ${C.mist}`,
                      verticalAlign: "top",
                    }}
                  >
                    {!isEmpty(row.trend)
                      ? trendGlyph[row.trend] || toText(row.trend)
                      : "—"}
                  </Box>
                  <Box
                    component="td"
                    sx={{
                      ...os({ fontSize: 12, color: C.black }),
                      py: 1.2,
                      borderBottom: `1px solid ${C.mist}`,
                      verticalAlign: "top",
                    }}
                  >
                    {lastStatus && !isEmpty(lastStatus.status)
                      ? toText(lastStatus.status)
                      : "—"}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    );
  };

  return (
    <PanelCard title={title} sub={sub}>
      {categories.length > 0 && (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 0.75,
            mb: 1.5,
          }}
        >
          <Typography
            sx={{
              ...os({
                fontSize: 10,
                color: C.ash,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                alignSelf: "center",
                mr: 0.5,
              }),
            }}
          >
            Show:
          </Typography>
          {["all", ...categories].map((key) => {
            const isActive = active === key;
            return (
              <Box
                key={key}
                component="button"
                onClick={() => setActive(key)}
                sx={{
                  ...os({
                    fontSize: 11,
                    color: isActive ? C.white : C.black,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }),
                  border: `1px solid ${isActive ? C.black : C.mist}`,
                  background: isActive ? C.black : C.white,
                  px: 1.5,
                  py: 0.5,
                  cursor: "pointer",
                  "&:hover": {
                    borderColor: C.black,
                  },
                }}
              >
                {key === "all" ? "All" : prettyLabel(key)}
              </Box>
            );
          })}
        </Box>
      )}

      {active === "all"
        ? categories.map((cat) => (
            <Box key={cat} sx={{ mb: 2.5 }}>
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.charcoal,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    mb: 1,
                  }),
                }}
              >
                {prettyLabel(cat)}
              </Typography>
              {renderBucketTable(buckets[cat], `all-${cat}`)}
            </Box>
          ))
        : renderBucketTable(buckets[active], active)}
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Flat flowsheet (non-pivoted) — renders generic rows                */
/* ------------------------------------------------------------------ */
function Rows({ rows, markerMode = false, groupBySource = false }) {
  const items = asArray(rows).filter((r) => !isEmpty(r));
  if (!items.length) return null;

  const objects = items.filter(isObject);
  const scalars = items.filter((r) => !isObject(r));

  if (!objects.length) {
    return (
      <Box component="ul" sx={{ m: 0, pl: 2 }}>
        {scalars.map((s, i) => (
          <Box
            component="li"
            key={i}
            sx={{ ...os({ fontSize: 12, color: C.black, mb: 0.5 }) }}
          >
            {toText(s)}
          </Box>
        ))}
      </Box>
    );
  }

  if (groupBySource) {
    const groups = [];
    const groupMap = new Map();
    const ungrouped = [];
    objects.forEach((row) => {
      const gk =
        row.type || row.source_type || row.data_type || row.category || row.section;
      if (!gk) {
        ungrouped.push(row);
        return;
      }
      const key = String(gk);
      if (!groupMap.has(key)) {
        const g = { key, rows: [] };
        groupMap.set(key, g);
        groups.push(g);
      }
      groupMap.get(key).rows.push(row);
    });

    if (!groups.length) {
      const cols = unionKeys(objects).filter((k) =>
        objects.some((r) => !isEmpty(r[k]))
      );
      return <ThemedTable columns={cols} rows={objects} />;
    }

    return (
      <>
        {groups.map((g) => {
          const cols = unionKeys(g.rows).filter((k) =>
            g.rows.some((r) => !isEmpty(r[k]))
          );
          return (
            <Box key={g.key} sx={{ mb: 2 }}>
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.charcoal,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    mb: 1,
                  }),
                }}
              >
                {g.key}
              </Typography>
              <ThemedTable columns={cols} rows={g.rows} />
            </Box>
          );
        })}
        {ungrouped.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography
              sx={{
                ...os({
                  fontSize: 11,
                  color: C.charcoal,
                  fontWeight: FW_REGULAR,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  mb: 1,
                }),
              }}
            >
              Other
            </Typography>
            {(() => {
              const cols = unionKeys(ungrouped).filter((k) =>
                ungrouped.some((r) => !isEmpty(r[k]))
              );
              return <ThemedTable columns={cols} rows={ungrouped} />;
            })()}
          </Box>
        )}
      </>
    );
  }

  const cols = unionKeys(objects).filter((k) =>
    objects.some((r) => !isEmpty(r[k]))
  );

  if (!cols.length) return null;

  return (
    <ThemedTable
      columns={cols}
      rows={objects}
      renderCell={(row, c) => {
        const v = row[c];
        if (isObject(v) || Array.isArray(v)) {
          return <Value value={v} depth={1} />;
        }
        return toText(v);
      }}
    />
  );
}

function Flowsheet({ title, sub, flowsheet }) {
  const buckets = useMemo(() => {
    if (!isObject(flowsheet)) return {};
    const out = {};
    Object.entries(flowsheet).forEach(([key, value]) => {
      const rows = asArray(value).filter((row) => !isEmpty(row));
      if (rows.length) out[key] = rows;
    });
    return out;
  }, [flowsheet]);

  const categories = Object.keys(buckets).filter((k) => k !== "all");
  const hasBucketed = categories.length > 0;

  const [active, setActive] = useState("all");

  useEffect(() => {
    if (active !== "all" && !Object.prototype.hasOwnProperty.call(buckets, active)) {
      setActive("all");
    }
  }, [active, buckets]);

  if (!Object.keys(buckets).length) return null;

  const renderSelected = () => {
    if (active === "all") return null;
    const rows = buckets[active] || [];
    if (!rows.length) return null;
    return <Rows rows={rows} />;
  };

  const renderAll = () => {
    if (!hasBucketed) return <Rows rows={buckets.all || []} groupBySource />;
    return (
      <>
        {categories.map((key) => (
          <Box key={key} sx={{ mb: 2.5 }}>
            <Typography
              sx={{
                ...os({
                  fontSize: 11,
                  color: C.charcoal,
                  fontWeight: FW_REGULAR,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  mb: 1,
                }),
              }}
            >
              {prettyLabel(key)}
            </Typography>
            <Rows rows={buckets[key] || []} />
          </Box>
        ))}
      </>
    );
  };

  return (
    <PanelCard title={title} sub={sub}>
      {categories.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1.5 }}>
          <Typography
            sx={{
              ...os({
                fontSize: 10,
                color: C.ash,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                alignSelf: "center",
                mr: 0.5,
              }),
            }}
          >
            Show:
          </Typography>
          {["all", ...categories].map((key) => {
            const isActive = active === key;
            return (
              <Box
                key={key}
                component="button"
                onClick={() => setActive(key)}
                sx={{
                  ...os({
                    fontSize: 11,
                    color: isActive ? C.white : C.black,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }),
                  border: `1px solid ${isActive ? C.black : C.mist}`,
                  background: isActive ? C.black : C.white,
                  px: 1.5,
                  py: 0.5,
                  cursor: "pointer",
                  "&:hover": { borderColor: C.black },
                }}
              >
                {key === "all" ? "All" : prettyLabel(key)}
              </Box>
            );
          })}
        </Box>
      )}
      {active === "all" ? renderAll() : renderSelected()}
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Pathway deviation log                                              */
/* ------------------------------------------------------------------ */
function PathwayDeviationLog({ entries, deviations }) {
  const combined = [...asArray(deviations), ...asArray(entries)].filter(
    (row) => isObject(row) && !isEmpty(row)
  );
  if (!combined.length) return null;

  return (
    <PanelCard title="Pathway Deviation">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {combined.map((row, i) => {
          const description =
            row.description ??
            row.detail ??
            row.deviation ??
            row.statement ??
            row.evidence;
          return (
            <Box
              key={i}
              sx={{
                borderLeft: `2px solid ${C.charcoal}`,
                background: C.ghost,
                px: 1.5,
                py: 1,
                border: `1px solid ${C.mist}`,
              }}
            >
              {!isEmpty(description) ? (
                <Typography
                  sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }) }}
                >
                  {toText(description)}
                </Typography>
              ) : (
                <Value value={row} depth={1} />
              )}
            </Box>
          );
        })}
      </Box>
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Evidence table                                                     */
/* ------------------------------------------------------------------ */
function EvidenceTable({ title, value }) {
  const rows = asArray(value).filter((r) => isObject(r) && !isEmpty(r));
  if (!rows.length) return null;
  const cols = unionKeys(rows).filter(
    (k) => !SOURCE_KEY.test(k) && rows.some((r) => !isEmpty(r[k]))
  );
  if (!cols.length) return null;

  return (
    <PanelCard title={title}>
      <ThemedTable columns={cols} rows={rows} />
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Prose card                                                         */
/* ------------------------------------------------------------------ */
function ProseCard({ title, value }) {
  if (isEmpty(value)) return null;
  if (isObject(value) || Array.isArray(value)) {
    return (
      <PanelCard title={title}>
        <Value value={value} />
      </PanelCard>
    );
  }
  return (
    <PanelCard title={title}>
      <Typography
        sx={{ ...os({ fontSize: 12, color: C.black, lineHeight: 1.7 }) }}
      >
        {toText(value)}
      </Typography>
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function ResponseResistanceTab({
  patientId,
  doctorId = null,
  apiBaseUrl = "https://doctorassist.ai/api/",
}) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const endpoint = useMemo(() => {
    if (!patientId) return null;
    const base = apiBaseUrl ? apiBaseUrl.replace(/\/+$/, "") : "";
    const query = doctorId ? `?doctor_id=${encodeURIComponent(doctorId)}` : "";
    return `${base}/hms/users/ai-legacy/api/patients/${encodeURIComponent(
      patientId
    )}/longitudinal-summary${query}`;
  }, [apiBaseUrl, patientId, doctorId]);

  const fetchSummary = useCallback(
    async (silent = false) => {
      if (!endpoint) return;
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) setLoading(true);

      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (response.status === 404) {
          setRecord(null);
          setError(null);
          return;
        }
        if (!response.ok) {
          throw new Error(`GET failed with status ${response.status}`);
        }

        const json = await response.json();
        setRecord(json);
        setError(null);
      } catch (exc) {
        if (exc.name === "AbortError") return;
        console.error("[ResponseResistanceTab] fetch failed:", exc);
        setError(exc.message || "Failed to load response data");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [endpoint]
  );

  useEffect(() => {
    if (!endpoint) return;
    fetchSummary(false);
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [endpoint, fetchSummary]);

  /* -------------------------------------------------------------- */
  /*  Only read `response_resistance` from the summary payload       */
  /* -------------------------------------------------------------- */
  const resp = record?.data?.sections?.response_resistance || {};
  const newFindings = asArray(resp.new_findings);

  /* -------------------------------------------------------------- */
  /*  Render                                                        */
  /* -------------------------------------------------------------- */
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ fontFamily: FONT, color: C.black }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap"
        rel="stylesheet"
      />

      <Box sx={{ width: "100%" }}>
        {/* Loading */}
        {loading && !record && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>
              Loading response data…
            </Typography>
          </Box>
        )}

        {/* Error */}
        {error && !record && (
          <Box
            sx={{
              py: 4,
              textAlign: "center",
              border: `1px solid ${C.mist}`,
              background: C.ghost,
            }}
          >
            <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
              {error}
            </Typography>
            <Box
              component="button"
              onClick={() => fetchSummary(false)}
              sx={{
                ...os({
                  fontSize: 11,
                  color: C.white,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }),
                mt: 2,
                background: C.black,
                border: `1px solid ${C.black}`,
                px: 2,
                py: 0.75,
                cursor: "pointer",
              }}
            >
              Retry
            </Box>
          </Box>
        )}

        {/* No summary at all */}
        {!loading && !error && !record && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>
              No longitudinal summary has been generated for this patient yet.
            </Typography>
          </Box>
        )}

        {/* Summary present — Response & Resistance section */}
        {record && (
          <>
            {/* Status verdict cards */}
            <StatusCardGrid cards={resp.status_cards} />

            {/* New findings */}
            {newFindings.length > 0 && (
              <Box
                sx={{
                  mb: 4,
                  border: `1px solid ${C.mist}`,
                  borderLeft: `2px solid ${C.black}`,
                  background: C.ghost,
                  px: 1.75,
                  py: 1.5,
                }}
              >
                <Typography
                  sx={{
                    ...os({
                      fontSize: 11,
                      color: C.black,
                      fontWeight: FW_REGULAR,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      mb: 1,
                    }),
                  }}
                >
                  New Findings
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {newFindings.map((f, i) => (
                    <Box
                      component="li"
                      key={i}
                      sx={{ ...os({ fontSize: 12, color: C.black, mb: 0.75 }) }}
                    >
                      {isObject(f) ? (
                        <>
                          <Typography
                            component="span"
                            sx={{
                              ...os({
                                fontSize: 12,
                                color: C.black,
                                fontWeight: FW_REGULAR,
                              }),
                            }}
                          >
                            {toText(
                              pick(f, [
                                "finding",
                                "description",
                                "text",
                                "summary",
                                "statement",
                                "parameter",
                              ])
                            )}
                          </Typography>
                          {!isEmpty(f.value) && (
                            <Typography
                              component="span"
                              sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}
                            >
                              {" — "}
                              {toText(f.value)}
                              {!isEmpty(f.unit) ? ` ${toText(f.unit)}` : ""}
                            </Typography>
                          )}
                          {!isEmpty(f.status) && (
                            <Typography
                              sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}
                            >
                              {toText(f.status)}
                            </Typography>
                          )}
                        </>
                      ) : (
                        toText(f)
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {/* Summary prose */}
            <ProseCard title="Summary" value={resp.summary} />

            {/* Resistance signal */}
            <TimelineCard
              title="Resistance Signal"
              rows={resp.resistance_signal}
            />

            {/* Flowsheet (pivoted or flat) */}
            {hasUsablePivotedData(resp.flowsheet_pivoted) ? (
              <PivotedFlowsheet
                title="Multidimensional Flowsheet — Response & Tolerance"
                sub="Baseline vs. every visit, one screen"
                pivoted={resp.flowsheet_pivoted}
              />
            ) : (
              <Flowsheet
                title="Multidimensional Flowsheet — Response & Tolerance"
                sub="Every recorded parameter, one screen"
                flowsheet={resp.flowsheet}
              />
            )}

            {/* Response trajectory */}
            <TimelineCard
              title="Response Trajectory"
              rows={resp.response_trajectory}
            />
            <TimelineCard title="Trajectory" rows={resp.trajectory} />

            {/* Pathway deviation */}
            <PathwayDeviationLog
              deviations={resp.pathway_deviation}
              entries={resp.pathway_deviation_log}
            />

            {/* Outcome benchmark */}
            <EvidenceTable
              title="Outcome Benchmark"
              value={resp.outcome_benchmark}
            />
            <ProseCard
              title="Outcome Benchmark Note"
              value={resp.outcome_benchmark_note}
            />

            {/* Intelligence sub-cards (if present) */}
            {isObject(resp.intelligence) &&
              Object.values(resp.intelligence).some((v) => !isEmpty(v)) &&
              Object.entries(resp.intelligence)
                .filter(([, v]) => !isEmpty(v))
                .map(([k, v]) => (
                  <PanelCard key={k} title={prettyLabel(k)}>
                    <Value value={v} />
                  </PanelCard>
                ))}

            {/* Narrative */}
            <ProseCard title="Narrative" value={resp.narrative} />
          </>
        )}
      </Box>
    </motion.div>
  );
}