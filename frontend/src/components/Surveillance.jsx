import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Brand tokens — matched to Response.jsx / Surveillance.jsx          */
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
/*  Structural helpers (no clinical knowledge)                         */
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

const numericValue = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
    sx={{ ...os({ fontSize: 11, color: C.ash, mb: 1.5, lineHeight: 1.6 }), ...sx }}
  >
    {children}
  </Typography>
);

const PanelCard = ({ title, sub, children, sx = {} }) => (
  <Box sx={{ mb: 4, ...sx }}>
    {title && (
      <Box sx={{ pb: 1.25, mb: 1.5, borderBottom: `1px solid ${C.mist}` }}>
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

const EmptyNote = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 12, color: C.ash, lineHeight: 1.6 }) }}>
    {children || "Nothing recorded in the source for this section yet."}
  </Typography>
);

/** Themed table used by the table-view cards. */
const ThemedTable = ({ columns, rows, renderCell }) => (
  <Box sx={{ overflowX: "auto", width: "100%" }}>
    <Box
      component="table"
      sx={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}
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
  </Box>
);

/* ------------------------------------------------------------------ */
/*  Chart-view primitives (from the original Trends & Statistics)      */
/* ------------------------------------------------------------------ */
const CHART_PALETTE = [
  "#1e4a99",
  "#1f6b3a",
  "#9c2a2d",
  "#8a5a09",
  "#6b3fa0",
  "#0f7b8a",
  "#c2185b",
  "#455a64",
  "#7cb342",
  "#5d4037",
];
const colorForIndex = (i) => CHART_PALETTE[i % CHART_PALETTE.length];

function declutterLabelColumn(entries, minGap = 12) {
  const sorted = [...entries].sort((a, b) => a.y - b.y);
  let prevLabelY = null;
  sorted.forEach((entry) => {
    let desired = entry.y - 9;
    if (prevLabelY !== null && desired < prevLabelY + minGap) {
      desired = prevLabelY + minGap;
    }
    entry.labelY = desired;
    prevLabelY = desired;
  });
  return sorted;
}

const TREND_GLYPHS = { up: "↑", down: "↓", flat: "→", mixed: "↕" };

