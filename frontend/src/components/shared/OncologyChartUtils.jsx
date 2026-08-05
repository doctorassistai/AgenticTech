import React from 'react';
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { C, FONT, FW_BOLD, FW_NORMAL, thSx, tdSx } from './designTokens';

// Safe nested value resolver that supports arrays (e.g. drugs[].name)
export const resolvePath = (obj, path) => {
  if (!path || !obj) return null;
  const parts = path.replace(/\[\]/g, ".[].").split('.').filter(Boolean);

  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) return null;
    const part = parts[i];

    if (part === "[]") {
      if (!Array.isArray(current)) return null;
      const remainingPath = parts.slice(i + 1).join(".");
      if (!remainingPath) return current;
      return current.map(item => resolvePath(item, remainingPath)).filter(val => val !== null && val !== undefined);
    }

    current = current[part];
  }
  return current;
};

// Primitive value formatter
export const formatPrimitive = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export const flattenMapping = (mappingObj, type) => {
  const fields = [];

  Object.entries(mappingObj).forEach(([categoryKey, categoryData]) => {
    if (categoryKey.startsWith('_') || categoryKey === 'document_metadata') return;

    const categoryLabel = categoryKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    Object.entries(categoryData).forEach(([fieldKey, fieldData]) => {
      if (fieldKey.startsWith('_')) return;

      // Nested object group — either a real array (child paths contain "[]")
      // or a nested scalar object (e.g. cycle_admin_summary, modReasons).
      if (typeof fieldData === 'object' && !fieldData.type && !fieldData.chemo && !fieldData.radio) {
        const firstChild = Object.values(fieldData).find(v => v && v[type]);
        if (firstChild) {
          // Array groups have a "[]" in their path; scalar-object groups do not.
          const isArrayGroup = firstChild[type].includes('[');
          const basePath = isArrayGroup
            ? firstChild[type].split('[')[0]
            : firstChild[type].split('.').slice(0, -1).join('.');
          // Exclude imported chemo fields from showing up in the radio chart
          if (type === 'radio' && basePath.includes('chemo_import')) return;

          // Cycle-pinned scalar-object group (e.g. cycle_admin_summary):
          // the mapping hardcodes ".cycles.1.", but the DB holds one block per
          // cycle key. Detect it so render can expand to one row per cycle.
          const cycleMatch = !isArrayGroup ? basePath.match(/^(.*\.cycles)\.\d+\.(.+)$/) : null;

          const dataColumns = Object.entries(fieldData)
            .filter(([k, v]) => !k.startsWith('_') && v && v[type])
            .map(([k, v]) => ({
              key: k,
              label: k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
              // Array child: sub-path after "]."  |  Scalar-object child: last path segment
              subPath: isArrayGroup ? (v[type].split('].')[1] || k) : v[type].split('.').pop()
            }));

          fields.push({
            category: categoryLabel,
            key: fieldKey,
            label: fieldKey.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
            path: basePath,
            isComplexArray: true,
            isCycleCollection: !!cycleMatch,
            collectionPath: cycleMatch ? cycleMatch[1] : null,
            itemSuffix: cycleMatch ? cycleMatch[2] : null,
            columns: cycleMatch
              ? [{ key: '__cycleNo', label: 'Cycle', subPath: '__cycleNo' }, ...dataColumns]
              : dataColumns
          });
        }
        return;
      }

      if (fieldData[type]) {
        // Exclude imported chemo fields from showing up in the radio chart
        if (type === 'radio' && typeof fieldData[type] === 'string' && fieldData[type].includes('chemo_import')) return;

        fields.push({
          category: categoryLabel,
          key: fieldKey,
          label: fieldKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
          path: fieldData[type],
          note: fieldData.surgical_note,
          unit: fieldData.unit
        });
      }
    });
  });

  return fields;
};

export const MedicalRecordTable = ({ catFields }) => {
  const scalars = catFields.filter(f => !f.isComplexArray);
  const arrays = catFields.filter(f => f.isComplexArray);

  // Group scalars into pairs for 4-column layout
  const rows = [];
  for (let i = 0; i < scalars.length; i += 2) {
    rows.push([scalars[i], scalars[i + 1]]);
  }

  return (
    <Box sx={{ mb: 3 }}>
      {/* Scalar Fields Grid */}
      {scalars.length > 0 && (
        <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1, mb: arrays.length > 0 ? 3 : 0 }}>
          <Table size="small">
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ ...thSx, width: '25%' }}>{row[0].label}</TableCell>
                  <TableCell sx={{ ...tdSx, width: '25%' }}>
                    {formatPrimitive(row[0].val)} {row[0].unit && row[0].val ? row[0].unit : ''}
                    {row[0].note && <Box sx={{ fontSize: 10, fontStyle: 'italic', color: C.textMuted, mt: 0.5 }}>* {row[0].note}</Box>}
                  </TableCell>
                  {row[1] ? (
                    <>
                      <TableCell sx={{ ...thSx, width: '25%' }}>{row[1].label}</TableCell>
                      <TableCell sx={{ ...tdSx, width: '25%' }}>
                        {formatPrimitive(row[1].val)} {row[1].unit && row[1].val ? row[1].unit : ''}
                        {row[1].note && <Box sx={{ fontSize: 10, fontStyle: 'italic', color: C.textMuted, mt: 0.5 }}>* {row[1].note}</Box>}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell sx={{ ...thSx, width: '25%' }}></TableCell>
                      <TableCell sx={{ ...tdSx, width: '25%' }}></TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Complex Arrays */}
      {arrays.map((f, idx) => (
        <Box key={f.key} sx={{ mt: 2, mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, mb: 1, fontFamily: FONT, color: C.textPrimary, textTransform: 'uppercase' }}>
            {f.label}
          </Typography>
          <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
            <Table size="small">
              <TableHead sx={{ background: C.bgSecondary }}>
                <TableRow>
                  {f.columns.map(col => (
                    <TableCell key={col.key} sx={{ ...thSx, width: 'auto' }}>{col.label}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(Array.isArray(f.val) ? f.val : [f.val]).map((row, rIdx) => (
                  <TableRow key={rIdx}>
                    {f.columns.map(col => {
                      const cellVal = typeof row === 'object' && row !== null
                        ? resolvePath(row, col.subPath)
                        : (col.subPath ? null : row);
                      return <TableCell key={col.key} sx={{ ...tdSx, width: 'auto' }}>{formatPrimitive(cellVal)}</TableCell>;
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ))}
    </Box>
  );
};
