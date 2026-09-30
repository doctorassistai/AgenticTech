import React from 'react';
import { useNeuropsychiatry } from '../context/NeuropsychiatryContext';

export const HeaderActions = () => {
  const { formData } = useNeuropsychiatry();

  const handleLog = () => {
    console.log('[Neuropsychiatry Form Data]', formData);
    alert('formData logged to browser console.');
  };

  const handleSave = () => {
    console.log('[Saving Record...]', formData);
    alert('Record saved successfully!');
  };

  return (
    <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
      <button
        type="button"
        onClick={handleLog}
        style={{
          background: 'transparent',
          color: '#2e2e2e',
          border: '1px solid #d4d4d4',
          borderRadius: '2px',
          padding: '9px 16px',
          fontSize: '12px',
          cursor: 'pointer',
          fontWeight: 400,
        }}
      >
        Log formData
      </button>
      <button
        type="button"
        onClick={handleSave}
        style={{
          background: '#0a0a0a',
          color: '#ffffff',
          border: 'none',
          borderRadius: '2px',
          padding: '9px 16px',
          fontSize: '12px',
          cursor: 'pointer',
          fontWeight: 400,
        }}
      >
        Save Record
      </button>
    </div>
  );
};

export default HeaderActions;
