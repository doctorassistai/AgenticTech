import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * LongitudinalSummaryTab
 * ======================
 *
 * Reads the LATEST persisted longitudinal summary:
 *
 *   GET {apiBaseUrl}/hms/users/ai-legacy/api/patients/{patient_id}/longitudinal-summary
 *
 * Refetches on mount, on `refreshKey` change, on window focus and on a poll
 * interval, so a background Celery run appears without a reload.
 *
 * The component is SELF-CONTAINED: it injects its own scoped stylesheet that
 * reproduces the reference HTML design, so it does not depend on any global
 * CSS being present in the host app.
 *
 * Nothing clinical is hardcoded — no keyword maps, no fixed metric names, no
 * disease assumptions. Whatever the agents produced under `data.sections` is
 * rendered generically into the matching card.
 */

// ===========================================================================
// SCOPED STYLES  (everything lives under .lsum)
// ===========================================================================

const STYLES = `
.lsum{--ink:#111214;--ink-soft:#6b6d74;--line:#e4e5e9;--line-soft:#eff0f3;
  --bg:#ffffff;--bg-soft:#fafafb;--head:#f6f6f8;--accent:#111214;
  --blu-bg:#eaf1fd;--blu-tx:#1e4a99;--pur-bg:#f5f3ff;--pur-b:#d9d2f7;
  color:var(--ink);background:var(--bg);
  font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:13.5px;line-height:1.5;padding:22px 26px 60px;}
.lsum *{box-sizing:border-box;}
.lsum .eyebrow{font-size:11px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-soft);margin-bottom:4px;}
.lsum .h1{font-size:23px;font-weight:650;letter-spacing:-.01em;margin:0 0 18px;}
.lsum .grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));
  border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg);}
.lsum .cell{padding:13px 16px;border-right:1px solid var(--line);}
.lsum .cell:last-child{border-right:none;}
.lsum .lbl{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-soft);margin-bottom:5px;}
.lsum .val{font-weight:600;}
.lsum .val.small{font-size:13px;font-weight:600;line-height:1.35;}
.lsum .subtabs{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 16px;}
.lsum .subtabs button{font:inherit;font-size:12.5px;padding:7px 14px;border-radius:7px;
  border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer;
  transition:background .12s,color .12s,border-color .12s;}
.lsum .subtabs button:hover{background:var(--head);}
.lsum .subtabs button.active{background:var(--accent);color:#fff;border-color:var(--accent);}
.lsum .card{border:1px solid var(--line);border-radius:9px;background:var(--bg);
  margin-bottom:14px;overflow:hidden;}
.lsum .card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:11px 16px;background:var(--bg-soft);border-bottom:1px solid var(--line);}
.lsum .card-head h3{margin:0;font-size:13.5px;font-weight:650;}
.lsum .card-head .sub{font-size:11.5px;color:var(--ink-soft);text-align:right;}
.lsum .card-body{padding:14px 16px;}
.lsum table{width:100%;border-collapse:collapse;font-size:12.8px;}
.lsum th{text-align:left;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink-soft);font-weight:600;padding:8px 10px;background:var(--head);
  border-bottom:1px solid var(--line);white-space:nowrap;}
.lsum td{padding:9px 10px;border-bottom:1px solid var(--line-soft);vertical-align:top;}
.lsum tr:last-child td{border-bottom:none;}
.lsum td.param{width:30%;color:var(--ink-soft);font-weight:600;}
.lsum .chip{display:inline-block;padding:1px 7px;border-radius:5px;font-size:10.5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-soft);
  background:var(--head);border:1px solid var(--line);white-space:nowrap;}
.lsum ul.plain{margin:0;padding-left:18px;}
.lsum ul.plain li{margin-bottom:6px;}
.lsum ul.plain li:last-child{margin-bottom:0;}
.lsum .note{font-size:13px;line-height:1.6;color:var(--ink);}
.lsum .note.muted{color:var(--ink-soft);}
.lsum .board-grid{
  display:grid;
  grid-template-columns:1fr;
  gap:12px;
}
.lsum .mini-card{border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);padding:12px 14px;}
.lsum .mc-label{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-soft);margin-bottom:7px;}
.lsum .mc-body{font-size:12.8px;line-height:1.5;}
.lsum .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;
  font-weight:700;letter-spacing:.02em;text-transform:uppercase;background:var(--head);
  color:var(--ink);border:1px solid var(--line);}
.lsum .board-grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
  gap:12px;margin-bottom:14px;}
.lsum .board-grid-2 .mini-card{margin:0;}
.lsum .fs-trend{text-align:center;font-weight:600;color:var(--ink-soft);}
.lsum .fs-empty{color:var(--line);}

.lsum .newfind-banner{border:1px solid #cfdcf6;background:var(--blu-bg);border-radius:9px;
  padding:13px 16px;margin-bottom:14px;}
.lsum .newfind-banner .nf-title{font-weight:650;color:var(--blu-tx);margin-bottom:7px;font-size:13px;}
.lsum .newfind-banner ul{margin:0;padding-left:18px;}
.lsum .newfind-banner li{margin-bottom:5px;font-size:12.8px;}
.lsum .frontier-banner{border:1px solid var(--pur-b);background:var(--pur-bg);border-radius:9px;
  padding:13px 16px;font-size:12.8px;line-height:1.6;}
.lsum .filterbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px;}
.lsum .fb-label{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);}
.lsum .filterbar button{font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;
  border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer;}
.lsum .filterbar button:hover{background:var(--head);}
.lsum .flowsheet-wrap{
  width:100%;
  overflow-x:auto;
}

.lsum .flowsheet-wrap table{
  min-width:620px;
}

.lsum .flowsheet-wrap td{
  padding:8px 10px;
  vertical-align:middle;
}

.lsum .flowsheet-wrap th{
  padding:8px 10px;
}
  .lsum .flowsheet-group{
  margin-bottom:14px;
}

.lsum .flowsheet-group:last-child{
  margin-bottom:0;
}

.lsum .flowsheet-group-title{
  font-size:11px;
  font-weight:650;
  letter-spacing:.07em;
  text-transform:uppercase;
  color:var(--ink-soft);
  margin:0 0 7px;
}

.lsum .fs-group-row td{background:var(--head);font-size:10.5px;font-weight:650;
  letter-spacing:.07em;text-transform:uppercase;color:var(--ink-soft);
  padding:7px 10px;border-bottom:1px solid var(--line);}

.lsum .fs-baseline{background:var(--pur-bg);}
.lsum .timeline-list{display:flex;flex-direction:column;gap:14px;}
.lsum .timeline-item{border-left:2px solid var(--line);padding-left:12px;}
.lsum .timeline-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:5px;}
.lsum .timeline-body{font-size:12.8px;line-height:1.6;color:var(--ink);}
.lsum .timeline-body strong{color:var(--ink-soft);font-weight:600;}

.lsum .flowsheet-wrap ul.plain{
  margin:0;
  padding-left:16px;
}

.lsum .flowsheet-wrap ul.plain li{
  margin:0 0 3px 0;
  line-height:1.35;
}

.lsum .flowsheet-wrap ul.plain li:last-child{
  margin-bottom:0;
}
  .lsum .compact-values{
  display:flex;
  flex-direction:column;
  gap:3px;
}

.lsum .compact-value{
  line-height:1.35;
  white-space:normal;
}
.lsum .two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;
  margin-bottom:14px;}
.lsum .two-col .card{margin-bottom:0;}
.lsum .spark{display:block;width:100%;}
.lsum .legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px;font-size:11.5px;color:var(--ink-soft);}
.lsum .legend .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;}
.lsum .subpage{display:none;}
.lsum .subpage.active{display:block;}
.lsum .toolbar{display:flex;align-items:center;gap:10px;}
.lsum .toolbar button{font:inherit;font-size:12px;padding:6px 13px;border-radius:7px;
  border:1px solid var(--line);background:var(--bg);cursor:pointer;}
.lsum .toolbar button:hover{background:var(--head);}
.lsum .kv-nest td.param{width:38%;font-weight:500;}
`;

function StyleTag() {
  return <style dangerouslySetInnerHTML={{ __html: STYLES }} />;
}

