import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DataProcessingAmbulanceImage from './DataProcessingAmbulanceImage';

const API_BASE = 'https://doctorassist.ai/api';

// ─── Spinner ──────────────────────────────────────────────────────────────────
const Spinner = ({ size = 20, color = '#000' }) => (
  <span style={{
    display: 'inline-block', width: size, height: size,
    border: `2px solid ${color}22`, borderTopColor: color,
    borderRadius: '50%', animation: 'spin .6s linear infinite', flexShrink: 0,
  }} />
);

// ─── Format timestamp ─────────────────────────────────────────────────────────
const fmtTimestamp = (iso) => {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return iso; }
};

// ─── Image Viewer with Controls ───────────────────────────────────────────────
const ImageViewer = ({ src, alt = 'Clinical Image', maxHeight = 500 }) => {
  const [zoom, setZoom]     = useState(1);
  const [rotate, setRotate] = useState(0);
  const [flip, setFlip]     = useState(false);
  const [lightbox, setLightbox] = useState(false);

  const zoomIn  = () => setZoom(z => Math.min(z + 0.25, 4));
  const zoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const rotateL = () => setRotate(r => r - 90);
  const rotateR = () => setRotate(r => r + 90);
  const toggleFlip  = () => setFlip(f => !f);
  const resetAll    = () => { setZoom(1); setRotate(0); setFlip(false); };

  const transform = `rotate(${rotate}deg) scale(${flip ? -zoom : zoom}, ${zoom})`;

  const iconBtn = (onClick, title, children) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 34, height: 34, borderRadius: 6,
        border: '1px solid #d0d0d0', background: '#fff',
        cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 15, color: '#333',
        transition: 'background 0.15s, border-color 0.15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f0f0f0'; e.currentTarget.style.borderColor = '#bbb'; }}
      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d0d0d0'; }}
    >
      {children}
    </button>
  );

  return (
    <>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 14px', background: '#f8f8f8',
        borderBottom: '1px solid #e0e0e0', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {iconBtn(zoomOut, 'Zoom Out', '−')}
          <span style={{ fontSize: 11, color: '#666', minWidth: 36, textAlign: 'center', fontFamily: 'monospace' }}>
            {Math.round(zoom * 100)}%
          </span>
          {iconBtn(zoomIn, 'Zoom In', '+')}
        </div>
        <div style={{ width: 1, height: 22, background: '#e0e0e0', margin: '0 4px' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {iconBtn(rotateL, 'Rotate Left', '↺')}
          {iconBtn(rotateR, 'Rotate Right', '↻')}
        </div>
        <div style={{ width: 1, height: 22, background: '#e0e0e0', margin: '0 4px' }} />
        {iconBtn(toggleFlip, 'Flip Horizontal', '⇄')}
        <div style={{ width: 1, height: 22, background: '#e0e0e0', margin: '0 4px' }} />
        <button
          onClick={resetAll}
          title="Reset"
          style={{
            fontSize: 11, padding: '5px 10px', borderRadius: 6,
            border: '1px solid #d0d0d0', background: '#fff',
            cursor: 'pointer', color: '#555', fontFamily: 'inherit',
          }}
        >Reset</button>
        <div style={{ flex: 1 }} />
        {iconBtn(() => setLightbox(true), 'Fullscreen', '⤢')}
      </div>

      {/* Image canvas */}
      <div style={{
        position: 'relative', background: '#f0f0f0',
        overflow: 'hidden', cursor: zoom > 1 ? 'grab' : 'zoom-in',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 220, maxHeight,
      }}>
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            maxWidth: '100%', maxHeight,
            objectFit: 'contain', display: 'block',
            transform, transition: 'transform 0.2s ease',
            userSelect: 'none',
          }}
          onClick={() => { if (zoom === 1 && rotate === 0 && !flip) setLightbox(true); }}
        />
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.96)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, animation: 'fadeIn 0.2s ease',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={src} alt={alt}
              style={{
                maxWidth: '90vw', maxHeight: '86vh',
                objectFit: 'contain', display: 'block',
                transform, transition: 'transform 0.2s ease', borderRadius: 4,
              }}
            />
            <div style={{
              position: 'absolute', bottom: -48, left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex', gap: 8, alignItems: 'center',
              background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
              padding: '6px 16px', borderRadius: 30,
              border: '1px solid rgba(255,255,255,0.15)',
            }}>
              {[
                [zoomOut, '−', 'Zoom Out'], [zoomIn, '+', 'Zoom In'],
                [rotateL, '↺', 'Rotate Left'], [rotateR, '↻', 'Rotate Right'],
                [toggleFlip, '⇄', 'Flip'], [resetAll, '⊙', 'Reset'],
              ].map(([fn, icon, title]) => (
                <button key={title} onClick={fn} title={title} style={{
                  width: 32, height: 32, borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: 'rgba(255,255,255,0.15)',
                  color: '#fff', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{icon}</button>
              ))}
            </div>
            <button
              onClick={() => setLightbox(false)}
              style={{
                position: 'absolute', top: -16, right: -16,
                width: 36, height: 36, borderRadius: '50%',
                background: '#fff', border: 'none', fontSize: 18,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
              }}
            >✕</button>
          </div>
        </div>
      )}
    </>
  );
};

