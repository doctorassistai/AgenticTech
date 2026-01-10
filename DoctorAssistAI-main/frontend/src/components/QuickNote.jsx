import React, { useRef, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Mic, Edit, Trash, Check, X, Clock, AlertCircle } from "lucide-react";

/* ======= BRAND CONFIG ======= */
const PRIMARY_BLUE = "#005a8b";
const ACCENT_TEAL = "#00c2a7";
const ACCENT_PURPLE = "#5856D6";
const LIGHT_BG = "#f5f7fa";

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const liquidGlassBase = {
  background: "rgba(255, 255, 255, 0.65)",
  backdropFilter: "blur(35px) saturate(180%)",
  WebkitBackdropFilter: "blur(35px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.85)",
  borderRadius: "18px",
  boxShadow: `
    0 15px 35px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.8)
  `,
  position: "relative",
  overflow: "hidden"
};

export default function QuickNote() {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");
  const patientId = query.get("patient_id");
  
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // "success" or "error"

  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);

  // Reset message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      mediaRecorder.current.start();
      setRecording(true);
      setMessage("Recording started...");
      setMessageType("success");
    } catch (err) {
      console.error("Microphone access error:", err);
      setMessage("Microphone access denied. Please check permissions.");
      setMessageType("error");
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorder.current) return;

    mediaRecorder.current.onstop = async () => {
      await transcribeAudio();
    };

    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
    setRecording(false);
    setMessage("Recording stopped. Processing audio...");
    setMessageType("success");
  };

  const transcribeAudio = async () => {
    if (!audioChunks.current.length) return;

    setProcessing(true);

    const blob = new Blob(audioChunks.current, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("file", blob, "audio.webm");

    try {
      const res = await fetch("https://doctorassist.ai/api/transcribe_labs", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      const transcript = data?.text || "";
      setText(prev => prev + (prev ? " " + transcript : transcript));
      setMessage("Transcription complete!");
      setMessageType("success");
    } catch (err) {
      console.error("Transcription failed:", err);
      setMessage("Transcription failed. Please try again.");
      setMessageType("error");
    }

    setProcessing(false);
  };

  const handleSave = async () => {
    if (!text.trim()) {
      setMessage("Please enter some text or use dictation.");
      setMessageType("error");
      return;
    }

    if (!doctorId || !patientId) {
      setMessage("Doctor ID or Patient ID is missing from URL.");
      setMessageType("error");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("https://demo.doctorassist.ai/api/quick_notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          text: text.trim(),
          priority: priority
        })
      });

      const data = await response.json();

      if (data.status === "success") {
        setMessage(`Quick note saved as ${priority} priority!`);
        setMessageType("success");
        setText("");
        setTimeout(() => setOpen(false), 1500);
      } else {
        throw new Error(data.detail || "Failed to save note");
      }
    } catch (err) {
      console.error("Save error:", err);
      setMessage(err.message || "Failed to save note. Please try again.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case "Critical":
        return "#FF3B30";
      case "Medium":
        return "#FF9500";
      case "Normal":
        return PRIMARY_BLUE;
      default:
        return PRIMARY_BLUE;
    }
  };

  const getPriorityBgColor = (priority) => {
    switch (priority) {
      case "Critical":
        return hexToRgba("#FF3B30", 0.1);
      case "Medium":
        return hexToRgba("#FF9500", 0.1);
      case "Normal":
        return hexToRgba(PRIMARY_BLUE, 0.1);
      default:
        return hexToRgba(PRIMARY_BLUE, 0.1);
    }
  };

  const styles = {
    floatingButton: {
      ...liquidGlassBase,
      position: 'fixed',
      right: '24px',
      bottom: '50%',
      transform: 'translateY(50%)',
      background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_TEAL})`,
      color: 'white',
      border: 'none',
      padding: '14px 20px',
      borderRadius: '14px',
      cursor: 'pointer',
      fontSize: '15px',
      fontWeight: '700',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      zIndex: 100,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: `0 8px 25px ${hexToRgba(ACCENT_TEAL, 0.3)}`,
      '&:hover': {
        transform: 'translateY(50%) scale(1.05)',
        boxShadow: `0 12px 30px ${hexToRgba(ACCENT_TEAL, 0.4)}`
      }
    },
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    },
    modalContent: {
      ...liquidGlassBase,
      width: '100%',
      maxWidth: '700px',
      padding: '28px',
      position: 'relative'
    },
    closeButton: {
      position: 'absolute',
      top: '20px',
      right: '20px',
      background: hexToRgba(PRIMARY_BLUE, 0.1),
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.2)}`,
      color: PRIMARY_BLUE,
      borderRadius: '10px',
      width: '36px',
      height: '36px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s',
      '&:hover': {
        background: hexToRgba(PRIMARY_BLUE, 0.2),
        transform: 'rotate(90deg)'
      }
    },
    label: {
      display: 'block',
      marginBottom: '8px',
      color: PRIMARY_BLUE,
      fontWeight: '700',
      fontSize: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    select: {
      ...liquidGlassBase,
      width: '100%',
      padding: '12px 16px',
      fontSize: '14px',
      color: PRIMARY_BLUE,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.2)}`,
      borderRadius: '12px',
      outline: 'none',
      cursor: 'pointer',
      appearance: 'none',
      background: 'rgba(255, 255, 255, 0.9)',
      transition: 'all 0.2s',
      '&:focus': {
        borderColor: ACCENT_TEAL,
        boxShadow: `0 0 0 3px ${hexToRgba(ACCENT_TEAL, 0.2)}`
      }
    },
    textarea: {
      ...liquidGlassBase,
      width: '100%',
      minHeight: '180px',
      padding: '18px',
      fontSize: '15px',
      color: PRIMARY_BLUE,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.2)}`,
      borderRadius: '14px',
      outline: 'none',
      resize: 'vertical',
      background: 'rgba(255, 255, 255, 0.9)',
      transition: 'all 0.2s',
      lineHeight: '1.6',
      '&:focus': {
        borderColor: ACCENT_TEAL,
        boxShadow: `0 0 0 3px ${hexToRgba(ACCENT_TEAL, 0.2)}`
      },
      '&::placeholder': {
        color: hexToRgba(PRIMARY_BLUE, 0.4),
        fontStyle: 'italic'
      }
    },
    buttonGroup: {
      display: 'flex',
      gap: '12px',
      marginTop: '24px',
      flexWrap: 'wrap'
    },
    button: {
      ...liquidGlassBase,
      padding: '12px 24px',
      fontSize: '14px',
      fontWeight: '600',
      borderRadius: '12px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      border: 'none',
      minWidth: '140px'
    },
    dictationButton: {
      background: recording ? '#FF3B30' : `linear-gradient(135deg, ${ACCENT_PURPLE}, ${hexToRgba(ACCENT_PURPLE, 0.8)})`,
      color: 'white',
      '&:hover': {
        transform: 'translateY(-2px)',
        boxShadow: `0 10px 25px ${hexToRgba(ACCENT_PURPLE, 0.4)}`
      }
    },
    clearButton: {
      background: hexToRgba(PRIMARY_BLUE, 0.1),
      color: PRIMARY_BLUE,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.2)}`,
      '&:hover': {
        background: hexToRgba(PRIMARY_BLUE, 0.2),
        transform: 'translateY(-2px)'
      }
    },
    saveButton: {
      background: saving ? hexToRgba(ACCENT_TEAL, 0.7) : `linear-gradient(135deg, ${ACCENT_TEAL}, ${PRIMARY_BLUE})`,
      color: 'white',
      '&:hover': saving ? {} : {
        transform: 'translateY(-2px)',
        boxShadow: `0 10px 25px ${hexToRgba(ACCENT_TEAL, 0.4)}`
      }
    },
    messageBox: {
      marginTop: '16px',
      padding: '12px 16px',
      borderRadius: '10px',
      fontSize: '14px',
      fontWeight: '600',
      textAlign: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px'
    },
    successMessage: {
      background: hexToRgba('#34C759', 0.1),
      color: '#34C759',
      border: `1px solid ${hexToRgba('#34C759', 0.2)}`
    },
    errorMessage: {
      background: hexToRgba('#FF3B30', 0.1),
      color: '#FF3B30',
      border: `1px solid ${hexToRgba('#FF3B30', 0.2)}`
    },
    infoBox: {
      background: hexToRgba(PRIMARY_BLUE, 0.05),
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.1)}`,
      borderRadius: '12px',
      padding: '12px 16px',
      marginBottom: '20px',
      fontSize: '13px',
      color: hexToRgba(PRIMARY_BLUE, 0.8)
    },
    priorityIndicator: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: '700',
      marginLeft: '12px'
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(true)}
        style={styles.floatingButton}
      >
        <Edit size={18} />
        Quick Note
      </button>

      {open && (
        <div style={styles.modalOverlay} onClick={() => setOpen(false)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setOpen(false)}
              style={styles.closeButton}
            >
              <X size={18} />
            </button>

            <h2 style={{
              color: PRIMARY_BLUE,
              fontSize: '24px',
              fontWeight: '800',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <Edit size={24} />
              Quick Clinical Note
              <span style={{
                ...styles.priorityIndicator,
                background: getPriorityBgColor(priority),
                color: getPriorityColor(priority)
              }}>
                <AlertCircle size={12} />
                {priority} Priority
              </span>
            </h2>

           

            <div style={{ marginBottom: '20px' }}>
              <label style={styles.label}>
                <AlertCircle size={16} />
                Priority Level
              </label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                style={styles.select}
              >
                <option value="Critical" style={{ color: '#FF3B30', fontWeight: '600' }}>🚨 Critical</option>
                <option value="Medium" style={{ color: '#FF9500', fontWeight: '600' }}>⚠️ Medium</option>
                <option value="Normal" style={{ color: PRIMARY_BLUE, fontWeight: '600' }}>📝 Normal</option>
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={styles.label}>
                📝 Clinical Notes
              </label>
              <textarea
                rows={6}
                value={text}
                onChange={e => setText(e.target.value)}
                style={styles.textarea}
                placeholder="Type your clinical notes here, or use the dictation feature below..."
              />
              <div style={{
                fontSize: '12px',
                color: hexToRgba(PRIMARY_BLUE, 0.6),
                marginTop: '8px',
                textAlign: 'right'
              }}>
                {text.length} characters
              </div>
            </div>

            <div style={styles.buttonGroup}>
              <button
                onClick={recording ? stopRecording : startRecording}
                style={{
                  ...styles.button,
                  ...styles.dictationButton
                }}
                disabled={processing}
              >
                <Mic size={16} />
                {recording ? "Stop Dictation" : processing ? "Processing..." : "Start Dictation"}
                {recording && (
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: '#FF3B30',
                    marginLeft: '8px',
                    animation: 'pulse 1s infinite'
                  }}></div>
                )}
              </button>

              <button
                onClick={() => setText("")}
                style={{
                  ...styles.button,
                  ...styles.clearButton
                }}
                disabled={!text.trim()}
              >
                <Trash size={16} />
                Clear Text
              </button>

              <button
                onClick={handleSave}
                disabled={saving || !text.trim() || !doctorId || !patientId}
                style={{
                  ...styles.button,
                  ...styles.saveButton
                }}
              >
                <Check size={16} />
                {saving ? "Saving..." : "Save Note"}
              </button>
            </div>

            {message && (
              <div style={{
                ...styles.messageBox,
                ...(messageType === 'success' ? styles.successMessage : styles.errorMessage)
              }}>
                {messageType === 'success' ? '✓' : '⚠️'} {message}
              </div>
            )}

            <div style={{
              fontSize: '11px',
              color: hexToRgba(PRIMARY_BLUE, 0.5),
              textAlign: 'center',
              marginTop: '20px',
              paddingTop: '12px',
              borderTop: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.1)}`
            }}>
              <strong>Note:</strong> Dictation requires microphone access. Notes are saved by priority level and can be reviewed later.
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}