// ===========================================================================
// GENERIC HELPERS  (no clinical knowledge anywhere)
// ===========================================================================

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isEmpty = (v) => {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (isObject(v)) return Object.keys(v).every((k) => isEmpty(v[k]));
  return false;
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

const asArray = (v) => {
  if (isEmpty(v)) return [];
  return Array.isArray(v) ? v : [v];
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

// ================================================================
// FORMAT SIZE VALUES FOR FLOWSHEET
// ================================================================

const formatSizeValue = (value, unit) => {
  if (isEmpty(value)) return [];

  const values = asArray(value).filter((v) => !isEmpty(v));

  return values.flatMap((v) => {
    // Object such as:
    // { max: 13, min: 11 }
    if (isObject(v)) {
      return [
        Object.entries(v)
          .filter(([, x]) => !isEmpty(x))
          .map(([k, x]) => `${prettyLabel(k)}: ${toText(x)} ${unit}`)
          .join(" · "),
      ];
    }

    // Scalar
    return [`${toText(v)} ${unit}`];
  });
};

const normalizeFlowRow = (row) => {
  if (!isObject(row)) return row;

  const normalized = { ...row };

  const sizeValues = [
    ...formatSizeValue(row.size_mm, "mm"),
    ...formatSizeValue(row.size_cm, "cm"),
  ];

  // Remove the two separate backend columns
  delete normalized.size_mm;
  delete normalized.size_cm;

  // Create ONE Size column
  if (sizeValues.length) {
    normalized.size = sizeValues;
  }

  return normalized;
};



const normalizeMarkerRow = (row) => {
  if (!isObject(row)) return row;

  const normalized = { ...row };

  const percentage = !isEmpty(row.percentage)
    ? asArray(row.percentage)
    : [];

  const score = !isEmpty(row.score)
    ? asArray(row.score)
    : [];

  const combined = [
    ...percentage.map((v) => toText(v)),
    ...score.map((v) => toText(v)),
  ].filter(Boolean);

  delete normalized.percentage;
  delete normalized.score;

  if (combined.length) {
    normalized.percentage_score = combined;
  }

  return normalized;
};

/** Identifier-ish keys become a small source chip instead of a column. */
const SOURCE_KEY = /^(event_id|source_event_id|document_id|id)$/i;

// ===========================================================================
// GENERIC RENDERERS
// ===========================================================================

function EmptyNote({ children }) {
  return (
    <div className="note muted">
      {children || "Nothing recorded in the source for this section yet."}
    </div>
  );
}

function SourceChip({ value }) {
  if (isEmpty(value)) return null;
  return <span className="chip">{toText(value)}</span>;
}

/** Recursive value renderer: scalar / list / object / rows. */
function Value({ value, depth = 0 }) {
  if (isEmpty(value)) return <span className="note muted">—</span>;

  if (Array.isArray(value)) return <Rows rows={value} depth={depth} />;

  if (isObject(value)) {
    return (
      <table className={depth > 0 ? "kv-nest" : undefined}>
        <tbody>
          {Object.entries(value)
            .filter(([, v]) => !isEmpty(v))
            .map(([k, v]) => (
              <tr key={k}>
                <td className="param">{prettyLabel(k)}</td>
                <td>
                  {isObject(v) || Array.isArray(v) ? (
                    <Value value={v} depth={depth + 1} />
                  ) : (
                    toText(v)
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    );
  }

  return <>{toText(value)}</>;
}
function CompactValue({ value }) {
  if (isEmpty(value)) {
    return <span className="note muted">—</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="compact-values">
        {value
          .filter((v) => !isEmpty(v))
          .map((v, i) => (
            <div className="compact-value" key={i}>
              {isObject(v) ? toText(v) : String(v)}
            </div>
          ))}
      </div>
    );
  }

  return <>{toText(value)}</>;
}

const getFlowGroupKey = (row) => {
  if (!isObject(row)) return null;

  // Generic structural fields only.
  // No disease/source-specific hardcoding.
  const candidateKeys = [
    "type",
    "source_type",
    "data_type",
    "category",
    "section",
  ];

  for (const key of candidateKeys) {
    if (!isEmpty(row[key])) {
      return toText(row[key]);
    }
  }

  return null;
};

/**
 * Array renderer.
 *  - scalars            -> bullet list
 *  - 1 content column   -> bullet list with a source chip
 *  - N content columns  -> table, source chip in a trailing Source column
 */
function renderFlowTable(objects, depth = 0, groupKey = null) {
  const allKeys = unionKeys(objects).filter((k) =>
    objects.some((r) => !isEmpty(r[k]))
  );

  const sourceKeys = allKeys.filter((k) => SOURCE_KEY.test(k));

  // Do not show the grouping field as a table column.
  const columns = allKeys.filter(
    (k) => !SOURCE_KEY.test(k) && k !== groupKey
  );

  if (!columns.length) {
    return (
      <ul className="plain">
        {objects.map((row, i) => (
          <li key={i}>
            <SourceChip value={row[sourceKeys[0]]} />
          </li>
        ))}
      </ul>
    );
  }

  // One content column -> readable bullet list
  if (columns.length === 1) {
    const key = columns[0];

    return (
      <ul className="plain">
        {objects.map((row, i) => (
          <li key={i}>
            {isObject(row[key]) || Array.isArray(row[key]) ? (
              <Value value={row[key]} depth={depth + 1} />
            ) : (
              toText(row[key])
            )}{" "}
            {sourceKeys.length ? (
              <SourceChip value={row[sourceKeys[0]]} />
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flowsheet-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>
                {c === "percentage_score"
                  ? "Percentage / Score"
                  : prettyLabel(c)}
              </th>
            ))}

            {sourceKeys.length ? <th>Source</th> : null}
          </tr>
        </thead>

        <tbody>
          {objects.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>
                  {c === "size" ? (
                    <CompactValue value={row[c]} />
                  ) : isObject(row[c]) || Array.isArray(row[c]) ? (
                    <Value value={row[c]} depth={depth + 1} />
                  ) : (
                    toText(row[c])
                  )}
                </td>
              ))}

              {sourceKeys.length ? (
                <td>
                  <SourceChip value={row[sourceKeys[0]]} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}




function Rows({
  rows,
  depth = 0,
  markerMode = false,
  groupBySource = false,
}) {
  const items = asArray(rows).filter((r) => !isEmpty(r));

  if (!items.length) {
    return <EmptyNote />;
  }

  const objects = items
    .filter(isObject)
    .map(markerMode ? normalizeMarkerRow : normalizeFlowRow);

  // Scalar values
  if (!objects.length) {
    return (
      <ul className="plain">
        {items.map((item, i) => (
          <li key={i}>{toText(item)}</li>
        ))}
      </ul>
    );
  }

  /*
   * Only the "All" tab should come here with groupBySource=true.
   *
   * This prevents unrelated fields such as:
   * modality / specimen / diagnosis / panel / results
   * from becoming columns in one huge table.
   */
  if (groupBySource) {
    const groups = [];
    const groupMap = new Map();
    const ungrouped = [];

    objects.forEach((row) => {
      const groupKey = getFlowGroupKey(row);

      if (!groupKey) {
        ungrouped.push(row);
        return;
      }

      if (!groupMap.has(groupKey)) {
        const group = {
          key: groupKey,
          rows: [],
        };

        groupMap.set(groupKey, group);
        groups.push(group);
      }

      groupMap.get(groupKey).rows.push(row);
    });

    /*
     * If no usable grouping information exists,
     * keep the original rendering behavior.
     */
    if (groups.length === 0) {
      return renderFlowTable(objects, depth);
    }

    return (
      <div>
        {groups.map((group) => {
          const groupKey = [
            "type",
            "source_type",
            "data_type",
            "category",
            "section",
          ].find((key) => !isEmpty(group.rows[0]?.[key]));

          return (
            <div className="flowsheet-group" key={group.key}>
              <div className="flowsheet-group-title">
                {group.key}
              </div>

              {renderFlowTable(
                group.rows,
                depth,
                groupKey
              )}
            </div>
          );
        })}

        {ungrouped.length > 0 && (
          <div className="flowsheet-group">
            <div className="flowsheet-group-title">
              Other
            </div>

            {renderFlowTable(
              ungrouped,
              depth
            )}
          </div>
        )}
      </div>
    );
  }

  /*
   * Normal behavior for manually selected tabs:
   * Organ / Marker / Imaging / etc.
   */
  return renderFlowTable(objects, depth);
}

/**
 * Splits object rows into groups by structural similarity of their
 * populated keys. Purely structural: no field names, no domain knowledge.
 * Rows sharing most of their fields land in the same table; rows with
 * different fields get their own table.
 */
const SCHEMA_SIMILARITY_THRESHOLD = 0.5;

function clusterRowsBySchema(rows) {
  const groups = [];

  rows.forEach((row) => {
    const keys = Object.keys(row).filter(
      (k) => !isEmpty(row[k]) && !SOURCE_KEY.test(k)
    );

    let best = null;
    let bestScore = 0;

    groups.forEach((g) => {
      const intersection = keys.filter((k) => g.keys.has(k)).length;
      const union = new Set([...g.keys, ...keys]).size;
      const score = union ? intersection / union : 1;
      if (score > bestScore) {
        best = g;
        bestScore = score;
      }
    });

    if (best && bestScore >= SCHEMA_SIMILARITY_THRESHOLD) {
      best.rows.push(row);
      keys.forEach((k) => best.keys.add(k));
    } else {
      groups.push({ keys: new Set(keys), rows: [row] });
    }
  });

  return groups;
}

/** Renders an array as one table per structural group of rows. */
function SchemaGroupedRows({ rows }) {
  const items = asArray(rows).filter((r) => !isEmpty(r));

  if (!items.length) return <EmptyNote />;

  const objects = items.filter(isObject);
  const scalars = items.filter((r) => !isObject(r));
  const groups = clusterRowsBySchema(objects);

  return (
    <div>
      {groups.map((group, i) => (
        <div className="flowsheet-group" key={i}>
          <Rows rows={group.rows} />
        </div>
      ))}

      {scalars.length > 0 && (
        <div className="flowsheet-group">
          <Rows rows={scalars} />
        </div>
      )}
    </div>
  );
}


function VisitComparisonTable({ comparison }) {
  if (!isObject(comparison)) {
    return <EmptyNote />;
  }

  const rows = Object.entries(comparison)
    .filter(([, value]) => isObject(value) && !isEmpty(value))
    .map(([metric, value]) => ({
      metric,
      ...value,
    }));

  if (!rows.length) {
    return <EmptyNote />;
  }

  const formatComparisonValue = (value) => {
    if (isEmpty(value)) return "—";

    if (isObject(value) || Array.isArray(value)) {
      return toText(value);
    }

    return toText(value);
  };

  return (
    <div className="flowsheet-wrap">
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Previous</th>
            <th>Current</th>
            <th>Change</th>
            <th>Percentage Change</th>
            <th>Previous Visit</th>
            <th>Current Visit</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.metric}>
              <td className="param">
                {row.metric}
              </td>

              <td>
                {formatComparisonValue(row.previous)}
              </td>

              <td>
                {formatComparisonValue(row.current)}
              </td>

              <td>
                {formatComparisonValue(row.change)}
              </td>

              <td>
                {!isEmpty(row.percentage_change)
                  ? `${toText(row.percentage_change)}%`
                  : "—"}
              </td>

              <td>
                {!isEmpty(row.previous_visit)
                  ? `Visit ${toText(row.previous_visit)}`
                  : "—"}
              </td>

              <td>
                {!isEmpty(row.current_visit)
                  ? `Visit ${toText(row.current_visit)}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// function VisitDeltaTable({ visitDelta }) {
//   if (isEmpty(visitDelta)) {
//     return <EmptyNote />;
//   }

//   /*
//    * Visit Delta can arrive in different generic structures.
//    *
//    * Structure A:
//    * {
//    *   "Metric A": {
//    *      previous: ...,
//    *      current: ...,
//    *      change: ...,
//    *      percentage_change: ...,
//    *      previous_visit: ...,
//    *      current_visit: ...
//    *   }
//    * }
//    *
//    * Structure B:
//    * [
//    *   {
//    *      metric: ...,
//    *      previous: ...,
//    *      current: ...,
//    *      change: ...,
//    *      percentage_change: ...,
//    *      previous_visit: ...,
//    *      current_visit: ...
//    *   }
//    * ]
//    *
//    * Everything is detected structurally.
//    */

//   let rows = [];

//   // ------------------------------------------------------------
//   // ARRAY
//   // ------------------------------------------------------------
//   if (Array.isArray(visitDelta)) {
//     rows = visitDelta
//       .filter((row) => isObject(row) && !isEmpty(row))
//       .map((row) => ({
//         ...row,
//         metric:
//           row.metric ||
//           row.parameter ||
//           row.name ||
//           row.label ||
//           "",
//       }));
//   }

//   // ------------------------------------------------------------
//   // OBJECT
//   // ------------------------------------------------------------
//   else if (isObject(visitDelta)) {
//     rows = Object.entries(visitDelta)
//       .filter(([, value]) => !isEmpty(value))
//       .map(([key, value]) => {
//         if (isObject(value)) {
//           return {
//             metric:
//               value.metric ||
//               value.parameter ||
//               value.name ||
//               value.label ||
//               key,
//             ...value,
//           };
//         }

//         return {
//           metric: key,
//           current: value,
//         };
//       });
//   }

//   if (!rows.length) {
//     return <EmptyNote />;
//   }

//   // ------------------------------------------------------------
//   // Determine whether this is a comparison-style delta table.
//   // ------------------------------------------------------------
//   const comparisonKeys = [
//     "previous",
//     "current",
//     "change",
//     "percentage_change",
//     "previous_visit",
//     "current_visit",
//   ];

//   const hasComparisonStructure = rows.some((row) =>
//     comparisonKeys.some((key) => !isEmpty(row[key]))
//   );

//   // ------------------------------------------------------------
//   // COMPARISON-STYLE VISIT DELTA
//   // ------------------------------------------------------------
//   if (hasComparisonStructure) {
//     return (
//       <div className="flowsheet-wrap">
//         <table>
//           <thead>
//             <tr>
//               <th>Parameter</th>
//               <th>Previous</th>
//               <th>Current</th>
//               <th>Change</th>
//               <th>Percentage Change</th>
//               <th>Previous Visit</th>
//               <th>Current Visit</th>
//             </tr>
//           </thead>

//           <tbody>
//             {rows.map((row, index) => (
//               <tr key={`${row.metric || "row"}-${index}`}>
//                 <td className="param">
//                   {prettyLabel(row.metric || `Parameter ${index + 1}`)}
//                 </td>

//                 <td>
//                   {isEmpty(row.previous)
//                     ? "—"
//                     : toText(row.previous)}
//                 </td>

//                 <td>
//                   {isEmpty(row.current)
//                     ? "—"
//                     : toText(row.current)}
//                 </td>

//                 <td>
//                   {isEmpty(row.change)
//                     ? "—"
//                     : toText(row.change)}
//                 </td>

//                 <td>
//                   {isEmpty(row.percentage_change)
//                     ? "—"
//                     : `${toText(row.percentage_change)}%`}
//                 </td>

//                 <td>
//                   {isEmpty(row.previous_visit)
//                     ? "—"
//                     : `Visit ${toText(row.previous_visit)}`}
//                 </td>

//                 <td>
//                   {isEmpty(row.current_visit)
//                     ? "—"
//                     : `Visit ${toText(row.current_visit)}`}
//                 </td>
//               </tr>
//             ))}
//           </tbody>
//         </table>
//       </div>
//     );
//   }

//   // ------------------------------------------------------------
//   // GENERIC STRUCTURED VISIT DELTA
//   // ------------------------------------------------------------
//   const columns = unionKeys(rows).filter(
//     (key) =>
//       key !== "metric" &&
//       !SOURCE_KEY.test(key) &&
//       rows.some((row) => !isEmpty(row[key]))
//   );

//   return (
//     <div className="flowsheet-wrap">
//       <table>
//         <thead>
//           <tr>
//             <th>Parameter</th>

//             {columns.map((column) => (
//               <th key={column}>{prettyLabel(column)}</th>
//             ))}
//           </tr>
//         </thead>

//         <tbody>
//           {rows.map((row, index) => (
//             <tr key={`${row.metric || "row"}-${index}`}>
//               <td className="param">
//                 {prettyLabel(row.metric || `Parameter ${index + 1}`)}
//               </td>

//               {columns.map((column) => (
//                 <td key={column}>
//                   {isObject(row[column]) || Array.isArray(row[column]) ? (
//                     <Value value={row[column]} depth={1} />
//                   ) : (
//                     isEmpty(row[column]) ? "—" : toText(row[column])
//                   )}
//                 </td>
//               ))}
//             </tr>
//           ))}
//         </tbody>
//       </table>
//     </div>
//   );
// }





/** A card that renders only when the backend actually supplied something. */
function DataCard({ title, sub, value, children, always = false }) {
  if (!always && !children && isEmpty(value)) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {sub ? <span className="sub">{sub}</span> : null}
      </div>
      <div className="card-body">
        {children || (isEmpty(value) ? <EmptyNote /> : <Value value={value} />)}
      </div>
    </div>
  );
}

/** Prose card for narratives and summaries. */
function ProseCard({ title, value, always = false }) {
  if (!always && isEmpty(value)) return null;
  if (isObject(value) || Array.isArray(value)) {
    return <DataCard title={title} value={value} always={always} />;
  }
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      <div className="card-body">
        {isEmpty(value) ? <EmptyNote /> : <div className="note">{toText(value)}</div>}
      </div>
    </div>
  );
}

function EvidenceTable({ title, value, always = false }) {
  const rows = asArray(value).filter(
    (row) => isObject(row) && !isEmpty(row)
  );

  if (!rows.length) {
    if (!always) return null;

    return (
      <DataCard title={title} always>
        <EmptyNote />
      </DataCard>
    );
  }

  const columns = unionKeys(rows).filter(
    (key) =>
      !SOURCE_KEY.test(key) &&
      rows.some((row) => !isEmpty(row[key]))
  );

  if (!columns.length) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>

      <div className="card-body">
        <div className="flowsheet-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>
                    {prettyLabel(column)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column}>
                      {isObject(row[column]) ||
                      Array.isArray(row[column]) ? (
                        <Value
                          value={row[column]}
                          depth={1}
                        />
                      ) : (
                        isEmpty(row[column])
                          ? "—"
                          : toText(row[column])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Multi-point series -> line chart. Labels and values come from the series. */
function Sparkline({ graph }) {
  const points = asArray(graph?.series)
    .map((p) => ({
      raw: p,
      number: numericValue(p?.value),
      label:
        toText(p?.visit_date) ||
        (p?.visit_number != null ? `Visit ${p.visit_number}` : ""),
    }))
    .filter((p) => p.number !== null);

  if (points.length < 2) return null;

  const W = 600;
  const H = 110;
  const padX = 34;
  const padTop = 22;
  const padBottom = 26;

  const values = points.map((p) => p.number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (W - padX * 2) / (points.length - 1);

  const coords = points.map((p, i) => ({
    ...p,
    x: padX + step * i,
    y: padTop + (H - padTop - padBottom) * (1 - (p.number - min) / span),
  }));

  return (
    <>
      <svg className="spark" viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <polyline
          points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
          fill="none"
          stroke="#111214"
          strokeWidth="2"
        />
        {coords.map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r="3.5" fill="#111214" />
            <text
              x={c.x}
              y={c.y - 9}
              fontSize="10"
              fill="#111214"
              textAnchor="middle"
            >
              {toText(c.raw?.value)}
            </text>
            <text
              x={c.x}
              y={H - 6}
              fontSize="9.5"
              fill="#8b8c92"
              textAnchor="middle"
            >
              {c.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="legend">
        <span>
          <span className="dot" style={{ background: "#111214" }} />
          {toText(graph?.title) || "Series"}
          {coords[0]?.raw?.unit ? ` (${toText(coords[0].raw.unit)})` : ""}
        </span>
      </div>
    </>
  );
}

/**
 * Status card grid — generic verdict cards. The backend decides how many
 * cards exist and what their label/status/explanation say; nothing here
 * assumes a fixed set of four or any particular vocabulary.
 */
function StatusCardGrid({ cards }) {
  // Different backend passes may name these fields differently
  // (label/status/explanation vs title/value/description, etc).
  // These are structural synonyms, not clinical vocabulary.
  const items = asArray(cards)
    .filter((c) => isObject(c) && !isEmpty(c))
    .map((c) => ({
      key: c.id || pick(c, ["label", "title", "name"]),
      label: pick(c, ["label", "title", "name"]),
      status: pick(c, ["status", "value", "verdict"]),
      explanation: pick(c, ["explanation", "description", "detail", "note", "content"]),
    }))
    .filter(
      (c) => !isEmpty(c.label) || !isEmpty(c.status) || !isEmpty(c.explanation)
    );

  if (!items.length) return null;

  return (
    <div className="board-grid-2">
      {items.map((c, i) => (
        <div className="mini-card" key={c.key || i}>
          {!isEmpty(c.label) && <div className="mc-label">{toText(c.label)}</div>}
          <div className="mc-body">
            {!isEmpty(c.status) && <span className="pill">{toText(c.status)}</span>}
            {!isEmpty(c.status) && !isEmpty(c.explanation) ? (
              <span> — {toText(c.explanation)}</span>
            ) : (
              !isEmpty(c.explanation) && <span>{toText(c.explanation)}</span>
            )}
            {isEmpty(c.status) && isEmpty(c.explanation) && (
              <span className="note muted">No source-supported verdict yet.</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Generic timeline renderer for arrays of objects that mix short
 * identifying fields (a date, a visit number) with one or more longer
 * descriptive fields. A wide table forces horizontal scroll and clips
 * the prose; a timeline reads naturally regardless of field names.
 *
 * Which field is "meta" (chip) vs "body" (paragraph) is decided purely
 * by shape: short values whose key name or content looks like a date
 * or a visit/cycle number become chips; everything else becomes body
 * text. No clinical vocabulary involved.
 */
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
    <div className="timeline-list">
      {items.map((row, i) => {
        const { metaKeys, bodyKeys } = timelineMeta(row);
        return (
          <div className="timeline-item" key={i}>
            {metaKeys.length > 0 && (
              <div className="timeline-meta">
                {metaKeys.map((k) => (
                  <span className="chip" key={k}>
                    {toText(row[k])}
                  </span>
                ))}
              </div>
            )}
            <div className="timeline-body">
              {bodyKeys.map((k) => (
                <div key={k}>
                  {bodyKeys.length > 1 ? <strong>{prettyLabel(k)}: </strong> : null}
                  {isObject(row[k]) || Array.isArray(row[k]) ? (
                    <Value value={row[k]} depth={1} />
                  ) : (
                    toText(row[k])
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineCard({ title, rows }) {
  const items = asArray(rows).filter((r) => isObject(r) && !isEmpty(r));
  if (!items.length) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      <div className="card-body">
        <TimelineList rows={items} />
      </div>
    </div>
  );
}

/**
 * Visit-pivoted flowsheet. Consumes `flowsheet_pivoted`, a deterministic
 * backend structure: { bucketName: { visit_axis: [...], rows: [...] } }.
 * The number of visit columns, buckets, and rows is entirely data-driven —
 * nothing here assumes cycle counts, organ names, or marker names.
 */

function hasUsablePivotedData(pivoted) {
  if (!isObject(pivoted)) return false;

  return Object.values(pivoted).some((bucket) => {
    if (!isObject(bucket)) return false;

    const rows = asArray(bucket.rows);

    return rows.some((row) => {
      if (!isObject(row)) return false;

      return asArray(row.cells).some(
        (cell) =>
          isObject(cell) &&
          (
            !isEmpty(cell.value) ||
            !isEmpty(cell.status) ||
            asArray(cell.event_ids).length > 0
          )
      );
    });
  });
}

function categoryGroupKey(row) {
  const raw = row?.category;
  if (isEmpty(raw)) return null;
  const text = toText(raw);
  if (!text) return null;
  return { key: text.trim().toLowerCase(), label: text };
}

function groupPivotedRowsByCategory(rows) {
  const groups = [];
  const groupMap = new Map();
  const ungrouped = [];

  rows.forEach((row) => {
    const g = categoryGroupKey(row);
    if (!g) {
      ungrouped.push(row);
      return;
    }
    if (!groupMap.has(g.key)) {
      const group = { key: g.key, label: g.label, rows: [] };
      groupMap.set(g.key, group);
      groups.push(group);
    }
    groupMap.get(g.key).rows.push(row);
  });

  return { groups, ungrouped };
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

  /*
   * The backend provides:
   *
   * flowsheet_pivoted:
   * {
   *   organ: {...},
   *   marker: {...},
   *   imaging: {...}
   * }
   *
   * There is intentionally no dependency on a hardcoded
   * clinical category list.
   *
   * Whatever non-empty buckets the backend provides become
   * selectable tabs.
   */
  const categories = Object.keys(buckets);

  const [active, setActive] = useState("all");

  /*
   * If the currently selected backend bucket disappears after
   * a refresh, return to All.
   */
  useEffect(() => {
    if (
      active !== "all" &&
      !Object.prototype.hasOwnProperty.call(buckets, active)
    ) {
      setActive("all");
    }
  }, [active, buckets]);

  if (!categories.length) {
    return null;
  }

  const trendGlyph = {
    up: "↑",
    down: "↓",
    flat: "→",
    mixed: "↕",
  };

  const visitLabel = (v) =>
    v.visit_number === 1
      ? "Baseline"
      : `Visit ${v.visit_number}`;

  /*
   * Render one pivoted bucket.
   *
   * This function is deliberately generic:
   * - parameter
   * - unit
   * - cells
   * - trend
   * - status
   *
   * are taken from the backend.
   */
  const renderBucketTable = (data, keyPrefix = "") => {
    if (!isObject(data)) {
      return <EmptyNote />;
    }

    const visitAxis = Array.isArray(data.visit_axis)
      ? data.visit_axis
      : [];

    const rows = Array.isArray(data.rows)
      ? data.rows.filter((row) => isObject(row) && !isEmpty(row))
      : [];

    if (!rows.length) {
      return <EmptyNote />;
    }

    const colSpan = visitAxis.length + 3;

    const renderRow = (row, key) => {
      const cells = Array.isArray(row.cells)
        ? row.cells
        : [];

      const lastStatus = [...cells]
        .reverse()
        .find((cell) => !isEmpty(cell?.status));

      return (
        <tr key={key}>
          <td className="param">
            {toText(row.parameter)}
            {!isEmpty(row.unit)
              ? ` (${toText(row.unit)})`
              : ""}
          </td>

          {visitAxis.map((visit) => {
            const cell = cells.find(
              (candidate) =>
                candidate?.visit_number === visit.visit_number
            );

            const cellClasses = [
              visit.visit_number === 1 ? "fs-baseline" : null,
              !cell || isEmpty(cell.value) ? "fs-empty" : null,
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <td
                key={visit.visit_number}
                className={cellClasses || undefined}
              >
                {!cell || isEmpty(cell.value)
                  ? "—"
                  : toText(cell.value)}
              </td>
            );
          })}

          <td
            className="fs-trend"
            title={
              !isEmpty(row.trend_rationale)
                ? toText(row.trend_rationale)
                : undefined
            }
          >
            {!isEmpty(row.trend)
              ? trendGlyph[row.trend] || toText(row.trend)
              : "—"}
          </td>

          <td>
            {lastStatus && !isEmpty(lastStatus.status) ? (
              <span className="chip">
                {toText(lastStatus.status)}
              </span>
            ) : (
              "—"
            )}
          </td>
        </tr>
      );
    };

    /*
     * All tab:
     *
     * We render the current bucket's rows as-is.
     *
     * The parent All renderer below combines the three backend
     * buckets without losing their identity.
     */
    return (
      <div className="flowsheet-wrap">
        <table>
          <thead>
            <tr>
              <th>Parameter</th>

              {visitAxis.map((visit) => (
                <th
                  key={visit.visit_number}
                  className={visit.visit_number === 1 ? "fs-baseline" : undefined}
                >
                  {visitLabel(visit)}
                </th>
              ))}

              <th>Trend</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) =>
              renderRow(
                row,
                `${keyPrefix}-${row.series_id || index}`
              )
            )}
          </tbody>
        </table>
      </div>
    );
  };

  /*
   * ------------------------------------------------------------
   * ALL
   * ------------------------------------------------------------
   *
   * IMPORTANT:
   *
   * There is no requirement for the backend to create:
   *
   *     flowsheet_pivoted.all
   *
   * Instead, All is constructed here from every available
   * backend bucket.
   */
  const renderAll = () => {
    return (
      <div>
        {categories.map((category) => {
          const data = buckets[category];

          if (!data) return null;

          return (
            <div
              className="flowsheet-group"
              key={category}
            >
              <div className="flowsheet-group-title">
                {prettyLabel(category)}
              </div>

              {renderBucketTable(
                data,
                `all-${category}`
              )}
            </div>
          );
        })}
      </div>
    );
  };

  /*
   * ------------------------------------------------------------
   * SELECTED TAB
   * ------------------------------------------------------------
   */
  const renderSelected = () => {
    const data = buckets[active];

    if (!data) {
      return <EmptyNote />;
    }

    return renderBucketTable(
      data,
      active
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>

        {sub ? (
          <span className="sub">
            {sub}
          </span>
        ) : null}
      </div>

      <div className="card-body">

        <div className="filterbar">
          <span className="fb-label">
            Show:
          </span>

          <button
            type="button"
            className={
              active === "all"
                ? "active"
                : ""
            }
            onClick={() => setActive("all")}
          >
            All
          </button>

          {categories.map((category) => (
            <button
              type="button"
              key={category}
              className={
                active === category
                  ? "active"
                  : ""
              }
              onClick={() =>
                setActive(category)
              }
            >
              {prettyLabel(category)}
            </button>
          ))}
        </div>

        {active === "all"
          ? renderAll()
          : renderSelected()}
      </div>
    </div>
  );
}


const TREND_GLYPHS = { up: "↑", down: "↓", flat: "→", mixed: "↕" };

/**
 * Renders one curated table view. Consumes the exact same
 * { visit_axis, rows } shape produced by pivot_flowsheet_bucket, so it is
 * completely data-driven — nothing here assumes clinical row/column names.
 */
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
    <div className="card">
      <div className="card-head">
        <h3>{toText(title)}</h3>
      </div>
      <div className="card-body">
        <div className="flowsheet-wrap">
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                {visitAxis.map((v) => (
                  <th key={v.visit_number}>{visitLabel(v)}</th>
                ))}
                <th>Trend</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const cells = Array.isArray(row.cells) ? row.cells : [];
                const lastCellStatus = [...cells]
                  .reverse()
                  .find((cell) => !isEmpty(cell?.status));

                return (
                  <tr key={row.series_id || index}>
                    <td className="param">
                      {toText(row.parameter)}
                      {!isEmpty(row.unit) ? ` (${toText(row.unit)})` : ""}
                    </td>
                    {visitAxis.map((v) => {
                      const cell = cells.find(
                        (c) => c?.visit_number === v.visit_number
                      );
                      return (
                        <td
                          key={v.visit_number}
                          className={
                            !cell || isEmpty(cell.value) ? "fs-empty" : undefined
                          }
                        >
                          {!cell || isEmpty(cell.value) ? "—" : toText(cell.value)}
                        </td>
                      );
                    })}
                    <td
                      className="fs-trend"
                      title={
                        !isEmpty(row.trend_rationale)
                          ? toText(row.trend_rationale)
                          : undefined
                      }
                    >
                      {!isEmpty(row.trend)
                        ? TREND_GLYPHS[row.trend] || toText(row.trend)
                        : "—"}
                    </td>
                    <td>
                      {!isEmpty(row.status) ? (
                        <span className="pill">{toText(row.status)}</span>
                      ) : lastCellStatus && !isEmpty(lastCellStatus.status) ? (
                        <span className="chip">{toText(lastCellStatus.status)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders one curated chart view: one or more resolved series, each with
 * its own min/max so they overlay on a shared pixel height regardless of
 * absolute scale, plus an optional reference/threshold line (only drawn
 * for single-series views, since a reference value is only meaningful
 * against one scale). Nothing here assumes clinical series names.
 */


/**
 * A fixed, generic color rotation — assigned purely by a series' position
 * in the array, never by what the series is called. Any number of series
 * works; colors just repeat if there are more series than palette entries.
 */
const CHART_PALETTE = [
  "#1e4a99", "#1f6b3a", "#9c2a2d", "#8a5a09",
  "#6b3fa0", "#0f7b8a", "#c2185b", "#455a64",
  "#7cb342", "#5d4037",
];
const colorForIndex = (i) => CHART_PALETTE[i % CHART_PALETTE.length];

/**
 * Renders one curated chart view. Every series gets its own color (assigned
 * purely by position, not by what it's called) and its own toggle button in
 * the legend, so any number of series stays readable regardless of how many
 * values collide on screen. All series share ONE x-axis built from every
 * visit_number/visit_date that appears anywhere in the data (with or
 * without a value), so a series with only one populated point still lands
 * at its correct visit instead of the left edge.
 */
/**
 * Declutter a column of same-x labels: sort by true y, then push any label
 * whose desired position (9px above its dot) would collide with the one
 * above it down until there's at least `minGap` between them. The dot
 * itself never moves — only where its text is drawn.
 */
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

/**
 * Renders one curated chart view. Every series gets its own color (assigned
 * purely by position, not by what it's called) and its own toggle button in
 * the legend. All series share ONE x-axis built from every visit_number
 * that appears anywhere in the data. When every visible series reports the
 * SAME unit string, they also share ONE y-scale, so real differences (2.0
 * vs 2.2) show up as real vertical gaps instead of each series collapsing
 * its own 2-point range to the full chart height. When units differ, each
 * series keeps its own scale so one parameter's absolute range doesn't
 * flatten another's. Labels are decluttered per visit column so overlapping
 * text stays legible even when dots must sit close together.
 */
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
        key:
          series.series_id ||
          series.name ||
          series.parameter ||
          `series-${index}`,
        label:
          toText(series.name || series.parameter) || `Series ${index + 1}`,
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

  // ONE shared x-axis: every visit any series carries a point for,
  // populated or not, built from RAW (unfiltered) points so a series
  // missing most of its values still positions correctly.
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
  const axisIndex = new Map(
    globalAxis.map((entry, i) => [entry.visit_number, i])
  );
  const axisStep =
    globalAxis.length > 1 ? innerWidth / (globalAxis.length - 1) : 0;

  const legend = (
    <div className="legend" style={{ marginBottom: 10 }}>
      {seriesMeta.map((meta) => {
        const isHidden = hidden.has(meta.key);
        return (
          <button
            key={meta.key}
            type="button"
            onClick={() => toggleSeries(meta.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--line)",
              borderRadius: 999,
              padding: "3px 10px",
              background: isHidden ? "var(--bg)" : "var(--head)",
              color: isHidden ? "var(--ink-soft)" : "var(--ink)",
              cursor: "pointer",
              font: "inherit",
              fontSize: 11.5,
              opacity: isHidden ? 0.55 : 1,
            }}
            title={isHidden ? "Click to show" : "Click to hide"}
          >
            <span
              className="dot"
              style={{ background: isHidden ? "var(--line)" : meta.color }}
            />
            {meta.label}
          </button>
        );
      })}
    </div>
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
      <div className="card">
        <div className="card-head">
          <h3>{toText(view.title)}</h3>
        </div>
        <div className="card-body">
          {legend}
          <EmptyNote>No series currently selected.</EmptyNote>
        </div>
      </div>
    );
  }

  const allNumeric = seriesData.every(
    (series) =>
      series.points.length > 0 &&
      series.points.every((point) => point.numeric !== null)
  );

  // ------------------------------------------------------------
  // NUMERIC SVG CHART
  // ------------------------------------------------------------
  if (allNumeric) {
    // Structural check only: do ALL currently-visible series report the
    // same non-empty unit string? If so, one shared scale preserves real
    // relative magnitude across them. If units differ, each series keeps
    // its own scale so one parameter's absolute range can't flatten
    // another's shape.
    const unitSet = new Set(seriesData.map((s) => s.unit).filter(Boolean));
    const useSharedScale =
      unitSet.size === 1 && seriesData.every((s) => s.unit);

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
        const ownReference =
          seriesData.length === 1 && isObject(view.reference_line)
            ? numericValue(view.reference_line.value)
            : null;
        min = Math.min(...values, ...(ownReference !== null ? [ownReference] : []));
        max = Math.max(...values, ...(ownReference !== null ? [ownReference] : []));
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

    // Declutter labels per visit column across ALL visible series.
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
      <div className="card">
        <div className="card-head">
          <h3>{toText(view.title)}</h3>
        </div>

        <div className="card-body">
          {legend}
          <div className="flowsheet-wrap">
            <svg
              className="spark"
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              height={H}
              role="img"
              aria-label={toText(view.title)}
            >
              <line x1={padLeft} y1={H - padBottom} x2={W - padRight} y2={H - padBottom} stroke="#d9dadd" strokeWidth="1" />
              <line x1={padLeft} y1={padTop} x2={padLeft} y2={H - padBottom} stroke="#d9dadd" strokeWidth="1" />

              {referenceY !== null && (
                <>
                  <line x1={padLeft} y1={referenceY} x2={W - padRight} y2={referenceY} stroke="#9c2a2d" strokeWidth="1" strokeDasharray="5 4" />
                  <text x={W - padRight} y={referenceY - 6} fontSize="9" fill="#9c2a2d" textAnchor="end">
                    {toText(reference.label) || `${toText(reference.value)} ${toText(reference.unit)}`}
                  </text>
                </>
              )}

              {numericSeries.map((series) => (
                <g key={series.meta.key}>
                  <polyline
                    points={series.coords.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke={series.meta.color}
                    strokeWidth="2"
                  />
                  {series.coords.map((point, pointIndex) => (
                    <g key={pointIndex}>
                      <circle cx={point.x} cy={point.y} r="3.5" fill={series.meta.color} />
                      <text
                        x={point.x}
                        y={point.labelY ?? point.y - 9}
                        fontSize="9"
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
                  <text key={entry.visit_number ?? index} x={x} y={H - 17} fontSize="9.5" fill="#6b6d74" textAnchor="middle">
                    {label}
                  </text>
                );
              })}
            </svg>
          </div>
          {!useSharedScale && seriesData.length > 1 && (
            <div className="note muted" style={{ fontSize: 11, marginTop: 6 }}>
              These parameters use different units, so each line is scaled
              independently to show its own trend clearly — use the legend
              above to focus on one at a time.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------
  // CATEGORICAL SVG CHART
  // ------------------------------------------------------------
  const categories = [];
  seriesData.forEach((series) => {
    series.points.forEach((point) => {
      if (point.displayValue && !categories.includes(point.displayValue)) {
        categories.push(point.displayValue);
      }
    });
  });
  const categoryIndex = new Map(categories.map((value, index) => [value, index]));

  const categoricalSeries = seriesData.map((series) => {
    const coords = series.points.map((point) => {
      const idx = axisIndex.has(point.visitNumber) ? axisIndex.get(point.visitNumber) : 0;
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
    <div className="card">
      <div className="card-head">
        <h3>{toText(view.title)}</h3>
      </div>

      <div className="card-body">
        {legend}
        <div className="flowsheet-wrap">
          <svg className="spark" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={toText(view.title)}>
            <line x1={padLeft} y1={H - padBottom} x2={W - padRight} y2={H - padBottom} stroke="#d9dadd" strokeWidth="1" />
            <line x1={padLeft} y1={padTop} x2={padLeft} y2={H - padBottom} stroke="#d9dadd" strokeWidth="1" />

            {categories.map((category, index) => {
              const y =
                categories.length > 1
                  ? padTop + innerHeight * (1 - index / (categories.length - 1))
                  : padTop + innerHeight / 2;
              return (
                <text key={category} x={padLeft - 8} y={y + 3} fontSize="9" fill="#6b6d74" textAnchor="end">
                  {category}
                </text>
              );
            })}

            {categoricalSeries.map((series) => (
              <g key={series.meta.key}>
                {series.coords.length > 1 && (
                  <polyline
                    points={series.coords.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke={series.meta.color}
                    strokeWidth="2"
                  />
                )}
                {series.coords.map((point, pointIndex) => (
                  <g key={pointIndex}>
                    <circle cx={point.x} cy={point.y} r="3.5" fill={series.meta.color} />
                    <text x={point.x} y={point.labelY ?? point.y - 9} fontSize="9" fill={series.meta.color} textAnchor="middle">
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
                <text key={entry.visit_number ?? index} x={x} y={H - 17} fontSize="9.5" fill="#6b6d74" textAnchor="middle">
                  {label}
                </text>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}


/**
 * Structural converters between the two Trends & Statistics view shapes.
 * Nothing clinical here — just reshaping chart series/points into a
 * pivoted table (or back), using whatever parameters/values/units the
 * backend already produced for this patient.
 */
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

/** Re-shape a view into the requested display type only if it isn't already that shape. */
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
 * Trends & Statistics contract slots (same ones empty_output_structure()
 * and deterministic_trend_node use on the backend) — not clinical terms.
 * Whatever the LLM decided as view_type for a slot gets reshaped here to
 * match the layout you want for that slot; the underlying data (parameters,
 * values, units, event_ids) is untouched.
 */
const TRENDS_DISPLAY_OVERRIDES = {
  toxicity_visit_over_visit: "table",
  key_labs: "chart",
};

/**
 * Renders only backend-resolved presentation views.
 *
 * The Trends & Statistics page passes `presentation_views`, while other
 * sections may continue using their existing curated-view payloads.
 * Rendering remains completely data-driven.
 */
function CuratedViews({ views }) {
  const items = asArray(views).filter(
    (view) => isObject(view) && !isEmpty(view)
  );

  if (!items.length) {
    return (
      <DataCard title="Trends & Statistics" always>
        <EmptyNote>
          No source-supported trend data is available yet.
        </EmptyNote>
      </DataCard>
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



function PathwayDeviationLog({ entries, deviations }) {
  const combined = [
    ...asArray(deviations),
    ...asArray(entries),
  ].filter(
    (row) => isObject(row) && !isEmpty(row)
  );

  if (!combined.length) {
    return (
      <DataCard title="Pathway Deviation" always>
        <EmptyNote>
          No source-supported pathway deviation recorded.
        </EmptyNote>
      </DataCard>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>Pathway Deviation</h3>
      </div>

      <div className="card-body">
        <div className="flowsheet-wrap">
          <table>
            <thead>
              <tr>
                <th>Details</th>
              </tr>
            </thead>

            <tbody>
              {combined.map((row, index) => {
                

                const description =
                  row.description ??
                  row.detail ??
                  row.deviation ??
                  row.statement ??
                  row.evidence;

                return (
                  <tr key={index}>
                    

                    <td>
                      {!isEmpty(description)
                        ? toText(description)
                        : (
                          <Value
                            value={row}
                            depth={1}
                          />
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Flowsheet. `flowsheet` is whatever the agent returned ({all, organ, ...}).
 * Filter buttons are built from the buckets that actually hold rows.
 */

function Flowsheet({ title, sub, flowsheet }) {
  const buckets = useMemo(() => {
    if (!isObject(flowsheet)) return {};

    const out = {};

    Object.entries(flowsheet).forEach(([key, value]) => {
      const rows = asArray(value).filter((row) => !isEmpty(row));

      if (rows.length) {
        out[key] = rows;
      }
    });

    return out;
  }, [flowsheet]);

  /*
   * The backend flowsheet is bucket-based:
   *
   * {
   *   organ: [...],
   *   marker: [...],
   *   imaging: [...]
   * }
   *
   * We keep those buckets separate in the UI.
   *
   * No clinical fields are hardcoded here.
   * Whatever non-empty buckets the backend provides are rendered.
   */
  const categories = Object.keys(buckets).filter(
    (key) => key !== "all"
  );

  /*
   * If the backend only returns `all`, preserve support for that structure.
   */
  const hasBucketedData = categories.length > 0;

  const allRows = hasBucketedData
    ? categories.flatMap((key) => buckets[key])
    : buckets.all || [];

  const [active, setActive] = useState("all");

  /*
   * If the backend data changes and the previously selected tab
   * no longer exists, return to All.
   */
  useEffect(() => {
    if (
      active !== "all" &&
      !Object.prototype.hasOwnProperty.call(buckets, active)
    ) {
      setActive("all");
    }
  }, [active, buckets]);

  if (!allRows.length) return null;

  /*
   * ------------------------------------------------------------
   * SELECTED TAB
   * ------------------------------------------------------------
   *
   * Organ / Marker / Imaging / any other backend bucket:
   * render only that bucket.
   */
  const renderSelectedBucket = () => {
    if (active === "all") return null;

    const rows = buckets[active] || [];

    if (!rows.length) {
      return <EmptyNote />;
    }

    /*
     * markerMode preserves the existing marker-specific
     * normalization already present in this component.
     */
    return (
      <Rows
        rows={rows}
        markerMode={active === "marker"}
        groupBySource={false}
      />
    );
  };

  /*
   * ------------------------------------------------------------
   * ALL TAB
   * ------------------------------------------------------------
   *
   * IMPORTANT:
   *
   * Do NOT flatten organ + marker + imaging into one Rows call.
   *
   * Instead, render every backend bucket independently.
   *
   * Therefore:
   *
   * All
   *   -> Organ
   *      -> rows from flowsheet.organ
   *   -> Marker
   *      -> rows from flowsheet.marker
   *   -> Imaging
   *      -> rows from flowsheet.imaging
   *
   * This remains data-driven. If another backend bucket is added,
   * it automatically appears in All as another section.
   */
  const renderAllBuckets = () => {
    if (!hasBucketedData) {
      return (
        <Rows
          rows={buckets.all || []}
          markerMode={false}
          groupBySource={true}
        />
      );
    }

    return (
      <div>
        {categories.map((bucketKey) => {
          const rows = buckets[bucketKey] || [];

          if (!rows.length) return null;

          return (
            <div
              className="flowsheet-group"
              key={bucketKey}
            >
              <div className="flowsheet-group-title">
                {prettyLabel(bucketKey)}
              </div>

              <Rows
                rows={rows}
                markerMode={bucketKey === "marker"}
                groupBySource={false}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>

        {sub ? (
          <span className="sub">
            {sub}
          </span>
        ) : null}
      </div>

      <div className="card-body">

        {categories.length > 0 && (
          <div className="filterbar">
            <span className="fb-label">
              Show:
            </span>

            <button
              type="button"
              className={active === "all" ? "active" : ""}
              onClick={() => setActive("all")}
            >
              All
            </button>

            {categories.map((key) => (
              <button
                type="button"
                key={key}
                className={active === key ? "active" : ""}
                onClick={() => setActive(key)}
              >
                {prettyLabel(key)}
              </button>
            ))}
          </div>
        )}

        {active === "all"
          ? renderAllBuckets()
          : renderSelectedBucket()}
      </div>
    </div>
  );
}


// ===========================================================================
// COMPONENT
// ===========================================================================

const SUBTABS = [
  { id: "lo-overview", label: "Overview" },
  { id: "lo-regimen", label: "Regimen & Treatment" },
  { id: "lo-trends", label: "Trends & Statistics" },
  { id: "lo-response", label: "Response & Resistance" },
  { id: "lo-molecular", label: "Molecular & Microbiome" },
  { id: "lo-notes", label: "Notes & Docs" },
];

export default function LongitudinalSummaryTab({
  patientId,
  doctorId = null,
  apiBaseUrl = "https://doctorassist.ai/api/",
}) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSub, setActiveSub] = useState("lo-overview");
  const [fetchedAt, setFetchedAt] = useState(null);

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
          console.warn("[LongitudinalSummary] not generated yet", endpoint);
          setRecord(null);
          setError(null);
          return;
        }
        if (!response.ok) {
          throw new Error(`GET failed with status ${response.status}`);
        }

        const json = await response.json();

        // ---- CONSOLE OUTPUT -----------------------------------------
        console.log("[LongitudinalSummary] endpoint:", endpoint);
        console.log("[LongitudinalSummary] raw response:", json);
        console.log("[LongitudinalSummary] data:", json?.data);
        console.log("[LongitudinalSummary] sections:", json?.data?.sections);
        console.log("[LongitudinalSummary] visits:", json?.data?.visits);
        console.log(
          "[LongitudinalSummary] source_summary:",
          json?.data?.source_summary
        );
        // --------------------------------------------------------------

        setRecord(json);
        setError(null);
        setFetchedAt(new Date());
      } catch (exc) {
        if (exc.name === "AbortError") return;
        console.error("[LongitudinalSummary] fetch failed:", exc);
        setError(exc.message || "Failed to load longitudinal summary");
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




  // -------------------------------------------------------------------
  // DERIVED
  // -------------------------------------------------------------------

  const data = record?.data || {};
  const sections = data.sections || {};

  const overview = sections.overview || {};
  const regimen = sections.regimen_treatment || {};
  const trends = sections.trends_statistics || {};
  const resp = sections.response_resistance || {};
  const molecular = sections.molecular_microbiome || {};
  const notes = sections.notes_documents || {};

  const sourceSummary = data.source_summary || {};

  const documents = useMemo(() => {
    const fromAgent = asArray(notes.documents);
    return fromAgent.length ? fromAgent : asArray(sourceSummary.documents);
  }, [notes.documents, sourceSummary.documents]);

  const documentCount = documents.length || sourceSummary.event_count || 0;

  /**
   * Trends & Statistics no longer arrives as `trends.presentation_views`.
   * The backend now returns the five presentation slots flat on the
   * section itself (trends.cumulative_dose_vs_limit, trends.tumor_burden,
   * trends.toxicity_visit_over_visit, trends.key_labs, trends.biomarkers).
   *
   * These five names are the section's own fixed application contract —
   * the same five keys the backend's empty_output_structure() and
   * deterministic_trend_node already use — not a clinical keyword
   * mapping. Nothing about what is INSIDE each slot (title, view_type,
   * series, parameters, values, units) is assumed here; that content is
   * entirely whatever the backend/LLM produced for this patient.
   *
   * `presentation_views` is still checked first as a fallback, so an
   * older cached record (persisted before the backend fix) still renders.
   */
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

  /** Header cells built from whatever the Overview agent produced. */
  const headerCells = useMemo(() => {
    const cells = [];

    const push = (label, value) => {
      if (isEmpty(value) || cells.length >= 4) return;
      cells.push({ label, value: toText(value) });
    };

    const consume = (candidate) => {
      if (isEmpty(candidate)) return;
      if (Array.isArray(candidate)) {
        candidate.forEach((item) => {
          if (isObject(item)) {
            const keys = Object.keys(item).filter(
              (k) => !isEmpty(item[k]) && !SOURCE_KEY.test(k)
            );
            if (!keys.length) return;
            push(prettyLabel(keys[0]), item[keys[1]] ?? item[keys[0]]);
          } else {
            push("", item);
          }
        });
      } else if (isObject(candidate)) {
        Object.entries(candidate).forEach(([k, v]) => push(prettyLabel(k), v));
      } else {
        push("Case", candidate);
      }
    };

    consume(overview.current_status);
    consume(overview.current_state);
    consume(overview.identity);
    consume(overview.cancer_case_identity);

    return cells.slice(0, 4);
  }, [overview]);

  // Trends & Statistics uses only the curated presentation_views payload.

  const newFindings = asArray(resp.new_findings);

  // -------------------------------------------------------------------
  // SHELL + EARLY STATES
  // -------------------------------------------------------------------

  const shell = (children) => (
    <div className="lsum">
      <StyleTag />
      {children}
    </div>
  );

  if (!patientId) {
    return shell(<div className="note muted">No patient selected.</div>);
  }

  if (loading && !record) {
    return shell(
      <>
        <div className="h1">Longitudinal Summary</div>
        <div className="note muted">Loading the latest summary…</div>
      </>
    );
  }

  if (error && !record) {
    return shell(
      <>
        <div className="h1">Longitudinal Summary</div>
        <div className="note muted">{error}</div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" onClick={() => fetchSummary(false)}>
            Retry
          </button>
        </div>
      </>
    );
  }

  if (!record) {
    return shell(
      <>
        <div className="h1">Longitudinal Summary</div>
        <div className="note muted">
          No longitudinal summary has been generated for this patient yet.
          Upload a document or create an appointment to trigger it.
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------
  // MAIN
  // -------------------------------------------------------------------

  return shell(
    <>
      <div className="eyebrow">
        Full treatment record · {documentCount}{" "}
        {documentCount === 1 ? "document" : "documents"} analyzed
        {sourceSummary.visit_count
          ? ` · ${sourceSummary.visit_count} ${
              sourceSummary.visit_count === 1 ? "visit" : "visits"
            }`
          : ""}
      </div>
      <div className="h1">Longitudinal Summary</div>

      {/* {headerCells.length > 0 && (
        <div className="grid4" style={{ marginBottom: 16 }}>
          {headerCells.map((cell, i) => (
            <div className="cell" key={i}>
              <div className="lbl">{cell.label || `Item ${i + 1}`}</div>
              <div className="val small">{cell.value}</div>
            </div>
          ))}
        </div>
      )} */}

      <div className="subtabs">
        {SUBTABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeSub === tab.id ? "active" : ""}
            onClick={() => setActiveSub(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---------------- OVERVIEW ---------------- */}
      <div
        className={`subpage${activeSub === "lo-overview" ? " active" : ""}`}
        id="lo-overview"
      >
        <DataCard
          title="Cancer Case Identity"
          sub={
            typeof overview.cancer_case_identity === "string"
              ? overview.cancer_case_identity
              : undefined
          }
          value={pick(overview, ["cancer_case_identity", "cancer_case_identity"])}
          always
        />
        <DataCard title="Current State" value={overview.current_state} />
        <DataCard title="Key Findings" value={overview.key_findings} />
        <DataCard title="What Changed" value={overview.what_changed} />
        <DataCard title="Current Status" value={overview.current_status} />
        <ProseCard title="Narrative" value={overview.narrative} />
      </div>

      {/* ---------------- REGIMEN & TREATMENT ---------------- */}
      <div
        className={`subpage${activeSub === "lo-regimen" ? " active" : ""}`}
        id="lo-regimen"
      >
                <DataCard title="Regimen History & Cumulative Exposure" always>
          <SchemaGroupedRows
            rows={pick(regimen, [
              "regimen_history_cumulative_exposure",
              "current",
              "history",
              "exposure",
            ])}
          />
        </DataCard>
        <DataCard title="Treatment Timeline" value={regimen.timeline} />
        {/* <DataCard title="Planned Treatment" value={regimen.plans} /> */}
        {/* <DataCard title="Changes" value={regimen.changes} /> */}
        <DataCard title="Procedures" value={regimen.procedures} />
        <DataCard title="Decisions" value={regimen.decisions} />
        <ProseCard title="Narrative" value={regimen.narrative} />
      </div>

            {/* ---------------- TRENDS & STATISTICS ---------------- */}
<div
  className={`subpage${activeSub === "lo-trends" ? " active" : ""}`}
  id="lo-trends"
>
  <CuratedViews views={trendsViews} />
</div>

      {/* ---------------- RESPONSE & RESISTANCE ---------------- */}
<div
  className={`subpage${activeSub === "lo-response" ? " active" : ""}`}
  id="lo-response"
>
  <StatusCardGrid cards={resp.status_cards} />

  {newFindings.length > 0 && (
    <div className="newfind-banner">
      <div className="nf-title">New Findings</div>
      <ul>
        {newFindings.map((f, i) => (
          <li key={i}>
            {isObject(f) ? (
              <div>
                <strong>
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
                </strong>
                {!isEmpty(f.value) && (
                  <span>
                    {" — "}
                    {toText(f.value)}
                    {!isEmpty(f.unit) ? ` ${toText(f.unit)}` : ""}
                  </span>
                )}
                {!isEmpty(f.status) && (
                  <div className="note">{toText(f.status)}</div>
                )}
                <SourceChip value={f.event_id || f.source_event_id} />
              </div>
            ) : (
              toText(f)
            )}
          </li>
        ))}
      </ul>
    </div>
  )}

  <ProseCard title="Summary" value={resp.summary} />


  
  <TimelineCard title="Resistance Signal" rows={resp.resistance_signal} />

  

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
    <TimelineCard title="Response Trajectory" rows={resp.response_trajectory} />
    <TimelineCard title="Trajectory" rows={resp.trajectory} />


  <PathwayDeviationLog
    deviations={resp.pathway_deviation}
    entries={resp.pathway_deviation_log}
  />

  <EvidenceTable title="Outcome Benchmark" value={resp.outcome_benchmark} />
  <ProseCard title="Outcome Benchmark Note" value={resp.outcome_benchmark_note} />

  {isObject(resp.intelligence) &&
    Object.values(resp.intelligence).some((v) => !isEmpty(v)) &&
    Object.entries(resp.intelligence)
      .filter(([, v]) => !isEmpty(v))
      .map(([k, v]) => (
        <DataCard key={k} title={prettyLabel(k)} value={v} />
      ))}

  <ProseCard title="Narrative" value={resp.narrative} />
</div>

      {/* ---------------- MOLECULAR & MICROBIOME ------------- */}
      <div
        className={`subpage${activeSub === "lo-molecular" ? " active" : ""}`}
        id="lo-molecular"
      >
        {typeof molecular.summary === "string" &&
          !isEmpty(molecular.summary) && (
            <div className="frontier-banner" style={{ marginBottom: 14 }}>
              {molecular.summary}
            </div>
          )}

        {typeof molecular.summary !== "string" && (
          <DataCard title="Summary" value={molecular.summary} />
        )}

        <DataCard
          title="Molecular / Genomic"
          value={molecular.molecular_genomic}
        />
        <DataCard title="Microbiome" value={molecular.microbiome} />

        {hasUsablePivotedData(molecular.flowsheet_pivoted) ? (
          <PivotedFlowsheet
            title="Multidimensional Flowsheet — Molecular & Microbiome"
            sub="Baseline vs. every visit, one screen"
            pivoted={molecular.flowsheet_pivoted}
          />
        ) : (
          <Flowsheet
            title="Multidimensional Flowsheet — Molecular & Microbiome"
            sub="Every recorded parameter, one screen"
            flowsheet={molecular.flowsheet}
          />
        )}

        <ProseCard title="Narrative" value={molecular.narrative} />
      </div>

      {/* ---------------- NOTES & DOCS ---------------- */}
      <div
        className={`subpage${activeSub === "lo-notes" ? " active" : ""}`}
        id="lo-notes"
      >
        <div className="card">
          <div className="card-head">
            <h3>Notes &amp; Source Documents</h3>
            <span className="sub">
              {documents.length}{" "}
              {documents.length === 1 ? "document" : "documents"}
            </span>
          </div>
          <div className="card-body">
            {documents.length ? (
              <div className="flowsheet-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Date</th>
                      <th>File</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc, i) => {
                      if (!isObject(doc)) {
                        return (
                          <tr key={i}>
                            <td colSpan={4}>{toText(doc)}</td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={doc.event_id || i}>
                          <td>
                            {toText(
                              pick(doc, [
                                "document_type_name",
                                "title",
                                "document_type",
                                "name",
                              ]) || "Document"
                            )}
                          </td>
                          <td>
                            {toText(
                              pick(doc, [
                                "document_date",
                                "date",
                                "event_date",
                              ]) || ""
                            )}
                          </td>
                          <td>{toText(doc.file_name || "")}</td>
                          <td>
                            <SourceChip value={doc.event_id} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyNote>No source documents stored yet.</EmptyNote>
            )}
          </div>
        </div>

        <ProseCard title="Notes" value={notes.notes} />
        <DataCard title="Decisions" value={notes.decisions} />
        <DataCard title="Recommendations" value={notes.recommendations} />
        <DataCard title="Pending" value={notes.pending} />
        <ProseCard title="Narrative" value={notes.narrative} />
      </div>

      <div className="toolbar" style={{ marginTop: 18 }}>
        <button type="button" onClick={() => fetchSummary(false)}>
          Refresh
        </button>
        <span className="note muted" style={{ fontSize: 11.5 }}>
          {fetchedAt ? `Updated ${fetchedAt.toLocaleTimeString()}` : ""}
        </span>
      </div>
    </>
  );
}