// ─── Image Modal (for All Images tab click) ────────────────────────────────────
const ImageModal = ({ image, index, onClose }) => {
  const [zoom, setZoom]     = useState(1);
  const [rotate, setRotate] = useState(0);
  const [flip, setFlip]     = useState(false);

  const zoomIn  = () => setZoom(z => Math.min(z + 0.25, 4));
  const zoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const rotateL = () => setRotate(r => r - 90);
  const rotateR = () => setRotate(r => r + 90);
  const toggleFlip = () => setFlip(f => !f);
  const resetAll   = () => { setZoom(1); setRotate(0); setFlip(false); };

  const transform = `rotate(${rotate}deg) scale(${flip ? -zoom : zoom}, ${zoom})`;

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const ctrlBtn = (fn, icon, title) => (
    <button key={title} onClick={fn} title={title} style={{
      height: 36, padding: '0 14px', borderRadius: 6,
      border: '1px solid #e0e0e0', background: '#fff',
      color: '#333', fontSize: 14, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 5, fontFamily: "'DM Sans', sans-serif",
      transition: 'background 0.15s, border-color 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.borderColor = '#bbb'; }}
      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e0e0e0'; }}
    >{icon}</button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 24, animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12,
          overflow: 'hidden', width: '90vw', maxWidth: 880,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          animation: 'scaleIn 0.22s ease',
        }}
      >
        {/* Modal header */}
        <div style={{
          padding: '12px 20px', background: '#111', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '1.2px',
              textTransform: 'uppercase', color: '#aaa',
              fontFamily: "'DM Sans', sans-serif",
            }}>Clinical Image</span>
            <span style={{
              fontSize: 11, background: '#333', padding: '2px 10px',
              borderRadius: 4, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
            }}>#{index + 1}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          >✕</button>
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '10px 16px', background: '#fafafa',
          borderBottom: '1px solid #e8e8e8', flexShrink: 0,
        }}>
          {/* Zoom group */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {ctrlBtn(zoomOut, '−', 'Zoom Out')}
            <span style={{
              fontSize: 11, color: '#666', minWidth: 38, textAlign: 'center',
              fontFamily: 'monospace', fontWeight: 600,
            }}>{Math.round(zoom * 100)}%</span>
            {ctrlBtn(zoomIn, '+', 'Zoom In')}
          </div>

          <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

          {/* Rotate group */}
          <div style={{ display: 'flex', gap: 4 }}>
            {ctrlBtn(rotateL, <><span style={{ fontSize: 15 }}>↺</span><span style={{ fontSize: 11 }}>Left</span></>, 'Rotate Left')}
            {ctrlBtn(rotateR, <><span style={{ fontSize: 15 }}>↻</span><span style={{ fontSize: 11 }}>Right</span></>, 'Rotate Right')}
          </div>

          <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

          {/* Landscape / flip */}
          {ctrlBtn(toggleFlip, <><span style={{ fontSize: 15 }}>⇄</span><span style={{ fontSize: 11 }}>Landscape</span></>, 'Flip Horizontal')}

          <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

          <button
            onClick={resetAll}
            style={{
              height: 36, padding: '0 14px', borderRadius: 6,
              border: '1px solid #e0e0e0', background: '#fff',
              color: '#555', fontSize: 11, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
          >Reset</button>
        </div>

        {/* Image area */}
        <div style={{
          flex: 1, overflow: 'hidden',
          background: '#1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 300,
        }}>
          <img
            src={image.image_url}
            alt={`Clinical ${index + 1}`}
            draggable={false}
            style={{
              maxWidth: '100%', maxHeight: '60vh',
              objectFit: 'contain', display: 'block',
              transform, transition: 'transform 0.2s ease',
              userSelect: 'none',
            }}
          />
        </div>

        {/* Meta footer */}
        <div style={{
          padding: '12px 20px', background: '#fafafa',
          borderTop: '1px solid #e8e8e8',
          display: 'flex', gap: 32, flexWrap: 'wrap', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2, fontFamily: "'DM Sans', sans-serif" }}>Captured</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#222', fontFamily: "'DM Sans', sans-serif" }}>{fmtTimestamp(image.timestamp_iso)}</div>
          </div>
          {image.driver_name && (
            <div>
              <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2, fontFamily: "'DM Sans', sans-serif" }}>Emergency Crew</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#222', fontFamily: "'DM Sans', sans-serif" }}>{image.driver_name}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Image Card for All Images Tab (no controls overlay, click → modal) ────────
const ImageCard = ({ image, index, onView }) => (
  <div
    onClick={() => onView(image, index)}
    style={{
      border: '1px solid #e0e0e0',
      borderRadius: 10,
      overflow: 'hidden',
      background: '#fff',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      cursor: 'pointer',
      transition: 'box-shadow 0.2s, transform 0.15s',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.14)';
      e.currentTarget.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
      e.currentTarget.style.transform = 'translateY(0)';
    }}
  >
    {/* Image area */}
    <div style={{
      position: 'relative', height: 180,
      background: '#f0f0f0', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <img
        src={image.image_url}
        alt={`Clinical ${index + 1}`}
        draggable={false}
        style={{
          maxWidth: '100%', maxHeight: '100%',
          objectFit: 'contain', display: 'block',
          transition: 'transform 0.25s ease',
        }}
        onError={e => { e.target.style.display = 'none'; }}
      />
      {/* Index badge */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        background: 'rgba(0,0,0,0.72)', color: '#fff',
        fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
        fontFamily: "'DM Sans', sans-serif",
      }}>#{index + 1}</div>
      {/* View hint overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.2s',
      }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.28)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0)'}
      >
        <span style={{
          fontSize: 12, color: '#fff', fontWeight: 700,
          background: 'rgba(0,0,0,0.6)', padding: '5px 14px',
          borderRadius: 20, opacity: 0, transition: 'opacity 0.2s',
          fontFamily: "'DM Sans', sans-serif", pointerEvents: 'none',
        }}
          ref={el => {
            if (el) {
              el.parentElement.onmouseenter = () => { el.style.opacity = '1'; el.parentElement.style.background = 'rgba(0,0,0,0.28)'; };
              el.parentElement.onmouseleave = () => { el.style.opacity = '0'; el.parentElement.style.background = 'rgba(0,0,0,0)'; };
            }
          }}
        >View Full</span>
      </div>
    </div>

    {/* Meta */}
    <div style={{ padding: '10px 12px', borderTop: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 11, color: '#888', fontFamily: "'DM Sans', sans-serif" }}>{fmtTimestamp(image.timestamp_iso)}</div>
      {image.driver_name && (
        <div style={{ fontSize: 11, color: '#555', marginTop: 3, fontFamily: "'DM Sans', sans-serif" }}>👤 {image.driver_name}</div>
      )}
    </div>
  </div>
);
// ─── Extraction Header with Mic ───────────────────────────────────────────────
const ExtractionHeader = ({ extractionResult, editedTexts, setEditedTexts }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);

  const transcribeAudio = async (file) => {
    try {
      setTranscribing(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language_code', 'eng');
      const res = await fetch(
        'https://doctorassist.ai/api/hms/users/ai/elevenlabs/api/transcribe_labs',
        { method: 'POST', body: formData }
      );
      const result = await res.json();
      if (result.text) {
        // append to ALL extraction textareas as comma-separated
        setEditedTexts(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(idx => {
            updated[idx] = updated[idx]
              ? `${updated[idx]}, ${result.text}`
              : result.text;
          });
          return updated;
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTranscribing(false);
    }
  };

  const handleMic = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        await transcribeAudio(file);
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
    } catch (e) {
      alert('Microphone permission denied');
    }
  };

  return (
    <div style={{
      background: '#111', color: '#fff', padding: '10px 20px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>🔬</span>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.5px', fontFamily: "'DM Sans', sans-serif" }}>
          Extracted Medical Values
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          fontSize: 11, background: '#16a34a', color: '#fff',
          padding: '3px 12px', borderRadius: 20, fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {extractionResult.total_images_processed} image{extractionResult.total_images_processed !== 1 ? 's' : ''} processed
        </span>

        {/* Mic button */}
        <button
          type="button"
          onClick={handleMic}
          disabled={transcribing}
          title={isRecording ? 'Stop Recording' : 'Voice to Extracted Data'}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
        >
          {transcribing ? <Spinner size={36} color="#fff" /> : isRecording ? (
            <div style={{
              width: 44, height: 44, borderRadius: '50%', background: '#dc3545',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="3" width="12" height="16" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span style={{ fontSize: 7, fontWeight: 800, color: '#fff', letterSpacing: '1px', marginTop: 2 }}>REC</span>
            </div>
          ) : (
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.1)',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
          )}
        </button>
      </div>
    </div>
  );
};
// ─── Editable Extraction Panel ────────────────────────────────────────────────
const ExtractionPanel = ({ extractionResult, onProceed }) => {
  const [editedTexts, setEditedTexts] = useState({});

  useEffect(() => {
    if (!extractionResult?.extractions) return;
    const init = {};
    extractionResult.extractions.forEach((ext, idx) => { init[idx] = ext.extracted_text || ''; });
    setEditedTexts(init);
  }, [extractionResult]);

  const handleProceed = () => {
  const combined = Object.values(editedTexts).join('\n\n---\n\n');
  const extractedData = extractionResult.extractions[0]?.extracted_data || null;
  console.log('🔍 DEBUG handleProceed - extractedData:', extractedData);
  console.log('🔍 DEBUG handleProceed - full extraction object:', extractionResult.extractions[0]);
  onProceed(combined, extractedData);
};

  if (!extractionResult?.extractions?.length) return null;

  return (
    <div style={{
      margin: '24px 0',
      border: '1.5px solid #111', borderRadius: 10, overflow: 'hidden',
      background: '#fff', animation: 'slideDown 0.3s ease',
      boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    }}>
      <ExtractionHeader
        extractionResult={extractionResult}
        editedTexts={editedTexts}
        setEditedTexts={setEditedTexts}
      />

      <div style={{
        padding: '10px 20px', background: '#fffbeb', borderBottom: '1px solid #fde68a',
        fontSize: 12, color: '#92400e',
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <span>✏️</span>
        <span>Review and edit the extracted content below before proceeding.</span>
      </div>

      {extractionResult.extractions.map((ext, idx) => (
        <div key={ext.image_id || idx} style={{
          borderBottom: idx < extractionResult.extractions.length - 1 ? '1px solid #e8e8e8' : 'none',
        }}>
          <div style={{
            padding: '8px 20px', background: '#f7f7f7', borderBottom: '1px solid #e8e8e8',
            display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, color: '#333', fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>Image #{idx + 1}</span>
            {ext.timestamp_iso && (
              <span style={{ fontSize: 11, color: '#888', fontFamily: "'DM Sans', sans-serif" }}>
                🕐 {new Date(ext.timestamp_iso).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', hour12: true,
                })}
              </span>
            )}
            {ext.driver_name && (
              <span style={{ fontSize: 11, color: '#888', fontFamily: "'DM Sans', sans-serif" }}>👤 {ext.driver_name}</span>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(editedTexts[idx] || '');
                  const btn = document.getElementById(`copy-btn-${idx}`);
                  if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500); }
                }}
                id={`copy-btn-${idx}`}
                style={{
                  fontSize: 11, padding: '4px 12px', borderRadius: 4,
                  border: '1px solid #ccc', background: '#fff', cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif", color: '#444',
                }}
              >📋 Copy</button>
            </div>
          </div>

          <div style={{ padding: '14px 20px', background: '#fafafa' }}>
            <textarea
              value={editedTexts[idx] || ''}
              onChange={e => setEditedTexts(prev => ({ ...prev, [idx]: e.target.value }))}
              rows={10}
              style={{
                width: '100%', fontSize: 13, lineHeight: 1.75, color: '#1a1a1a',
                fontFamily: "'DM Mono', 'Courier New', monospace",
                background: '#fff', border: '1.5px solid #d0d0d0', borderRadius: 6,
                padding: '14px 16px', resize: 'vertical', outline: 'none',
                transition: 'border-color 0.2s', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = '#111'}
              onBlur={e => e.target.style.borderColor = '#d0d0d0'}
            />
          </div>
        </div>
      ))}

      <div style={{
        padding: '16px 20px', background: '#f7f7f7', borderTop: '1px solid #e8e8e8',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 12, color: '#888', fontFamily: "'DM Sans', sans-serif" }}>
          This will populate the Voice Notes section below
        </span>
        <button
          onClick={handleProceed}
          style={{
            background: '#111', color: '#fff', border: 'none',
            padding: '11px 28px', borderRadius: 6, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#333'}
          onMouseLeave={e => e.currentTarget.style.background = '#111'}
        >
          <span>↓</span> Proceed to Voice Notes
        </button>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const AmbulanceImagePhotography = ({ patientId, patientName, patientData }) => {
  const navigate = useNavigate();

  const [images, setImages]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [meta, setMeta]       = useState({});
  const [activeTab, setActiveTab] = useState('latest');

  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);

  // Modal state for All Images tab
  const [modalImage, setModalImage]   = useState(null);
  const [modalIndex, setModalIndex]   = useState(null);
    const [showLatestModal, setShowLatestModal] = useState(false);


  // Voice
  const [voiceText, setVoiceText]               = useState('');
  const [isRecording, setIsRecording]           = useState(false);
  const [transcribing, setTranscribing]         = useState(false);
  const [voiceSubmitLoading, setVoiceSubmitLoading] = useState(false);
  const [voiceSubmitted, setVoiceSubmitted]     = useState(false);

  // Notes
  const [noteText, setNoteText]               = useState('');
  const [noteSubmitLoading, setNoteSubmitLoading] = useState(false);
  const [noteSubmitted, setNoteSubmitted]     = useState(false);

  // Extraction
  const [extractionLoading, setExtractionLoading] = useState(false);
  const [extractionResult, setExtractionResult]   = useState(null);

  // Data processing
  const [showDataProcessing, setShowDataProcessing] = useState(false);
  const [processingData, setProcessingData]         = useState(null);

  const bottomRef        = useRef(null);
  const extractionRef = useRef(null);
  const voiceSectionRef  = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);

  // ── Fetch images ──
  const fetchImages = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/hms/users/ambulance/ambulance/image/${patientId}`);
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      const d = await r.json();
      if (d.status === 'success') {
        const imgs = d.images || [];
        const sortedImgs = [...imgs].sort((a, b) =>
          new Date(b.timestamp_iso) - new Date(a.timestamp_iso)
        );
        setImages(sortedImgs);
        setMeta({
          driver_name: d.driver_name,
          vehicle_number: d.vehicle_number,
          ambulance_id: d.ambulance_id,
          total: d.total_images,
        });
        if (sortedImgs.length > 0 && !selectedImage) {
          setSelectedImage(sortedImgs[0]);
          setSelectedIndex(0);
        }
      } else {
        setImages([]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [patientId]);
const [notes, setNotes] = useState([]);
const [notesLoading, setNotesLoading] = useState(false);

const fetchNotes = async () => {
  if (!patientId) return;
  setNotesLoading(true);
  try {
    const r = await fetch(`${API_BASE}/hms/users/ambulance/ambulance/image-extracted/all-notes/${patientId}`);
    const d = await r.json();
    if (d.status === 'success') setNotes(d.notes || []);
  } catch (e) { console.error(e); }
  finally { setNotesLoading(false); }
};

useEffect(() => {
  fetchImages();
  fetchNotes();
}, [fetchImages, patientId]);
useEffect(() => {
  fetchImages();
  fetchNotes();
}, [fetchImages, patientId]);

  // ── Extraction ──
  const handleAddNote = async (image, index) => {
    try {
      setExtractionLoading(true);
      setExtractionResult(null);
      const response = await fetch(
        `${API_BASE}/hms/users/ai-legacy/extraction-ambulance-emt/ambulance/image/extract-medical-values/${patientId}`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error(`Extraction failed: ${response.status}`);
     const extractionData = await response.json();
      if (extractionData?.extractions?.length > 1) {
        const latestExtraction = [...extractionData.extractions].sort(
          (a, b) => new Date(b.timestamp_iso) - new Date(a.timestamp_iso)
        )[0];
        extractionData.extractions = [latestExtraction];
        extractionData.total_images_processed = 1;
      }
      setExtractionResult(extractionData);
      setSelectedImage(image);
      setSelectedIndex(index);
      setVoiceSubmitted(false);
      setNoteSubmitted(false);
      setTimeout(() => {
  extractionRef.current?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}, 150);
    } catch (error) {
      console.error(error);
      alert(`Extraction Failed: ${error.message}`);
    } finally {
      setExtractionLoading(false);
    }
  };
const handleProceedToVoice = async (combinedText, extractedData) => {
  console.log('🔍 DEBUG handleProceedToVoice - received extractedData:', extractedData);
  try {
    const doctorId = localStorage.getItem("doctor_id") || "";
    console.log('🔍 DEBUG - about to POST to image-extracted/save with body:', {
      patient_id: patientId,
      doctor_id: doctorId,
      image_id: selectedImage?.image_id,
      extracted_text: combinedText,
      extracted_data: extractedData
    });
    // ... rest of existing code

    // SAVE FIRST
    await fetch(
      `${API_BASE}/hms/users/ambulance/ambulance/image-extracted/save`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({

          patient_id: patientId,
          doctor_id: doctorId,

          image_id: selectedImage?.image_id,

          extracted_text: combinedText,
          extracted_data: extractedData
        })
      }
    );

    // GET LATEST SAVED RECORD
    const response = await fetch(
      `${API_BASE}/hms/users/ambulance/ambulance/image-extracted/latest/${patientId}`
    );

    const data = await response.json();

  setVoiceSubmitted(false);
   fetchNotes();

    setTimeout(() => {

      voiceSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    }, 100);

  } catch (error) {

    console.error(error);

    alert(
      "Failed to save extracted data"
    );
  }
};

  // ── Microphone ──
  const transcribeAudio = async (file) => {
    try {
      setTranscribing(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language_code', 'eng');
      const res = await fetch(
        'https://doctorassist.ai/api/hms/users/ai/elevenlabs/api/transcribe_labs',
        { method: 'POST', body: formData }
      );
      const result = await res.json();
      if (result.text) setVoiceText(prev => prev ? `${prev} ${result.text}` : result.text);
    } catch (e) {
      console.error(e);
    } finally {
      setTranscribing(false);
    }
  };

  const handleMic = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        await transcribeAudio(file);
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
    } catch (e) {
      alert('Microphone permission denied');
    }
  };

  // ── Submit voice ──
const handleVoiceSubmit = async () => {
    if (!voiceText.trim()) { alert('Please record or type a voice suggestion.'); return; }
    setVoiceSubmitLoading(true);
    try {
      const doctorId = localStorage.getItem('doctor_id') || '';
      await fetch(`${API_BASE}/hms/users/ambulance/ambulance/doctor-suggestion/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          suggestion_text: voiceText,
        }),
      });
      setVoiceSubmitted(true);
      setVoiceText('');
      fetchNotes();
    } catch (e) {
      alert('Failed to submit.');
    } finally {
      setVoiceSubmitLoading(false);
    }
  };

  // ── Submit note ──
  const handleNoteSubmit = async () => {
    if (!noteText.trim()) { alert('Please enter a clinical note.'); return; }
    setNoteSubmitLoading(true);
    try {
      await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          ai_suggestion: null,
          voice_dictation: null,
          action_type: 'not_approved',
          notes: noteText,
          image_id: selectedImage?.image_id,
          created_at: new Date().toISOString(),
        }),
      });
      setNoteSubmitted(true);
    } catch (e) {
      alert('Failed to submit note.');
    } finally {
      setNoteSubmitLoading(false);
    }
  };

  // ── Process Data ──