/* ------------------------------------------------------------------ */
/*  Table view card                                                    */
/* ------------------------------------------------------------------ */
function PivotTableCard({ title, pivoted }) {
  if (!isObject(pivoted)) return null;
  const visitAxis = Array.isArray(pivoted.visit_axis) ? pivoted.visit_axis : [];
  const rows = Array.isArray(pivoted.rows)
    ? pivoted.rows.filter((row) => isObject(row) && !isEmpty(row))
    : [];
  if (!rows.length) return null;

  const visitLabel = (v) =>
    v.visit_number === 1 ? "Baseline" : `Visit ${v.visit_number}`;

  return (
    <PanelCard title={toText(title)}>
      <Box sx={{ overflowX: "auto", width: "100%" }}>
        <Box
          component="table"
          sx={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}
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
              {visitAxis.map((v) => (
                <Box
                  component="th"
                  key={v.visit_number}
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
                  {visitLabel(v)}
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
              const lastCellStatus = [...cells]
                .reverse()
                .find((cell) => !isEmpty(cell?.status));
              return (
                <Box component="tr" key={row.series_id || index}>
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
                  {visitAxis.map((v) => {
                    const cell = cells.find(
                      (c) => c?.visit_number === v.visit_number
                    );
                    const blank = !cell || isEmpty(cell.value);
                    return (
                      <Box
                        component="td"
                        key={v.visit_number}
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
                      ? TREND_GLYPHS[row.trend] || toText(row.trend)
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
                    {!isEmpty(row.status)
                      ? toText(row.status)
                      : lastCellStatus && !isEmpty(lastCellStatus.status)
                      ? toText(lastCellStatus.status)
                      : "—"}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Chart view card                                                    */
/* ------------------------------------------------------------------ */
function ChartViewCard({ view }) {
  const allSeries = useMemo(
    () =>
      asArray(view?.series).filter(
        (series) => isObject(series) && asArray(series.points).length > 0
      ),
    [view]
  );

  const seriesMeta = useMemo(
    () =>
      allSeries.map((series, index) => ({
        key: series.series_id || series.name || series.parameter || `series-${index}`,
        label: toText(series.name || series.parameter) || `Series ${index + 1}`,
        color: colorForIndex(index),
      })),
    [allSeries]
  );

  const [hidden, setHidden] = useState(() => new Set());
  if (!allSeries.length) return null;

  const toggleSeries = (key) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const W = 720;
  const H = 260;
  const padLeft = 55;
  const padRight = 25;
  const padTop = 36;
  const padBottom = 52;
  const innerWidth = W - padLeft - padRight;
  const innerHeight = H - padTop - padBottom;

  const axisMap = new Map();
  allSeries.forEach((series) => {
    asArray(series.points).forEach((point) => {
      if (!isObject(point) || point.visit_number == null) return;
      if (!axisMap.has(point.visit_number)) {
        axisMap.set(point.visit_number, point.visit_date || null);
      }
    });
  });
  const globalAxis = Array.from(axisMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([visit_number, visit_date]) => ({ visit_number, visit_date }));
  const axisIndex = new Map(globalAxis.map((entry, i) => [entry.visit_number, i]));
  const axisStep =
    globalAxis.length > 1 ? innerWidth / (globalAxis.length - 1) : 0;

  const legend = (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
      {seriesMeta.map((meta) => {
        const isHidden = hidden.has(meta.key);
        return (
          <Box
            key={meta.key}
            component="button"
            onClick={() => toggleSeries(meta.key)}
            sx={{
              ...os({
                fontSize: 11,
                color: isHidden ? C.ash : C.black,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }),
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              border: `1px solid ${isHidden ? C.mist : C.black}`,
              background: isHidden ? C.white : C.ghost,
              px: 1.25,
              py: 0.5,
              cursor: "pointer",
              opacity: isHidden ? 0.7 : 1,
            }}
            title={isHidden ? "Click to show" : "Click to hide"}
          >
            <Box
              component="span"
              sx={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isHidden ? C.mist : meta.color,
              }}
            />
            {meta.label}
          </Box>
        );
      })}
    </Box>
  );

  const visibleSeries = allSeries.filter(
    (_, index) => !hidden.has(seriesMeta[index].key)
  );

  const seriesData = visibleSeries
    .map((series) => {
      const metaIndex = allSeries.indexOf(series);
      const meta = seriesMeta[metaIndex];

      const points = asArray(series.points)
        .map((point) => ({
          raw: point,
          numeric: numericValue(point?.value),
          visitNumber: point?.visit_number,
          label:
            toText(point?.visit_date) ||
            (point?.visit_number != null
              ? `Visit ${point.visit_number}`
              : ""),
          displayValue: toText(point?.value),
        }))
        .filter((point) => !isEmpty(point.displayValue));

      if (!points.length) return null;

      return {
        ...series,
        meta,
        unit: (series.unit || "").trim(),
        points,
        isNumeric: points.some((point) => point.numeric !== null),
      };
    })
    .filter(Boolean);

  if (!seriesData.length) {
    return (
      <PanelCard title={toText(view.title)}>
        {legend}
        <EmptyNote>No series currently selected.</EmptyNote>
      </PanelCard>
    );
  }

  const allNumeric = seriesData.every(
    (series) =>
      series.points.length > 0 &&
      series.points.every((point) => point.numeric !== null)
  );

  /* -------- NUMERIC SVG CHART -------- */
  if (allNumeric) {
    const unitSet = new Set(seriesData.map((s) => s.unit).filter(Boolean));
    const useSharedScale = unitSet.size === 1 && seriesData.every((s) => s.unit);

    const referenceValue =
      seriesData.length === 1 && isObject(view.reference_line)
        ? numericValue(view.reference_line.value)
        : null;

    let sharedMin = null;
    let sharedMax = null;
    if (useSharedScale) {
      const allValues = seriesData.flatMap((s) =>
        s.points.map((p) => p.numeric)
      );
      sharedMin = Math.min(
        ...allValues,
        ...(referenceValue !== null ? [referenceValue] : [])
      );
      sharedMax = Math.max(
        ...allValues,
        ...(referenceValue !== null ? [referenceValue] : [])
      );
      if (sharedMin === sharedMax) {
        sharedMin -= 1;
        sharedMax += 1;
      }
    }

    const numericSeries = seriesData.map((series) => {
      let min;
      let max;
      if (useSharedScale) {
        min = sharedMin;
        max = sharedMax;
      } else {
        const values = series.points.map((point) => point.numeric);
        const ownRef =
          seriesData.length === 1 && isObject(view.reference_line)
            ? numericValue(view.reference_line.value)
            : null;
        min = Math.min(...values, ...(ownRef !== null ? [ownRef] : []));
        max = Math.max(...values, ...(ownRef !== null ? [ownRef] : []));
        if (min === max) {
          min -= 1;
          max += 1;
        }
      }
      const span = max - min;
      const coords = series.points.map((point) => {
        const idx = axisIndex.has(point.visitNumber)
          ? axisIndex.get(point.visitNumber)
          : 0;
        return {
          ...point,
          axisIdx: idx,
          x: padLeft + axisStep * idx,
          y: padTop + innerHeight * (1 - (point.numeric - min) / span),
        };
      });
      return { ...series, coords, min, max };
    });

    const columns = new Map();
    numericSeries.forEach((series) => {
      series.coords.forEach((point) => {
        const bucket = columns.get(point.axisIdx) || [];
        bucket.push(point);
        columns.set(point.axisIdx, bucket);
      });
    });
    columns.forEach((entries) => declutterLabelColumn(entries));

    const reference =
      useSharedScale ||
      (seriesData.length === 1 &&
        isObject(view.reference_line) &&
        !isEmpty(view.reference_line.value))
        ? isObject(view.reference_line) && !isEmpty(view.reference_line.value)
          ? view.reference_line
          : null
        : null;
    const referenceValueForLine = reference
      ? numericValue(reference.value)
      : null;

    let referenceY = null;
    if (referenceValueForLine !== null && numericSeries[0]) {
      const first = numericSeries[0];
      referenceY =
        padTop +
        innerHeight *
          (1 - (referenceValueForLine - first.min) / (first.max - first.min));
    }

    return (
      <PanelCard title={toText(view.title)}>
        {legend}
        <Box sx={{ width: "100%", overflowX: "auto" }}>
          <Box
            component="svg"
            viewBox={`0 0 ${W} ${H}`}
            sx={{
              width: "100%",
              height: "auto",
              display: "block",
              color: C.black,
            }}
            role="img"
            aria-label={toText(view.title)}
          >
            <line
              x1={padLeft}
              y1={H - padBottom}
              x2={W - padRight}
              y2={H - padBottom}
              stroke={C.mist}
              strokeWidth="1"
            />
            <line
              x1={padLeft}
              y1={padTop}
              x2={padLeft}
              y2={H - padBottom}
              stroke={C.mist}
              strokeWidth="1"
            />

            {referenceY !== null && (
              <>
                <line
                  x1={padLeft}
                  y1={referenceY}
                  x2={W - padRight}
                  y2={referenceY}
                  stroke={C.charcoal}
                  strokeWidth="1"
                  strokeDasharray="5 4"
                  opacity="0.55"
                />
                <text
                  x={W - padRight}
                  y={referenceY - 6}
                  fontSize="9"
                  fill={C.ash}
                  textAnchor="end"
                >
                  {toText(reference.label) ||
                    `${toText(reference.value)} ${toText(reference.unit)}`}
                </text>
              </>
            )}

            {numericSeries.map((series) => (
              <g key={series.meta.key}>
                <polyline
                  points={series.coords
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")}
                  fill="none"
                  stroke={series.meta.color}
                  strokeWidth="1.6"
                />
                {series.coords.map((point, pointIndex) => (
                  <g key={pointIndex}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="3.4"
                      fill={series.meta.color}
                    />
                    <text
                      x={point.x}
                      y={point.labelY ?? point.y - 9}
                      fontSize="9.5"
                      fill={series.meta.color}
                      textAnchor="middle"
                    >
                      {point.displayValue}
                    </text>
                  </g>
                ))}
              </g>
            ))}

            {globalAxis.map((entry, index) => {
              const x = padLeft + axisStep * index;
              const label =
                toText(entry.visit_date) ||
                (entry.visit_number != null
                  ? `Visit ${entry.visit_number}`
                  : "");
              return (
                <text
                  key={entry.visit_number ?? index}
                  x={x}
                  y={H - 17}
                  fontSize="9.5"
                  fill={C.ash}
                  textAnchor="middle"
                >
                  {label}
                </text>
              );
            })}
          </Box>
        </Box>
        {!useSharedScale && seriesData.length > 1 && (
          <Typography
            sx={{ ...os({ fontSize: 11, color: C.ash, mt: 1, lineHeight: 1.6 }) }}
          >
            These parameters use different units, so each line is scaled
            independently to show its own trend clearly — use the legend above
            to focus on one at a time.
          </Typography>
        )}
      </PanelCard>
    );
  }

  /* -------- CATEGORICAL SVG CHART -------- */
  const categories = [];
  seriesData.forEach((series) => {
    series.points.forEach((point) => {
      if (point.displayValue && !categories.includes(point.displayValue)) {
        categories.push(point.displayValue);
      }
    });
  });
  const categoryIndex = new Map(
    categories.map((value, index) => [value, index])
  );

  const categoricalSeries = seriesData.map((series) => {
    const coords = series.points.map((point) => {
      const idx = axisIndex.has(point.visitNumber)
        ? axisIndex.get(point.visitNumber)
        : 0;
      const category = categoryIndex.get(point.displayValue);
      const y =
        categories.length > 1
          ? padTop + innerHeight * (1 - category / (categories.length - 1))
          : padTop + innerHeight / 2;
      return { ...point, axisIdx: idx, x: padLeft + axisStep * idx, y };
    });
    return { ...series, coords };
  });

  const categoricalColumns = new Map();
  categoricalSeries.forEach((series) => {
    series.coords.forEach((point) => {
      const bucket = categoricalColumns.get(point.axisIdx) || [];
      bucket.push(point);
      categoricalColumns.set(point.axisIdx, bucket);
    });
  });
  categoricalColumns.forEach((entries) => declutterLabelColumn(entries));

  return (
    <PanelCard title={toText(view.title)}>
      {legend}
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <Box
          component="svg"
          viewBox={`0 0 ${W} ${H}`}
          sx={{ width: "100%", height: "auto", display: "block", color: C.black }}
          role="img"
          aria-label={toText(view.title)}
        >
          <line
            x1={padLeft}
            y1={H - padBottom}
            x2={W - padRight}
            y2={H - padBottom}
            stroke={C.mist}
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={padTop}
            x2={padLeft}
            y2={H - padBottom}
            stroke={C.mist}
            strokeWidth="1"
          />

          {categories.map((category, index) => {
            const y =
              categories.length > 1
                ? padTop + innerHeight * (1 - index / (categories.length - 1))
                : padTop + innerHeight / 2;
            return (
              <text
                key={category}
                x={padLeft - 8}
                y={y + 3}
                fontSize="9"
                fill={C.ash}
                textAnchor="end"
              >
                {category}
              </text>
            );
          })}

          {categoricalSeries.map((series) => (
            <g key={series.meta.key}>
              {series.coords.length > 1 && (
                <polyline
                  points={series.coords
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")}
                  fill="none"
                  stroke={series.meta.color}
                  strokeWidth="1.6"
                />
              )}
              {series.coords.map((point, pointIndex) => (
                <g key={pointIndex}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="3.4"
                    fill={series.meta.color}
                  />
                  <text
                    x={point.x}
                    y={point.labelY ?? point.y - 9}
                    fontSize="9.5"
                    fill={series.meta.color}
                    textAnchor="middle"
                  >
                    {point.displayValue}
                  </text>
                </g>
              ))}
            </g>
          ))}

          {globalAxis.map((entry, index) => {
            const x = padLeft + axisStep * index;
            const label =
              toText(entry.visit_date) ||
              (entry.visit_number != null ? `Visit ${entry.visit_number}` : "");
            return (
              <text
                key={entry.visit_number ?? index}
                x={x}
                y={H - 17}
                fontSize="9.5"
                fill={C.ash}
                textAnchor="middle"
              >
                {label}
              </text>
            );
          })}
        </Box>
      </Box>
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Structural converters between table & chart shapes                 */
/* ------------------------------------------------------------------ */
function chartViewToPivotedTable(view) {
  const seriesList = asArray(view?.series).filter((s) => isObject(s));
  if (!seriesList.length) return null;

  const axisMap = new Map();
  seriesList.forEach((series) => {
    asArray(series.points).forEach((p) => {
      if (p?.visit_number != null && !axisMap.has(p.visit_number)) {
        axisMap.set(p.visit_number, p.visit_date || null);
      }
    });
  });

  const visit_axis = Array.from(axisMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([visit_number, visit_date]) => ({ visit_number, visit_date }));
  if (!visit_axis.length) return null;

  const rows = seriesList.map((series) => {
    const cells = visit_axis.map((v) => {
      const point = asArray(series.points).find(
        (p) => p?.visit_number === v.visit_number
      );
      return point
        ? {
            visit_number: v.visit_number,
            visit_date: point.visit_date || v.visit_date,
            value: point.value,
            status: point.status,
            event_ids: asArray(point.event_ids),
            unit: point.unit,
          }
        : {
            visit_number: v.visit_number,
            visit_date: v.visit_date,
            value: null,
            status: null,
            event_ids: [],
          };
    });

    const populated = cells.filter(
      (c) => !isEmpty(c.value) && numericValue(c.value) !== null
    );
    let trend = null;
    if (populated.length >= 2) {
      const prev = numericValue(populated[populated.length - 2].value);
      const curr = numericValue(populated[populated.length - 1].value);
      if (prev != null && curr != null) {
        trend = curr > prev ? "up" : curr < prev ? "down" : "flat";
      }
    }

    return {
      series_id: series.series_id,
      parameter: series.parameter || series.name,
      unit: series.unit,
      category: null,
      cells,
      trend,
      trend_rationale: null,
      status: null,
      status_rationale: null,
    };
  });

  return { visit_axis, rows };
}

function pivotedTableToChartSeries(pivoted) {
  if (!isObject(pivoted)) return null;
  const visitAxis = Array.isArray(pivoted.visit_axis) ? pivoted.visit_axis : [];
  const rows = Array.isArray(pivoted.rows)
    ? pivoted.rows.filter((r) => isObject(r) && !isEmpty(r))
    : [];
  if (!rows.length || !visitAxis.length) return null;

  return rows.map((row) => {
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const points = visitAxis.map((v) => {
      const cell = cells.find((c) => c?.visit_number === v.visit_number);
      return {
        visit_number: v.visit_number,
        visit_date: cell?.visit_date || v.visit_date,
        value: cell?.value ?? null,
        unit: cell?.unit || row.unit,
        status: cell?.status ?? null,
        event_ids: asArray(cell?.event_ids),
      };
    });
    return {
      series_id: row.series_id,
      name: row.parameter,
      parameter: row.parameter,
      unit: row.unit,
      points,
    };
  });
}

function normalizeViewDisplay(view, targetType) {
  if (!isObject(view) || !targetType || view.view_type === targetType) {
    return view;
  }
  if (targetType === "table") {
    const pivoted = chartViewToPivotedTable(view);
    return pivoted ? { ...view, view_type: "table", pivoted } : view;
  }
  if (targetType === "chart") {
    const series = pivotedTableToChartSeries(view.pivoted);
    return series ? { ...view, view_type: "chart", series } : view;
  }
  return view;
}

/**
 * Per-slot display preference. These five keys are the app's own fixed
 * Trends & Statistics contract slots — not clinical terms.
 */
const TRENDS_DISPLAY_OVERRIDES = {
  toxicity_visit_over_visit: "table",
  key_labs: "chart",
};

function CuratedViews({ views }) {
  const items = asArray(views).filter(
    (view) => isObject(view) && !isEmpty(view)
  );

  if (!items.length) {
    return (
      <PanelCard title="Trends & Statistics">
        <EmptyNote>No source-supported trend data is available yet.</EmptyNote>
      </PanelCard>
    );
  }

  return (
    <>
      {items.map((view, index) => {
        if (view.view_type === "chart") {
          return (
            <ChartViewCard
              key={view.id || view.presentation_slot || index}
              view={view}
            />
          );
        }
        if (view.view_type === "table") {
          return (
            <PivotTableCard
              key={view.id || view.presentation_slot || index}
              title={view.title}
              pivoted={view.pivoted}
            />
          );
        }
        return null;
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component — Trends & Statistics only                          */
/* ------------------------------------------------------------------ */
export default function TrendsStatisticsTab({
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
        console.error("[TrendsStatisticsTab] fetch failed:", exc);
        setError(exc.message || "Failed to load trends data");
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
  /*  Only read `trends_statistics` from the summary payload         */
  /* -------------------------------------------------------------- */
  const trends = record?.data?.sections?.trends_statistics || {};

  const trendsViews = useMemo(() => {
    if (Array.isArray(trends.presentation_views)) {
      return trends.presentation_views.filter(
        (view) => isObject(view) && !isEmpty(view)
      );
    }
    const slots = [
      "cumulative_dose_vs_limit",
      "toxicity_visit_over_visit",
      "tumor_burden",
      "key_labs",
      "biomarkers",
    ];
    return slots
      .map((slot) => {
        const view = trends[slot];
        if (!isObject(view) || isEmpty(view)) return null;
        return normalizeViewDisplay(view, TRENDS_DISPLAY_OVERRIDES[slot]);
      })
      .filter((view) => isObject(view) && !isEmpty(view));
  }, [trends]);

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
              Loading trends…
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

        {/* Summary present — Trends & Statistics only */}
        {record && <CuratedViews views={trendsViews} />}
      </Box>
    </motion.div>
  );
}