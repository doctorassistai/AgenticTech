import React, { useState } from 'react';

export const Section = ({ title, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e8e8e8',
        borderRadius: '4px',
        boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        marginBottom: '16px',
        overflow: 'hidden',
        gridColumn: '1 / -1',
      }}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '12px 16px',
          background: '#f2f2f2',
          borderBottom: isOpen ? '1px solid #e8e8e8' : 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '13px', color: '#1a1a1a', letterSpacing: '.01em' }}>
          {title}
        </span>
        <span
          style={{
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.15s ease',
            color: '#a8a8a8',
            fontSize: '12px',
          }}
        >
          ▼
        </span>
      </div>

      {isOpen && (
        <div
          style={{
            padding: '18px 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '16px 20px',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default Section;