// ── Process Data ──
  const [processingLoading, setProcessingLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  // Add state for process message (add this near other useState declarations)
const [processMessage, setProcessMessage] = useState({ show: false, text: '', type: '' });

// Then replace the entire handleProcessData function:
const handleProcessData = async () => {
  // Clear previous message
  setProcessMessage({ show: false, text: '', type: '' });
  setProcessingLoading(true);
  
  try {
    // ✅ First check if extracted data exists in backend
    const checkResponse = await fetch(`${API_BASE}/hms/users/ambulance/ambulance/image-extracted/all-notes/${patientId}`);
    const checkData = await checkResponse.json();
    
    const hasExtractedData = checkData.status === 'success' && 
      (checkData.notes || []).some(note => note.type === 'extracted_data');
    
    if (!hasExtractedData) {
      setProcessMessage({
        show: true,
        text: '⚠️ No extracted data found. Please click on "+ Add Image For Processing" first, then click "Proceed to Voice Notes" to save the extracted data.',
        type: 'warning'
      });
      setProcessingLoading(false);
      setTimeout(() => {
        document.getElementById('process-message')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return;
    }
    
    // Proceed with AI processing
    setAiResult(null);
    const doctorId = localStorage.getItem('doctor_id') || '';
    const response = await fetch(
      `${API_BASE}/hms/users/ai-legacy/extraction-ambulance-emt/ambulance/image/process-patient-data/${patientId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
      }
    );
    
    if (!response.ok) throw new Error(`Processing failed: ${response.status}`);
    const data = await response.json();
    setAiResult(data);
    setProcessingData({
      patientData: patientData || { patient_id: patientId, fullName: patientName },
      selectedImage,
      allImages: images,
      voiceText,
      noteText,
      aiResult: data,
      processingId: data.processing_id,
    });
    setShowDataProcessing(true);
    setTimeout(() => {
      document.getElementById('data-processing-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    
  } catch (e) {
    setProcessMessage({
      show: true,
      text: `❌ AI Processing Failed: ${e.message}`,
      type: 'error'
    });
    setTimeout(() => {
      document.getElementById('process-message')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  } finally {
    setProcessingLoading(false);
  }
};

  const latestImage = images.length > 0 ? images[0] : null;

  return (
    <>
      <style>{`
        @keyframes spin      { to { transform: rotate(360deg); } }
        @keyframes pulse     { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(.88)} }
        @keyframes fadeIn    { from{opacity:0} to{opacity:1} }
        @keyframes scaleIn   { from{opacity:0;transform:scale(0.94)} to{opacity:1;transform:scale(1)} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        textarea:focus { outline: none; }
      `}</style>

      <div style={{ fontFamily: "'DM Sans', sans-serif", color: '#111' }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 20, flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{
              fontSize: 10, color: '#aaa', textTransform: 'uppercase',
              letterSpacing: '1.5px', marginBottom: 4, fontFamily: "'DM Sans', sans-serif",
            }}>
              Ambulance · Clinical Photography
            </div>
            <h2 style={{
              fontSize: 20, fontWeight: 700, color: '#000',
              letterSpacing: '-0.3px', margin: 0, fontFamily: "'DM Sans', sans-serif",
            }}>
              Clinical Images
              {meta.total > 0 && (
                <span style={{
                  marginLeft: 10, fontSize: 12, fontWeight: 700,
                  background: '#000', color: '#fff',
                  padding: '2px 10px', borderRadius: 12,
                }}>{meta.total}</span>
              )}
            </h2>
          
          </div>
          <button
            onClick={fetchImages}
            disabled={loading}
            style={{
              background: '#fff', border: '1px solid #e0e0e0',
              padding: '8px 16px', borderRadius: 6, fontSize: 12,
              fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer',
              color: '#555', fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {loading ? <><Spinner size={12} /> Refreshing…</> : '⟳ Refresh'}
          </button>
        </div>

        {/* ── Meta strip ── */}
        {(meta.driver_name || meta.vehicle_number) && (
          <div style={{
            display: 'flex', gap: 24, flexWrap: 'wrap',
            padding: '10px 16px', background: '#fafafa',
            border: '1px solid #e8e8e8', borderRadius: 6, marginBottom: 20,
          }}>
            {meta.driver_name && (
              <div>
                <span style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px', marginRight: 6 }}>Emergency Crew</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#333', fontFamily: "'DM Sans', sans-serif" }}>{meta.driver_name}</span>
              </div>
            )}
            {meta.vehicle_number && (
              <div>
                <span style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px', marginRight: 6 }}>Vehicle</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#333', fontFamily: "'DM Sans', sans-serif" }}>{meta.vehicle_number}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Tabs — full width, 50/50 split ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          border: '1.5px solid #e0e0e0', borderRadius: 8,
          overflow: 'hidden', marginBottom: 28,
        }}>
          {[
            { id: 'latest', label: 'Latest Image' },
            { id: 'all',    label: `All Images (${images.length})` },
          ].map(({ id, label }, i) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                padding: '13px 0',
                fontSize: 13,
                fontWeight: activeTab === id ? 700 : 500,
                color: activeTab === id ? '#fff' : '#555',
                background: activeTab === id ? '#111' : '#fafafa',
                border: 'none',
                borderRight: i === 0 ? '1.5px solid #e0e0e0' : 'none',
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                letterSpacing: '0.1px',
                transition: 'background 0.2s, color 0.2s',
              }}
            >{label}</button>
          ))}
        </div>

        {/* ════ TAB 1 — LATEST IMAGE ════ */}
        {activeTab === 'latest' && (
          <div style={{ marginBottom: 32, animation: 'fadeIn 0.2s ease' }}>

            {loading && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 48, justifyContent: 'center' }}>
                <Spinner size={28} />
                <span style={{ fontSize: 14, color: '#aaa', fontFamily: "'DM Sans', sans-serif" }}>Loading clinical images…</span>
              </div>
            )}

            {!loading && error && (
              <div style={{ padding: 32, textAlign: 'center', border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2' }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>⚠️</div>
                <div style={{ fontSize: 13, color: '#c0392b', marginBottom: 14, fontFamily: "'DM Sans', sans-serif" }}>Failed to load images: {error}</div>
                <button onClick={fetchImages} style={{ background: '#000', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Retry</button>
              </div>
            )}

            {!loading && !error && images.length === 0 && (
              <div style={{ textAlign: 'center', padding: 64, color: '#aaa', border: '1px dashed #e0e0e0', borderRadius: 8 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6, color: '#666', fontFamily: "'DM Sans', sans-serif" }}>No clinical images received yet</div>
                <div style={{ fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>Images captured by the Emergency Crew will appear here automatically.</div>
              </div>
            )}

{!loading && !error && latestImage && (
              <div>
                <div style={{
                  border: '2px solid #000', borderRadius: 12, overflow: 'hidden',
                  background: '#fff', marginBottom: 20,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                }}>
                  <div style={{
                    background: '#000', color: '#fff', padding: '8px 16px',
                    fontSize: 11, fontWeight: 700, letterSpacing: '1px',
                    textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif",
                  }}>
                    Latest Clinical Image
                  </div>

                  {/* Small thumbnail — click to expand */}
                  <div
                    onClick={() => setShowLatestModal(true)}
                    style={{
                      position: 'relative', height: 220, background: '#f0f0f0',
                      overflow: 'hidden', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseEnter={e => { e.currentTarget.querySelector('.__expand-hint').style.opacity = 1; }}
                    onMouseLeave={e => { e.currentTarget.querySelector('.__expand-hint').style.opacity = 0; }}
                  >
                    <img
                      src={latestImage.image_url}
                      alt="Latest Clinical"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                    />
                    <div
                      className="__expand-hint"
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(0,0,0,0.28)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: 0, transition: 'opacity 0.2s',
                      }}
                    >
                      <span style={{
                        fontSize: 12, color: '#fff', fontWeight: 700,
                        background: 'rgba(0,0,0,0.6)', padding: '6px 16px',
                        borderRadius: 20, fontFamily: "'DM Sans', sans-serif",
                      }}>⤢ Click to Expand</span>
                    </div>
                  </div>

                  <div style={{ padding: '14px 16px', background: '#fafafa', borderTop: '1px solid #e0e0e0' }}>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: '0.6px', fontFamily: "'DM Sans', sans-serif" }}>Captured</span>
                        <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{fmtTimestamp(latestImage.timestamp_iso)}</div>
                      </div>
                      {latestImage.driver_name && (
                        <div>
                          <span style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: '0.6px', fontFamily: "'DM Sans', sans-serif" }}>Emergency Crew</span>
                          <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{latestImage.driver_name}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <button
                    onClick={() => handleAddNote(latestImage, 0)}
                    disabled={extractionLoading}
                    style={{
                      background: '#000', color: '#fff', border: 'none',
                      padding: '11px 26px', borderRadius: 6, fontSize: 13, fontWeight: 700,
                      cursor: extractionLoading ? 'not-allowed' : 'pointer',
                      fontFamily: "'DM Sans', sans-serif",
                      display: 'flex', alignItems: 'center', gap: 8,
                      opacity: extractionLoading ? 0.75 : 1,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!extractionLoading) e.currentTarget.style.background = '#333'; }}
                    onMouseLeave={e => e.currentTarget.style.background = '#000'}
                  >
                    {extractionLoading
                      ? <><Spinner size={14} color="#fff" /> Extracting…</>
                      : <><span style={{ fontSize: 16 }}>+</span> Add Image For Processing</>
                    }
                  </button>
                </div>
              </div>
            )}

            {/* Full-size modal for latest image, reusing the existing ImageModal */}
            {showLatestModal && latestImage && (
              <ImageModal
                image={latestImage}
                index={0}
                onClose={() => setShowLatestModal(false)}
              />
            )}

            {/* Extraction panel — only in Latest tab */}
           {extractionResult && (
  <div ref={extractionRef}>
    <ExtractionPanel
      extractionResult={extractionResult}
      onProceed={handleProceedToVoice}
    />
  </div>
)}
            {/* Voice Notes + Clinical Notes + Process Data — only in Latest tab */}
            <div ref={bottomRef} style={{ animation: 'slideDown 0.25s ease' }}>

             {/* Info message */}
              <div style={{
                marginBottom: 16, padding: '10px 16px',
                background: '#fff5f5', border: '1px solid #fecaca',
                borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 16 }}>🔴</span>
                <span style={{
                  fontSize: 12, color: '#dc2626', fontWeight: 500,
                  fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5,
                }}>
                  If you do not want AI processing, you can directly suggest to EMT using the voice notes below for Image Processing
                </span>
              </div>

              {/* Voice Notes */}
              <div
                ref={voiceSectionRef}
                style={{ marginBottom: 24, border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}
              >
                <div style={{
                  padding: '14px 20px', background: '#fafafa', borderBottom: '1px solid #e8e8e8',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1px', color: '#111', fontFamily: "'DM Sans', sans-serif" }}>
                    VOICE NOTES / MANUAL INSTRUCTIONS FOR IMAGE PROCESSING
                  </div>
                  <button
                    type="button"
                    onClick={handleMic}
                    disabled={transcribing}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                  >
                    {transcribing ? <Spinner size={30} /> : isRecording ? (
                      <div style={{
                        width: 72, height: 72, borderRadius: '50%', background: '#dc3545',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        animation: 'pulse 1.5s infinite',
                      }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="6" y="3" width="12" height="16" rx="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                        <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: '1px', marginTop: 3 }}>REC</span>
                      </div>
                    ) : (
                      <div style={{
                        width: 72, height: 72, borderRadius: '50%', border: '2px solid #111',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff',
                      }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="23" />
                          <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                      </div>
                    )}
                  </button>
                </div>

              <div style={{ padding: 24, background: '#fff' }}>
                  {voiceText && extractionResult && (
                    <div style={{
                      fontSize: 11, color: '#16a34a', marginBottom: 10,
                      background: '#f0fdf4', border: '1px solid #bbf7d0',
                      padding: '6px 12px', borderRadius: 4,
                      fontFamily: "'DM Sans', sans-serif",
                    }}>
                      ✓ Populated from extracted data — edit as needed
                    </div>
                  )}
                  <textarea
                    value={voiceText}
                    onChange={e => setVoiceText(e.target.value)}
                    placeholder="Enter additional clinical instructions or record voice notes..."
                    style={{
                      width: '100%', minHeight: 180,
                      border: '1.5px solid #e0e0e0', padding: '16px 18px',
                      fontSize: 13, borderRadius: 6, resize: 'vertical',
                      outline: 'none', lineHeight: 1.8,
                      fontFamily: "'DM Sans', sans-serif",
                      color: '#1a1a1a', background: '#fff',
                      boxSizing: 'border-box', transition: 'border-color 0.2s',
                    }}
                    onFocus={e => e.target.style.borderColor = '#111'}
                    onBlur={e => e.target.style.borderColor = '#e0e0e0'}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button
                      onClick={handleVoiceSubmit}
                      disabled={voiceSubmitLoading}
                      style={{
                        background: '#111', color: '#fff', border: 'none',
                        padding: '11px 22px', borderRadius: 6, fontSize: 13,
                        fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      {voiceSubmitLoading ? 'Submitting…' : 'Submit Suggestion'}
                    </button>
                    <button
                      onClick={() => {
                        setVoiceText('');
                        if (isRecording) {
                          mediaRecorderRef.current?.stop();
                          streamRef.current?.getTracks().forEach(t => t.stop());
                          setIsRecording(false);
                        }
                      }}
                      style={{
                        background: '#fff', color: '#666', border: '1px solid #e0e0e0',
                        padding: '11px 22px', borderRadius: 6, fontSize: 13,
                        fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                      }}
                    >Clear</button>
                  </div>
                {voiceSubmitted && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#16a34a', fontFamily: "'DM Sans', sans-serif" }}>
                      ✓ Doctor suggestion submitted successfully
                    </div>
                  )}
                </div>
              </div>

              {/* ── Notes Section ── */}
              <div style={{ border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden', marginTop: 24 }}>
                <div style={{
                  padding: '14px 20px', background: '#fafafa', borderBottom: '1px solid #e8e8e8',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1px', color: '#111', fontFamily: "'DM Sans', sans-serif" }}>
                    NOTES FOR IMAGE PROCESSING
                  </div>
                  <button
                    onClick={fetchNotes}
                    disabled={notesLoading}
                    style={{
                      background: '#111', color: '#fff', border: 'none',
                      padding: '7px 16px', borderRadius: 6, fontSize: 12,
                      fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                    }}
                  >{notesLoading ? 'Loading…' : 'Reload'}</button>
                </div>

              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }}>
                  {notes.length === 0 && !notesLoading && (
                    <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '24px 0', fontFamily: "'DM Sans', sans-serif" }}>
                      No notes yet.
                    </div>
                  )}
                  {notes.map((note, i) => (
                    <div key={i} style={{
                      border: '1px solid #e8e8e8', borderRadius: 8,
                      overflow: 'hidden', background: '#fff',
                    }}>
                      <div style={{
                        padding: '8px 14px', display: 'flex',
                        justifyContent: 'space-between', alignItems: 'center',
                        borderBottom: '1px solid #f0f0f0',
                      }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
                          background: note.type === 'doctor_suggestion' ? '#111' : '#e8e8e8',
                          color: note.type === 'doctor_suggestion' ? '#fff' : '#333',
                          fontFamily: "'DM Sans', sans-serif", textTransform: 'uppercase',
                        }}>
                          {note.type === 'doctor_suggestion' ? 'Doctor Suggestion' : 'Extracted Data'}
                        </span>
                       <span style={{ fontSize: 11, color: '#999' }}>
  {fmtTimestamp(
    note.image_timestamp_iso ||
    note.timestamp_iso
  )}
</span>
                      </div>
                      <div style={{
                        padding: '12px 16px', fontSize: 11, color: '#222',
                        lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif",
                        background: '#fafafa', wordBreak: 'break-word',
                      }}>
                        {note.type === 'doctor_suggestion'
                          ? note.suggestion_text
                          : (note.extracted_text || '')
                              .split('\n')
                              .map(l => l.trim())
                              .filter(l => l.length > 0)
                              .join(', ')
                        }
                      </div>
                    </div>
                  ))}
                </div>

   <div style={{ padding: '14px 20px', borderTop: '1px solid #e8e8e8', background: '#fff' }}>
  {/* Message display */}
  {processMessage.show && (
    <div 
      id="process-message"
      style={{
        marginBottom: 16,
        padding: '12px 16px',
        borderRadius: 6,
        backgroundColor: processMessage.type === 'warning' ? '#fffbeb' : '#fef2f2',
        borderLeft: `4px solid ${processMessage.type === 'warning' ? '#f59e0b' : '#dc2626'}`,
        color: processMessage.type === 'warning' ? '#92400e' : '#991b1b',
        fontSize: 13,
        fontFamily: "'DM Sans', sans-serif",
        lineHeight: 1.5,
      }}
    >
      {processMessage.text}
    </div>
  )}
  
  <button
    onClick={handleProcessData}
    disabled={processingLoading}
    style={{
      background: '#111', color: '#fff', border: 'none',
      padding: '11px 26px', borderRadius: 6, fontSize: 13,
      fontWeight: 700, cursor: processingLoading ? 'not-allowed' : 'pointer',
      fontFamily: "'DM Sans', sans-serif",
      display: 'flex', alignItems: 'center', gap: 8,
      opacity: processingLoading ? 0.75 : 1,
    }}
    onMouseEnter={e => { if (!processingLoading) e.currentTarget.style.background = '#333'; }}
    onMouseLeave={e => e.currentTarget.style.background = '#111'}
  >
    {processingLoading
      ? <><Spinner size={14} color="#fff" /> Processing AI Analysis…</>
      : <>Process Image Data →</>
    }
  </button>
</div>
              </div>

            </div>
          </div>
        )}

        {/* ════ TAB 2 — ALL IMAGES (images only, no notes) ════ */}
        {activeTab === 'all' && (
          <div style={{ marginBottom: 32, animation: 'fadeIn 0.2s ease' }}>

            {loading && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 48, justifyContent: 'center' }}>
                <Spinner size={28} />
                <span style={{ fontSize: 14, color: '#aaa', fontFamily: "'DM Sans', sans-serif" }}>Loading clinical images…</span>
              </div>
            )}

            {!loading && error && (
              <div style={{ padding: 32, textAlign: 'center', border: '1px solid #fecaca', borderRadius: 6, background: '#fef2f2' }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>⚠️</div>
                <div style={{ fontSize: 13, color: '#c0392b', marginBottom: 14, fontFamily: "'DM Sans', sans-serif" }}>Failed: {error}</div>
                <button onClick={fetchImages} style={{ background: '#000', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Retry</button>
              </div>
            )}

            {!loading && !error && images.length === 0 && (
              <div style={{ textAlign: 'center', padding: 64, color: '#aaa', border: '1px dashed #e0e0e0', borderRadius: 8 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6, color: '#666', fontFamily: "'DM Sans', sans-serif" }}>No clinical images received yet</div>
                <div style={{ fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>Images captured by the Emergency Crew will appear here automatically.</div>
              </div>
            )}

            {!loading && !error && images.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 20,
              }}>
                {images.map((img, i) => (
                  <ImageCard
                    key={img.image_id || i}
                    image={img}
                    index={i}
                    onView={(image, index) => { setModalImage(image); setModalIndex(index); }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

      {/* ── Data Processing Section (only on Latest tab) ── */}
{activeTab === 'latest' && showDataProcessing && processingData && aiResult && (
  <div id="data-processing-section" style={{ marginTop: 48, borderTop: '2px solid #000', paddingTop: 32 }}>
    <DataProcessingAmbulanceImage
      processingData={processingData}
      aiResult={aiResult}
      patientId={patientId}
     onApprove={() => {}}
      onNotApprove={() => {
        setTimeout(() => {
          voiceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }}
      hideDataProcessing={activeTab !== 'latest'}  // optional, but safe to add
    />
  </div>
)}
      </div>

      {/* ── Image Modal (All Images tab) ── */}
      {modalImage && (
        <ImageModal
          image={modalImage}
          index={modalIndex}
          onClose={() => { setModalImage(null); setModalIndex(null); }}
        />
      )}
    </>
  );
};

export default React.memo(AmbulanceImagePhotography);