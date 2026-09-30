import React, { useEffect, useState } from 'react';
import { useNeuropsychiatry } from '../context/NeuropsychiatryContext';
import { uploadFile } from '../api/neuropsychiatryApi';

export const FormField = ({
  k,
  label,
  type = 'text',
  options = [],
  full = false,
  readOnly = false,
  placeholder = '',
  unit = '',
  hint = '',
  showIf = null,
  noDictate = false,
  tableMode = false,
  rows = 3,
  max = null,
  cols = 2,
  addLabel = '+ Add',
  subFields = [],
  gridRows = [],
  gridCols = [],
  gridOpts = [],
}) => {
  const {
    formData,
    updateField,
    updateArrayField,
    addArrayRow,
    removeArrayRow,
    patientId,
    doctorId,
    hospitalId,
    recordId,
    registerField,
  } = useNeuropsychiatry();

  // Per-field upload state (only used by type="file"). Declared before any
  // early return so the hook order stays stable across renders.
  // status: 'idle' | 'uploading' | 'done' | 'error'
  const [uploadState, setUploadState] = useState({ status: 'idle', name: '', error: '' });
  const [tableNewRow, setTableNewRow] = useState({});

  // ── Report this field's own spec to the provider's registry ────────────────
  // Voice dictation builds its extraction prompt (and validates the model's
  // answer) from whatever is registered here, so the labels and option lists
  // written inline in the forms stay the ONLY copy of the schema.
  //
  // Placed before the showIf early return, like uploadState above, so the hook
  // order stays stable — which also means a field currently hidden by a showIf
  // still registers, and dictation can fill it in the same pass that sets its
  // controlling field.
  //
  // The dep is a serialized signature, not the props: `options={[...]}` is
  // written inline in every form, so it is a new array identity on each render
  // and would re-register forever if compared by reference.
  //
  // `noDictate` opts a field out of voice dictation while leaving it fully
  // editable by hand — for values a doctor must enter deliberately (a numeric lab
  // result read off a report, a sign-off attestation). readOnly cannot express
  // that: it would also lock the input.
  const dictatable =
    !!k && !readOnly && !noDictate &&
    type !== 'subhead' && type !== 'note' && type !== 'file';
  const specSignature = dictatable
    ? JSON.stringify([k, label, type, options, unit, hint, subFields])
    : '';
  useEffect(() => {
    if (!specSignature) return undefined;
    return registerField({ k, label, type, options, unit, hint, subFields });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specSignature, registerField]);

  // Check showIf condition
  if (showIf) {
    const curVal = formData[showIf.k];
    const isVisible = showIf.in
      ? showIf.in.includes(curVal)
      : curVal === showIf.equals;
    if (!isVisible) return null;
  }

  const val = formData[k] || '';

  if (type === 'subhead') {
    return (
      <div
        style={{
          gridColumn: '1 / -1',
          fontWeight: 700,
          color: '#4a4a4a',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '.07em',
          borderBottom: '1px solid #e8e8e8',
          paddingBottom: '6px',
          marginTop: '8px',
        }}
      >
        {label}
      </div>
    );
  }

  if (type === 'note') {
    return (
      <div
        style={{
          gridColumn: '1 / -1',
          background: '#f2f2f2',
          border: '1px solid #e8e8e8',
          color: '#4a4a4a',
          padding: '10px 13px',
          borderRadius: '4px',
          fontSize: '11.5px',
          lineHeight: '1.6',
        }}
      >
        {label}
      </div>
    );
  }

  const renderLabel = () =>
    label ? (
      <label
        style={{
          display: 'block',
          fontWeight: 400,
          fontSize: '11px',
          marginBottom: '6px',
          color: '#7a7a7a',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
        }}
      >
        {label}
        {hint && (
          <span
            style={{
              color: '#a8a8a8',
              fontWeight: 400,
              fontSize: '10.5px',
              textTransform: 'none',
              letterSpacing: 0,
              marginLeft: '4px',
            }}
          >
            ({hint})
          </span>
        )}
      </label>
    ) : null;

  let inputElem = null;

  switch (type) {
    case 'text':
    case 'tel':
    case 'date':
    case 'time':
    case 'datetime-local':
      inputElem = (
        <input
          type={type}
          value={val}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => updateField(k, e.target.value)}
          style={{
            width: '100%',
            padding: '9px 12px',
            border: '1px solid #d4d4d4',
            borderRadius: '2px',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 300,
            background: readOnly ? '#f2f2f2' : '#ffffff',
            color: readOnly ? '#4a4a4a' : '#1a1a1a',
          }}
        />
      );
      break;

    case 'number':
      inputElem = unit ? (
        <div style={{ position: 'relative' }}>
          <input
            type="number"
            value={val}
            readOnly={readOnly}
            max={max || undefined}
            onChange={(e) => updateField(k, e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px',
              paddingRight: '44px',
              border: '1px solid #d4d4d4',
              borderRadius: '2px',
              fontFamily: 'inherit',
              fontSize: '13px',
              fontWeight: 300,
              background: readOnly ? '#f2f2f2' : '#ffffff',
              color: readOnly ? '#4a4a4a' : '#1a1a1a',
            }}
          />
          <span
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#7a7a7a',
              fontSize: '11px',
            }}
          >
            {unit}
          </span>
        </div>
      ) : (
        <input
          type="number"
          value={val}
          readOnly={readOnly}
          max={max || undefined}
          onChange={(e) => updateField(k, e.target.value)}
          style={{
            width: '100%',
            padding: '9px 12px',
            border: '1px solid #d4d4d4',
            borderRadius: '2px',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 300,
            background: readOnly ? '#f2f2f2' : '#ffffff',
            color: readOnly ? '#4a4a4a' : '#1a1a1a',
          }}
        />
      );
      break;

    case 'textarea':
      inputElem = (
        <textarea
          rows={rows}
          value={val}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => updateField(k, e.target.value)}
          style={{
            width: '100%',
            padding: '9px 12px',
            border: '1px solid #d4d4d4',
            borderRadius: '2px',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 300,
            background: readOnly ? '#f2f2f2' : '#ffffff',
            color: readOnly ? '#4a4a4a' : '#1a1a1a',
            resize: 'vertical',
            minHeight: '64px',
          }}
        />
      );
      break;

    case 'select':
      inputElem = (
        <select
          value={val}
          onChange={(e) => updateField(k, e.target.value)}
          style={{
            width: '100%',
            padding: '9px 12px',
            border: '1px solid #d4d4d4',
            borderRadius: '2px',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 300,
            background: '#ffffff',
            color: '#1a1a1a',
          }}
        >
          <option value="">— select —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
      break;

    case 'radio':
      inputElem = (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {options.map((opt) => {
            const isChecked = val === opt;
            return (
              <label
                key={opt}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  border: `1px solid ${isChecked ? '#0a0a0a' : '#d4d4d4'}`,
                  padding: '7px 12px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  background: isChecked ? '#f2f2f2' : '#ffffff',
                  fontSize: '12.5px',
                  color: isChecked ? '#1a1a1a' : '#2e2e2e',
                  fontWeight: isChecked ? 400 : 300,
                  userSelect: 'none',
                }}
              >
                <input
                  type="radio"
                  name={k}
                  value={opt}
                  checked={isChecked}
                  onChange={() => updateField(k, opt)}
                  style={{ margin: 0, accentColor: '#0a0a0a', width: '14px', height: '14px' }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      );
      break;

    case 'checks':
      const arrVal = Array.isArray(val) ? val : [];
      inputElem = (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {options.map((opt) => {
            const isChecked = arrVal.includes(opt);
            return (
              <label
                key={opt}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  border: `1px solid ${isChecked ? '#0a0a0a' : '#d4d4d4'}`,
                  padding: '7px 12px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  background: isChecked ? '#f2f2f2' : '#ffffff',
                  fontSize: '12.5px',
                  color: isChecked ? '#1a1a1a' : '#2e2e2e',
                  fontWeight: isChecked ? 400 : 300,
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    let nextArr = [...arrVal];
                    if (e.target.checked) {
                      if (!nextArr.includes(opt)) nextArr.push(opt);
                    } else {
                      nextArr = nextArr.filter((item) => item !== opt);
                    }
                    updateField(k, nextArr);
                  }}
                  style={{ margin: 0, accentColor: '#0a0a0a', width: '14px', height: '14px' }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      );
      break;

    case 'file': {
      // On select we upload immediately, store the returned public file_url in
      // formData[k] (so it saves with the section), and reflect progress inline.
      const uploading = uploadState.status === 'uploading';
      inputElem = (
        <div>
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              setUploadState({ status: 'uploading', name: file.name, error: '' });
              try {
                const res = await uploadFile({
                  file,
                  patientId,
                  doctorId,
                  hospitalId,
                  recordId,
                  fieldKey: k,
                  docType: label || k,
                });
                const url = res?.file_url || '';
                updateField(k, url);
                setUploadState({ status: 'done', name: file.name, error: '' });
              } catch (err) {
                updateField(k, '');
                setUploadState({
                  status: 'error',
                  name: file.name,
                  error: err.message || 'Upload failed',
                });
              }
            }}
            style={{
              width: '100%',
              padding: '9px 12px',
              border: '1px solid #d4d4d4',
              borderRadius: '2px',
              background: uploading ? '#f2f2f2' : '#ffffff',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          />
          {uploadState.status === 'uploading' && (
            <div style={{ fontSize: '10.5px', color: '#7a7a7a', marginTop: '5px' }}>
              Uploading {uploadState.name}…
            </div>
          )}
          {uploadState.status === 'done' && val && (
            <div style={{ fontSize: '10.5px', color: '#1e6b32', marginTop: '5px' }}>
              ✓ Uploaded{uploadState.name ? `: ${uploadState.name}` : ''} —{' '}
              <a
                href={val}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#1e6b32', textDecoration: 'underline' }}
              >
                view file
              </a>
            </div>
          )}
          {uploadState.status === 'error' && (
            <div style={{ fontSize: '10.5px', color: '#9b1c1c', marginTop: '5px' }}>
              {uploadState.error}
            </div>
          )}
          {/* A value hydrated from a resumed record (no fresh upload this session) */}
          {uploadState.status === 'idle' && val && (
            <div style={{ fontSize: '10.5px', color: '#7a7a7a', marginTop: '5px' }}>
              Current file —{' '}
              <a
                href={val}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#4a4a4a', textDecoration: 'underline' }}
              >
                view file
              </a>
            </div>
          )}
        </div>
      );
      break;
    }

    case 'array': {
      const arrayRows = Array.isArray(formData[k]) ? formData[k] : [];

      if (tableMode) {
        const validRows = arrayRows.filter(
          (row) => row && Object.values(row).some((v) => v !== undefined && v !== null && String(v).trim() !== '')
        );

        inputElem = (
          <div style={{ width: '100%', marginTop: '4px' }}>
            {/* Data Table */}
            {validRows.length > 0 && (
              <div
                style={{
                  overflowX: 'auto',
                  marginBottom: '12px',
                  border: '1px solid #e8e8e8',
                  borderRadius: '4px',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#ffffff' }}>
                  <thead>
                    <tr style={{ background: '#f7f7f7', borderBottom: '1px solid #e8e8e8' }}>
                      <th
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left',
                          fontSize: '11px',
                          color: '#7a7a7a',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          width: '65px',
                        }}
                      >
                        Sl. No.
                      </th>
                      {subFields.map((sf) => (
                        <th
                          key={sf.k}
                          style={{
                            padding: '10px 14px',
                            textAlign: 'left',
                            fontSize: '11px',
                            color: '#7a7a7a',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {sf.l || sf.k}
                        </th>
                      ))}
                      <th
                        style={{
                          padding: '10px 14px',
                          textAlign: 'center',
                          fontSize: '11px',
                          color: '#7a7a7a',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          width: '80px',
                        }}
                      >
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.map((item, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid #e8e8e8' }}>
                        <td style={{ padding: '10px 14px', fontSize: '13px', color: '#8c8c8c', fontWeight: 600 }}>
                          {index + 1}
                        </td>
                        {subFields.map((sf) => (
                          <td
                            key={sf.k}
                            style={{
                              padding: '10px 14px',
                              fontSize: '13px',
                              color: '#1a1a1a',
                              fontWeight: 400,
                            }}
                          >
                            {item[sf.k] !== undefined && item[sf.k] !== null && String(item[sf.k]).trim() !== ''
                              ? String(item[sf.k])
                              : '—'}
                          </td>
                        ))}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => removeArrayRow(k, index)}
                            style={{
                              padding: '4px 10px',
                              fontSize: '12px',
                              background: '#0a0a0a',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 500,
                              margin: '0 auto',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add Input Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${subFields.length}, minmax(130px, 1fr)) auto`,
                gap: '10px',
                alignItems: 'center',
                background: '#f7f7f7',
                padding: '12px',
                borderRadius: '4px',
                border: '1px solid #e8e8e8',
              }}
            >
              {subFields.map((sf) => {
                const curVal = tableNewRow[sf.k] || '';
                if (sf.t === 'select') {
                  return (
                    <select
                      key={sf.k}
                      value={curVal}
                      onChange={(e) => setTableNewRow((prev) => ({ ...prev, [sf.k]: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #d4d4d4',
                        borderRadius: '4px',
                        fontSize: '13px',
                        background: '#ffffff',
                        color: '#1a1a1a',
                      }}
                    >
                      <option value="">{`Select ${sf.l || sf.k}`}</option>
                      {(sf.o || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  );
                }
                return (
                  <input
                    key={sf.k}
                    type={sf.t || 'text'}
                    placeholder={sf.l || sf.ph || sf.k}
                    value={curVal}
                    onChange={(e) => setTableNewRow((prev) => ({ ...prev, [sf.k]: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d4d4d4',
                      borderRadius: '4px',
                      fontSize: '13px',
                      background: '#ffffff',
                      color: '#1a1a1a',
                    }}
                  />
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const hasValue = Object.values(tableNewRow).some(
                    (v) => v !== undefined && v !== null && String(v).trim() !== ''
                  );
                  if (hasValue) {
                    addArrayRow(k, { ...tableNewRow });
                    setTableNewRow({});
                  }
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  background: '#0a0a0a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {addLabel}
              </button>
            </div>
          </div>
        );
        break;
      }

      inputElem = (
        <div
          style={{
            border: '1px dashed #d4d4d4',
            borderRadius: '4px',
            padding: '12px',
            background: '#f2f2f2',
          }}
        >
          {arrayRows.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: cols === 1 ? '1fr' : `repeat(${cols}, 1fr)`,
                gap: '10px',
                padding: '12px',
                background: '#ffffff',
                border: '1px solid #e8e8e8',
                borderRadius: '4px',
                marginBottom: '10px',
                position: 'relative',
              }}
            >
              <button
                type="button"
                onClick={() => removeArrayRow(k, i)}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: '#ffffff',
                  color: '#4a4a4a',
                  border: '1px solid #d4d4d4',
                  borderRadius: '3px',
                  padding: '3px 9px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                ✕ Remove
              </button>
              {subFields.map((sf) => {
                const subVal = row[sf.k] || '';
                return (
                  <div key={sf.k}>
                    {sf.l && (
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 400,
                          fontSize: '11px',
                          marginBottom: '4px',
                          color: '#7a7a7a',
                        }}
                      >
                        {sf.l}
                      </label>
                    )}
                    {sf.t === 'textarea' ? (
                      <textarea
                        value={subVal}
                        placeholder={sf.ph || ''}
                        onChange={(e) => updateArrayField(k, i, sf.k, e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid #d4d4d4', borderRadius: '2px' }}
                      />
                    ) : sf.t === 'select' ? (
                      <select
                        value={subVal}
                        onChange={(e) => updateArrayField(k, i, sf.k, e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid #d4d4d4', borderRadius: '2px' }}
                      >
                        <option value="">— select —</option>
                        {(sf.o || []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : sf.t === 'radio' ? (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {(sf.o || []).map((opt) => (
                          <label
                            key={opt}
                            style={{
                              fontSize: '11px',
                              padding: '4px 8px',
                              border: `1px solid ${subVal === opt ? '#0a0a0a' : '#d4d4d4'}`,
                              borderRadius: '2px',
                              cursor: 'pointer',
                              background: subVal === opt ? '#f2f2f2' : '#ffffff',
                            }}
                          >
                            <input
                              type="radio"
                              name={`${k}_${i}_${sf.k}`}
                              value={opt}
                              checked={subVal === opt}
                              onChange={() => updateArrayField(k, i, sf.k, opt)}
                              style={{ display: 'none' }}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input
                        type={sf.t || 'text'}
                        value={subVal}
                        placeholder={sf.ph || ''}
                        onChange={(e) => updateArrayField(k, i, sf.k, e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid #d4d4d4', borderRadius: '2px' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <button
            type="button"
            onClick={() => addArrayRow(k)}
            style={{
              background: '#ffffff',
              color: '#4a4a4a',
              border: '1px dashed #d4d4d4',
              borderRadius: '2px',
              padding: '8px 14px',
              width: '100%',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {addLabel}
          </button>
        </div>
      );
      break;
    }

    default:
      break;
  }

  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'span 1' }}>
      {renderLabel()}
      {inputElem}
    </div>
  );
};

export default FormField;
