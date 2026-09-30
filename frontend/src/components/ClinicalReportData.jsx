import React, { useCallback, useEffect, useMemo, useState } from "react";

/**
 * ClinicalReportData
 *
 * Compact renderer for:
 *   - Laboratory reports
 *   - Diagnostic / radiology / pathology reports
 *
 * Backend:
 *   GET /hms/users/ai-legacy/clinical-report/reports/{patientId}/lab-radiology
 *
 * UI behavior:
 *   - Laboratory data is rendered as a dynamic matrix.
 *   - Date and Type stay correctly aligned while horizontally scrolling.
 *   - Abnormal laboratory cells use a light-red background instead of
 *     printing "Abnormal".
 *   - Clinical Intelligence is NOT printed below every row. It is opened
 *     on demand with an Intelligence button.
 *   - Diagnostic reports are grouped by backend-provided document type.
 *   - Structured diagnostic arrays are rendered as compact dynamic tables.
 *   - Impression and Recommendations remain compact text cards.
 *
 * No report-type-specific field mapping is used.
 * Diagnostic table columns are derived from the actual objects returned
 * by the API.
 */

const ClinicalReportData = ({
  patientId,
  apiBaseUrl = "https://doctorassist.ai/api/",
  className = "",
}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState("lab");
  const [intelligenceModal, setIntelligenceModal] = useState(null);
  const [expandedDiagnostics, setExpandedDiagnostics] = useState({});

  const fetchClinicalReports = useCallback(async () => {
    if (!patientId) {
      setData(null);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${apiBaseUrl}hms/users/ai-legacy/clinical-report/reports/${encodeURIComponent(
          patientId
        )}/lab-radiology`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `Unable to load clinical report data (${response.status})`
        );
      }

      const result = await response.json();
      setData(result || null);

      const hasLab =
        Array.isArray(result?.lab_trend?.rows) &&
        result.lab_trend.rows.length > 0;

      const hasDiagnostic =
        result?.diagnostic_reports &&
        Object.values(result.diagnostic_reports).some(
          (items) => Array.isArray(items) && items.length > 0
        );

      setActiveSection((current) => {
        if (current === "lab" && hasLab) return "lab";
        if (current === "diagnostic" && hasDiagnostic) return "diagnostic";
        return hasLab ? "lab" : hasDiagnostic ? "diagnostic" : current;
      });
    } catch (err) {
      console.error("Clinical report data fetch failed:", err);

      setError(
        err?.message || "Unable to load clinical report data."
      );
    } finally {
      setLoading(false);
    }
  }, [patientId, apiBaseUrl]);

  useEffect(() => {
    fetchClinicalReports();
  }, [fetchClinicalReports]);

  const labTrend = data?.lab_trend || {};

  const labColumns = useMemo(
    () =>
      Array.isArray(labTrend.columns)
        ? labTrend.columns.filter(
            (column) =>
              column !== null &&
              column !== undefined &&
              String(column).trim() !== ""
          )
        : [],
    [labTrend.columns]
  );

  const labRows = useMemo(
    () =>
      Array.isArray(labTrend.rows)
        ? labTrend.rows
        : [],
    [labTrend.rows]
  );

  const diagnosticReports =
    data?.diagnostic_reports &&
    typeof data.diagnostic_reports === "object"
      ? data.diagnostic_reports
      : {};

  const diagnosticTypes = useMemo(
    () =>
      Object.entries(diagnosticReports).filter(
        ([, reports]) =>
          Array.isArray(reports) &&
          reports.length > 0
      ),
    [diagnosticReports]
  );

  const diagnosticCount = useMemo(
    () =>
      diagnosticTypes.reduce(
        (total, [, reports]) =>
          total + reports.length,
        0
      ),
    [diagnosticTypes]
  );

  /* ------------------------------------------------------------------
   * General helpers
   * ---------------------------------------------------------------- */

  const formatDate = (value) => {
    if (!value) return "Unknown date";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const hasValue = (value) =>
    value !== null &&
    value !== undefined &&
    value !== "";

  /*
   * Backend implementations may return clinical_intelligence as a string
   * or as an object containing the generated paragraph. This helper keeps
   * the UI tolerant without adding report-specific logic.
   */
  const getIntelligenceText = (value) => {
    if (!value) return "";

    if (typeof value === "string") {
      return value.trim();
    }

    if (typeof value === "object") {
      const candidates = [
        value.summary,
        value.text,
        value.content,
        value.clinical_summary,
        value.clinical_intelligence,
      ];

      const found = candidates.find(
        (item) =>
          typeof item === "string" &&
          item.trim().length > 0
      );

      return found ? found.trim() : "";
    }

    return "";
  };

  const formatCellValue = (cell) => {
    if (!hasValue(cell)) return null;

    if (
      typeof cell !== "object" ||
      Array.isArray(cell)
    ) {
      return String(cell);
    }

    if (!hasValue(cell.value)) {
      return null;
    }

    const unit = hasValue(cell.unit)
      ? String(cell.unit)
      : "";

    return unit
      ? `${cell.value} ${unit}`
      : String(cell.value);
  };

  const getCellStatus = (cell) => {
    if (!cell || typeof cell !== "object") {
      return null;
    }

    if (
      typeof cell.flag === "string" &&
      cell.flag.trim()
    ) {
      return cell.flag
        .trim()
        .toLowerCase();
    }

    const referenceStatus =
      cell.reference_status;

    if (
      referenceStatus &&
      typeof referenceStatus === "object" &&
      typeof referenceStatus.status === "string"
    ) {
      return referenceStatus.status
        .trim()
        .toLowerCase();
    }

    return null;
  };

  /*
   * This only determines presentation from the already extracted backend
   * status. It does not classify medical values itself.
   */
  const isAbnormalCell = (cell) => {
    if (!cell || typeof cell !== "object") {
      return false;
    }

    const abnormality =
      cell.abnormality;

    if (
      abnormality &&
      typeof abnormality === "object" &&
      abnormality.present === true
    ) {
      return true;
    }

    if (
      typeof abnormality === "string" &&
      abnormality.trim()
    ) {
      return true;
    }

    const status = getCellStatus(cell);

    return Boolean(
      status &&
        ![
          "normal",
          "within range",
          "within normal limits",
          "normal range",
          "unknown",
        ].includes(status)
    );
  };

  const getEvidence = (value) => {
    if (!value || typeof value !== "object") {
      return "";
    }

    return typeof value.evidence === "string"
      ? value.evidence.trim()
      : "";
  };

  const openIntelligence = (
    title,
    date,
    value
  ) => {
    const text =
      getIntelligenceText(value);

    if (!text) return;

    setIntelligenceModal({
      title,
      date,
      text,
    });
  };

  const closeIntelligence = () => {
    setIntelligenceModal(null);
  };

  const toggleDiagnostic = (key) => {
    setExpandedDiagnostics(
      (previous) => ({
        ...previous,
        [key]: !previous[key],
      })
    );
  };

  /* ------------------------------------------------------------------
   * Generic rendering for diagnostic table values
   * ---------------------------------------------------------------- */

  const renderInlineValue = (value) => {
    if (!hasValue(value)) {
      return (
        <span className="crd-muted">
          —
        </span>
      );
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return (
        <span>
          {String(value)}
        </span>
      );
    }

    if (Array.isArray(value)) {
      const visible =
        value.filter(hasValue);

      if (!visible.length) {
        return (
          <span className="crd-muted">
            —
          </span>
        );
      }

      return (
        <div className="crd-inline-list">
          {visible.map(
            (item, index) => (
              <div key={index}>
                {renderInlineValue(item)}
              </div>
            )
          )}
        </div>
      );
    }

    if (typeof value === "object") {
      const entries =
        Object.entries(value).filter(
          ([, child]) =>
            hasValue(child)
        );

      if (!entries.length) {
        return (
          <span className="crd-muted">
            —
          </span>
        );
      }

      return (
        <div className="crd-inline-object">
          {entries.map(
            ([key, child]) => (
              <div
                key={key}
                className="crd-inline-object-row"
              >
                <span className="crd-inline-object-key">
                  {formatLabel(key)}
                </span>

                <span className="crd-inline-object-value">
                  {renderInlineValue(child)}
                </span>
              </div>
            )
          )}
        </div>
      );
    }

    return (
      <span>
        {String(value)}
      </span>
    );
  };

  /* ------------------------------------------------------------------
   * Laboratory table
   * ---------------------------------------------------------------- */

  const renderLabCell = (
    row,
    column
  ) => {
    const cell = row?.[column];
    const value =
      formatCellValue(cell);

    if (!value) {
      return (
        <span className="crd-muted">
          —
        </span>
      );
    }

    const abnormal =
      isAbnormalCell(cell);

    const evidence =
      getEvidence(cell);

    return (
      <div
        className={`crd-lab-cell ${
          abnormal
            ? "crd-lab-cell-abnormal"
            : ""
        }`}
        title={
          evidence || undefined
        }
        aria-label={
          abnormal
            ? `${column}: ${value}. Source indicates an abnormal result.`
            : `${column}: ${value}`
        }
      >
        <span className="crd-lab-value-text">
          {value}
        </span>
      </div>
    );
  };

  const renderLabTrend = () => {
    if (!labRows.length) {
      return (
        <EmptyState
          title="No laboratory reports"
          description="No laboratory report data is available for this patient."
        />
      );
    }

    return (
      <div className="crd-lab-container">
        <div className="crd-table-scroll">
          <table className="crd-lab-table">
            <colgroup>
              <col className="crd-date-col" />
              <col className="crd-type-col" />
              <col className="crd-intelligence-column" />

              {labColumns.map(
                (column) => (
                  <col
                    key={`col-${column}`}
                  />
                )
              )}
            </colgroup>

            <thead>
              <tr>
                <th className="crd-sticky-date">
                  Date
                </th>

                <th className="crd-sticky-type">
                  Type
                </th>

                <th className="crd-intelligence-header">
                  Intelligence
                </th>

                {labColumns.map(
                  (column) => (
                    <th
                      key={column}
                      title={String(column)}
                    >
                      {String(column)}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {labRows.map(
                (row, index) => {
                  const rowKey =
                    row.document_id ||
                    `${row.date || "unknown"}-${row.document_type || "report"}-${index}`;

                  const intelligence =
                    getIntelligenceText(
                      row.clinical_intelligence
                    );

                  return (
                    <tr key={rowKey}>
                      <td className="crd-date-cell crd-sticky-date">
                        {formatDate(
                          row.date
                        )}
                      </td>

                      <td className="crd-type-cell crd-sticky-type">

                        <span
                          className="crd-type-badge"
                          title={
                            row.document_type ||
                            "Report"
                          }
                        >
                          {row.document_type ||
                            "Report"}
                        </span>

                      </td>

                      <td className="crd-intelligence-cell">

                      {intelligence ? (
                        <button
                          type="button"
                          className="crd-intelligence-button"
                          onClick={() =>
                            openIntelligence(
                              row.document_type ||
                                "Laboratory Report",
                              row.date,
                              intelligence
                            )
                          }
                          title="View clinical intelligence"
                        >
                          View
                        </button>
                      ) : (
                        <span className="crd-muted">
                          —
                        </span>
                      )}

                    </td>

                      {labColumns.map(
                        (column) => (
                          <td
                            key={`${rowKey}-${column}`}
                            className="crd-lab-data-cell"
                          >
                            {renderLabCell(
                              row,
                              column
                            )}
                          </td>
                        )
                      )}
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------
   * Diagnostic dynamic tables
   * ---------------------------------------------------------------- */

  const getTableColumns = (
    rows
  ) => {
    const columns = [];
    const seen = new Set();

    rows.forEach((row) => {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row)
      ) {
        return;
      }

      Object.keys(row).forEach(
        (key) => {
          if (!seen.has(key)) {
            seen.add(key);
            columns.push(key);
          }
        }
      );
    });

    return columns;
  };

  const renderDiagnosticTable = (
    rows
  ) => {
    if (
      !Array.isArray(rows) ||
      !rows.length
    ) {
      return null;
    }

    const objectRows =
      rows.filter(
        (row) =>
          row &&
          typeof row === "object" &&
          !Array.isArray(row)
      );

    if (!objectRows.length) {
      return (
        <div className="crd-simple-value">
          {renderInlineValue(rows)}
        </div>
      );
    }

    const columns =
      getTableColumns(objectRows);

    if (!columns.length) {
      return null;
    }

    return (
      <div className="crd-diagnostic-table-scroll">
        <table className="crd-diagnostic-table">
          <thead>
            <tr>
              {columns.map(
                (column) => (
                  <th key={column}>
                    {formatLabel(
                      column
                    )}
                  </th>
                )
              )}
            </tr>
          </thead>

          <tbody>
            {objectRows.map(
              (row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map(
                    (column) => (
                      <td
                        key={`${rowIndex}-${column}`}
                      >
                        {renderInlineValue(
                          row[column]
                        )}
                      </td>
                    )
                  )}
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDiagnosticSection = (
    title,
    value
  ) => {
    if (!hasRenderableValue(value)) {
      return null;
    }

    const isObjectArray =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item)
      );

    return (
      <section className="crd-diagnostic-section">
        <div className="crd-section-label">
          {title}
        </div>

        {isObjectArray ? (
          renderDiagnosticTable(
            value
          )
        ) : (
          <div className="crd-section-content">
            {renderInlineValue(
              value
            )}
          </div>
        )}
      </section>
    );
  };

  const renderTextSection = (
    title,
    value
  ) => {
    if (!hasRenderableValue(value)) {
      return null;
    }

    return (
      <section className="crd-text-section">
        <div className="crd-section-label">
          {title}
        </div>

        <div className="crd-text-card">
          {renderInlineValue(value)}
        </div>
      </section>
    );
  };

  const renderDiagnosticReport = (
    report,
    type,
    index
  ) => {
    const reportKey =
      report.document_id ||
      `${type}-${report.document_date || "unknown"}-${index}`;

    const expanded =
      Boolean(
        expandedDiagnostics[
          reportKey
        ]
      );

    const dataObject =
      report.data &&
      typeof report.data === "object"
        ? report.data
        : report;

    const intelligence =
      getIntelligenceText(
        report.clinical_intelligence ||
          dataObject.clinical_intelligence
      );

    return (
      <article
        key={reportKey}
        className="crd-diagnostic-card"
      >
        <header className="crd-diagnostic-header">
          <div className="crd-diagnostic-heading-main">
            <div className="crd-diagnostic-type">
              {report.document_type ||
                type ||
                "Diagnostic Report"}
            </div>

            <div className="crd-diagnostic-meta">
              <span>
                {formatDate(
                  report.document_date
                )}
              </span>

              {report.filename && (
                <>
                  <span className="crd-meta-dot">
                    •
                  </span>

                  <span
                    className="crd-filename"
                    title={report.filename}
                  >
                    {report.filename}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="crd-diagnostic-actions">
            {intelligence && (
              <button
                type="button"
                className="crd-intelligence-button"
                onClick={() =>
                  openIntelligence(
                    report.document_type ||
                      type ||
                      "Diagnostic Report",
                    report.document_date,
                    intelligence
                  )
                }
              >
                Intelligence
              </button>
            )}

            <button
              type="button"
              className="crd-expand-button"
              onClick={() =>
                toggleDiagnostic(
                  reportKey
                )
              }
              aria-expanded={expanded}
            >
              {expanded
                ? "Hide details"
                : "View details"}
            </button>
          </div>
        </header>

        {expanded && (
          <div className="crd-diagnostic-details">
            {renderDiagnosticSection(
              "Assessment",
              dataObject.assessment
            )}

            {renderDiagnosticSection(
              "Findings",
              dataObject.findings
            )}

            {renderDiagnosticSection(
              "Abnormalities",
              dataObject.abnormalities
            )}

            {renderDiagnosticSection(
              "Diagnosis",
              dataObject.diagnosis
            )}

            {renderTextSection(
              "Impression",
              dataObject.impression
            )}

            {renderDiagnosticSection(
              "Measurements",
              dataObject.measurements
            )}

            {renderDiagnosticSection(
              "Markers",
              dataObject.markers
            )}

            {renderTextSection(
              "Recommendations",
              dataObject.recommendations
            )}
          </div>
        )}
      </article>
    );
  };

  const renderDiagnosticReports = () => {
    if (!diagnosticTypes.length) {
      return (
        <EmptyState
          title="No diagnostic reports"
          description="No imaging or pathology report data is available for this patient."
        />
      );
    }

    return (
      <div className="crd-diagnostic-container">
        {diagnosticTypes.map(
          ([type, reports]) => (
            <section
              key={type}
              className="crd-diagnostic-group"
            >
              {reports.map(
                (report, index) =>
                  renderDiagnosticReport(
                    report,
                    type,
                    index
                  )
              )}
            </section>
          )
        )}
      </div>
    );
  };

  /* ------------------------------------------------------------------
   * Component states
   * ---------------------------------------------------------------- */

  const hasLab =
    labRows.length > 0;

  const hasDiagnostic =
    diagnosticTypes.length > 0;

  if (loading) {
    return (
      <div
        className={`crd-root ${className}`}
      >
        <div className="crd-loading">
          <div className="crd-spinner" />
          <span>
            Loading clinical reports…
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`crd-root ${className}`}
      >
        <div className="crd-error">
          <div>
            <strong>
              Unable to load clinical reports
            </strong>

            <div className="crd-error-text">
              {error}
            </div>
          </div>

          <button
            type="button"
            className="crd-retry"
            onClick={
              fetchClinicalReports
            }
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (
    !data ||
    (!hasLab && !hasDiagnostic)
  ) {
    return (
      <div
        className={`crd-root ${className}`}
      >
        <EmptyState
          title="No clinical report data"
          description="Laboratory and diagnostic report data will appear here after documents are processed."
        />
      </div>
    );
  }

  return (
    <div
      className={`crd-root ${className}`}
    >
      <div className="crd-toolbar">
        <div className="crd-title">
          Clinical Reports
        </div>

        <div className="crd-tabs">
          {hasLab && (
            <button
              type="button"
              className={
                activeSection === "lab"
                  ? "crd-tab crd-tab-active"
                  : "crd-tab"
              }
              onClick={() =>
                setActiveSection("lab")
              }
            >
              Laboratory

              <span className="crd-tab-count">
                {labRows.length}
              </span>
            </button>
          )}

          {hasDiagnostic && (
            <button
              type="button"
              className={
                activeSection ===
                "diagnostic"
                  ? "crd-tab crd-tab-active"
                  : "crd-tab"
              }
              onClick={() =>
                setActiveSection(
                  "diagnostic"
                )
              }
            >
              Diagnostic

              <span className="crd-tab-count">
                {diagnosticCount}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="crd-content">
        {activeSection === "lab" &&
          hasLab &&
          renderLabTrend()}

        {activeSection === "diagnostic" &&
          hasDiagnostic &&
          renderDiagnosticReports()}
      </div>

      {intelligenceModal && (
        <ClinicalIntelligenceModal
          title={
            intelligenceModal.title
          }
          date={
            intelligenceModal.date
          }
          text={
            intelligenceModal.text
          }
          onClose={
            closeIntelligence
          }
        />
      )}

      <style>{`
        .crd-root {
          width: 100%;
          min-width: 0;
          color: var(--text-primary, #1f2937);
          font-size: 13px;
        }

        .crd-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
          min-height: 34px;
        }

        .crd-title {
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
        }

        .crd-tabs {
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 2px;
          border-radius: 7px;
          background: var(--surface-secondary, #f5f6f8);
        }

        .crd-tab {
          border: 0;
          background: transparent;
          border-radius: 5px;
          padding: 5px 9px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary, #6b7280);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .crd-tab:hover {
          color: var(--text-primary, #1f2937);
        }

        .crd-tab-active {
          background: var(--surface-primary, #ffffff);
          color: var(--text-primary, #111827);
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        }

        .crd-tab-count {
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          background: var(--surface-tertiary, #e5e7eb);
        }

        .crd-content {
          min-width: 0;
        }

        /* ============================================================
           LABORATORY TABLE
           ============================================================ */

        .crd-lab-container {
          width: 100%;
          min-width: 0;
        }

        .crd-table-scroll {
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 7px;
          background: var(--surface-primary, #ffffff);
          scrollbar-width: thin;
        }

        .crd-lab-table {
          width: max-content;
          min-width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: auto;
        }

        .crd-lab-table th,
        .crd-lab-table td {
          box-sizing: border-box;
        }

        .crd-lab-table th {
          padding: 8px 10px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          background: var(--surface-secondary, #f8fafc);
          color: var(--text-secondary, #64748b);
          font-size: 10px;
          line-height: 1.25;
          font-weight: 650;
          text-align: left;
          white-space: normal;
          vertical-align: middle;
          min-width: 105px;
          max-width: 220px;
        }

        .crd-lab-table td {
          padding: 7px 10px;
          border-bottom: 1px solid var(--border-color, #eef0f2);
          font-size: 12px;
          line-height: 1.25;
          white-space: nowrap;
          vertical-align: middle;
          min-width: 105px;
        }

        .crd-date-col {
          width: 112px;
          min-width: 112px;
        }

        .crd-type-col {
          width: 210px;
          min-width: 210px;
        }

        .crd-intelligence-col {
          width: 100px;
          min-width: 100px;
        }

        .crd-intelligence-header {
          width: 100px !important;
          min-width: 100px !important;
          max-width: 100px !important;
        }

        .crd-intelligence-cell {
          width: 100px !important;
          min-width: 100px !important;
          max-width: 100px !important;
          text-align: center;
        }

        .crd-date-cell,
        .crd-sticky-date {
          width: 112px !important;
          min-width: 112px !important;
          max-width: 112px !important;
        }

        .crd-type-cell,
        .crd-sticky-type {
          width: 210px !important;
          min-width: 210px !important;
          max-width: 210px !important;
        }

        .crd-sticky-date,
        .crd-sticky-type {
          position: sticky;
          z-index: 3;
        }

        .crd-sticky-date {
          left: 0;
        }

        .crd-sticky-type {
          left: 112px;
        }

        .crd-lab-table th.crd-sticky-date,
        .crd-lab-table th.crd-sticky-type {
          background: var(--surface-secondary, #f8fafc);
          z-index: 5;
        }

        .crd-lab-table td.crd-sticky-date,
        .crd-lab-table td.crd-sticky-type {
          background: var(--surface-primary, #ffffff);
        }

        .crd-lab-table tbody tr:hover td {
          background: var(--surface-secondary, #fafbfc);
        }

        .crd-lab-table tbody tr:hover td.crd-sticky-date,
        .crd-lab-table tbody tr:hover td.crd-sticky-type {
          background: var(--surface-secondary, #fafbfc);
        }

        

        .crd-type-badge {
          display: inline-flex;
          align-items: center;

          width: 100%;
          max-width: 100%;
          min-width: 0;

          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;

          padding: 3px 6px;
          border-radius: 4px;

          background: var(
            --surface-secondary,
            #f1f3f5
          );

          color: var(
            --text-primary,
            #374151
          );

          font-size: 10px;
          font-weight: 650;
        }

        .crd-intelligence-button {
          flex-shrink: 0;
          border: 0;
          background: transparent;
          color: var(--accent-color, #4f6f8f);
          padding: 2px 0;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }

        .crd-intelligence-button:hover {
          text-decoration: underline;
        }

        .crd-lab-data-cell {
          position: relative;
        }

        .crd-lab-cell {
          min-height: 28px;
          display: flex;
          align-items: center;
          padding: 4px 6px;
          border-radius: 4px;
        }

        /*
         * Abnormal values are communicated visually.
         * The word "Abnormal" is intentionally not rendered in the cell.
         */
        .crd-lab-cell-abnormal {
          background: #fff1f1;
        }

        .crd-lab-cell-abnormal .crd-lab-value-text {
          font-weight: 600;
        }

        .crd-lab-value-text {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .crd-muted {
          color: #a0a7b1;
        }

        /* ============================================================
           DIAGNOSTIC REPORTS
           ============================================================ */

        .crd-diagnostic-container {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .crd-diagnostic-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .crd-group-heading {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 2px 1px;
          color: var(--text-secondary, #667085);
          font-size: 11px;
          font-weight: 700;
          text-transform: capitalize;
        }

        .crd-count {
          min-width: 17px;
          height: 17px;
          padding: 0 4px;
          border-radius: 9px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--surface-secondary, #f3f4f6);
          font-size: 9px;
          font-weight: 600;
        }

        .crd-diagnostic-card {
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 7px;
          background: var(--surface-primary, #ffffff);
          overflow: hidden;
        }

        .crd-diagnostic-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 10px;
        }

        .crd-diagnostic-heading-main {
          min-width: 0;
        }

        .crd-diagnostic-type {
          font-size: 12px;
          font-weight: 650;
          color: var(--text-primary, #1f2937);
        }

        .crd-diagnostic-meta {
          display: flex;
          align-items: center;
          gap: 5px;
          margin-top: 2px;
          min-width: 0;
          color: var(--text-secondary, #7b8491);
          font-size: 10px;
        }

        .crd-filename {
          max-width: 360px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .crd-meta-dot {
          opacity: 0.55;
        }

        .crd-diagnostic-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .crd-expand-button {
          border: 1px solid var(--border-color, #e5e7eb);
          background: transparent;
          border-radius: 5px;
          padding: 4px 7px;
          color: var(--text-secondary, #667085);
          font-size: 10px;
          cursor: pointer;
        }

        .crd-expand-button:hover {
          background: var(--surface-secondary, #f8fafc);
        }

        .crd-diagnostic-details {
          border-top: 1px solid var(--border-color, #eef0f2);
          padding: 2px 10px 9px;
        }

        .crd-diagnostic-section,
        .crd-text-section {
          padding: 7px 0;
          border-bottom: 1px solid var(--border-color, #f0f1f3);
        }

        .crd-diagnostic-section:last-child,
        .crd-text-section:last-child {
          border-bottom: 0;
        }

        .crd-section-label {
          margin-bottom: 5px;
          color: var(--text-secondary, #667085);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .crd-diagnostic-table-scroll {
          width: 100%;
          overflow-x: auto;
          scrollbar-width: thin;
        }

        .crd-diagnostic-table {
          width: 100%;
          min-width: 560px;
          border-collapse: separate;
          border-spacing: 0;
          border: 1px solid var(--border-color, #e8ebee);
          border-radius: 5px;
          overflow: hidden;
          table-layout: auto;
        }

        .crd-diagnostic-table th {
          padding: 6px 8px;
          background: var(--surface-secondary, #f8fafc);
          border-bottom: 1px solid var(--border-color, #e8ebee);
          color: var(--text-secondary, #667085);
          font-size: 9px;
          font-weight: 700;
          text-align: left;
          white-space: nowrap;
        }

        .crd-diagnostic-table td {
          padding: 6px 8px;
          border-bottom: 1px solid var(--border-color, #f0f1f3);
          color: var(--text-primary, #374151);
          font-size: 10.5px;
          line-height: 1.35;
          vertical-align: top;
        }

        .crd-diagnostic-table tr:last-child td {
          border-bottom: 0;
        }

        .crd-diagnostic-table tbody tr:hover td {
          background: var(--surface-secondary, #fbfcfd);
        }

        .crd-section-content {
          color: var(--text-primary, #374151);
          font-size: 11px;
          line-height: 1.4;
        }

        .crd-text-card {
          padding: 8px 9px;
          border: 1px solid var(--border-color, #edf0f2);
          border-radius: 5px;
          background: var(--surface-secondary, #fafafa);
          color: var(--text-primary, #374151);
          font-size: 11px;
          line-height: 1.45;
        }

        .crd-inline-list {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .crd-inline-list > div {
          min-width: 0;
        }

        .crd-inline-object {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .crd-inline-object-row {
          display: grid;
          grid-template-columns: minmax(90px, 0.3fr) minmax(0, 1fr);
          gap: 8px;
        }

        .crd-inline-object-key {
          color: var(--text-secondary, #737b87);
          font-weight: 500;
        }

        .crd-inline-object-value {
          min-width: 0;
          white-space: pre-wrap;
        }

        .crd-simple-value {
          color: var(--text-primary, #374151);
          font-size: 11px;
        }

        /* ============================================================
           CLINICAL INTELLIGENCE MODAL
           ============================================================ */

        .crd-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(15, 23, 42, 0.28);
        }

        .crd-intelligence-modal {
          width: min(620px, 100%);
          max-height: min(520px, calc(100vh - 40px));
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 9px;
          background: var(--surface-primary, #ffffff);
          box-shadow: 0 14px 40px rgba(15,23,42,0.16);
          overflow: hidden;
        }

        .crd-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 11px 13px;
          border-bottom: 1px solid var(--border-color, #eef0f2);
        }

        .crd-modal-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary, #1f2937);
        }

        .crd-modal-date {
          margin-top: 2px;
          color: var(--text-secondary, #7b8491);
          font-size: 10px;
        }

        .crd-modal-close {
          border: 0;
          background: transparent;
          color: var(--text-secondary, #667085);
          padding: 2px 5px;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }

        .crd-modal-body {
          overflow-y: auto;
          padding: 13px;
          color: var(--text-primary, #374151);
          font-size: 12px;
          line-height: 1.55;
          white-space: pre-wrap;
        }

        /* ============================================================
           STATES
           ============================================================ */

        .crd-loading {
          min-height: 130px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .crd-spinner {
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 2px solid var(--border-color, #e5e7eb);
          border-top-color: currentColor;
          animation: crd-spin 0.7s linear infinite;
        }

        @keyframes crd-spin {
          to {
            transform: rotate(360deg);
          }
        }

        .crd-error {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 7px;
          font-size: 12px;
        }

        .crd-error-text {
          margin-top: 3px;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
        }

        .crd-retry {
          border: 1px solid var(--border-color, #d8dce1);
          border-radius: 5px;
          padding: 5px 8px;
          background: transparent;
          cursor: pointer;
          font-size: 11px;
        }

        .crd-retry:hover {
          background: var(--surface-secondary, #f5f6f8);
        }

        .crd-empty {
          padding: 24px 12px;
          text-align: center;
        }

        .crd-empty-title {
          font-size: 12px;
          font-weight: 600;
        }

        .crd-empty-description {
          margin-top: 3px;
          color: var(--text-secondary, #737b87);
          font-size: 11px;
        }

        @media (max-width: 700px) {
          .crd-toolbar {
            align-items: flex-start;
            flex-direction: column;
          }

          .crd-diagnostic-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .crd-diagnostic-actions {
            width: 100%;
            justify-content: flex-end;
          }

          .crd-filename {
            max-width: 180px;
          }

          .crd-modal-backdrop {
            padding: 10px;
          }
        }
      `}</style>
    </div>
  );
};

/* ======================================================================
 * Shared helpers
 * ==================================================================== */

const formatLabel = (key) => {
  if (!key) return "";

  return String(key)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
};

const hasRenderableValue = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(
      hasRenderableValue
    );
  }

  if (typeof value === "object") {
    return Object.values(value).some(
      hasRenderableValue
    );
  }

  return true;
};

/* ======================================================================
 * Clinical Intelligence modal
 * ==================================================================== */

const ClinicalIntelligenceModal = ({
  title,
  date,
  text,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
  }, [onClose]);

  return (
    <div
      className="crd-modal-backdrop"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        className="crd-intelligence-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crd-intelligence-title"
      >
        <div className="crd-modal-header">
          <div>
            <div
              id="crd-intelligence-title"
              className="crd-modal-title"
            >
              Clinical Intelligence
            </div>

            <div className="crd-modal-date">
              {title}
              {date
                ? ` • ${formatDateStatic(date)}`
                : ""}
            </div>
          </div>

          <button
            type="button"
            className="crd-modal-close"
            onClick={onClose}
            aria-label="Close clinical intelligence"
          >
            ×
          </button>
        </div>

        <div className="crd-modal-body">
          {text}
        </div>
      </div>
    </div>
  );
};

const formatDateStatic = (value) => {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(
    undefined,
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
};

/* ======================================================================
 * Empty state
 * ==================================================================== */

const EmptyState = ({
  title,
  description,
}) => (
  <div className="crd-empty">
    <div className="crd-empty-title">
      {title}
    </div>

    <div className="crd-empty-description">
      {description}
    </div>
  </div>
);

export default ClinicalReportData;
