import React, { useRef, useState } from "react";
import {
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  TextareaAutosize
} from "@mui/material";
import { Mic, Stop, AutoFixHigh, GraphicEq } from "@mui/icons-material";
const brandGradient =
  "linear-gradient(135deg, #1ccfc9 0%, #3fb6ff 50%, #2b5cff 100%)";

export default function GlassTranscriptionPanel({ onTranscribe, doctorId, patientId }) {
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState("normal");
const glassIcon = {
  fontSize: 20,
  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.15))",
};
const saveConversation = async () => {
  if (!transcript.trim()) return;

  try {
    await fetch("https://demo.doctorassist.ai/api/conversation/savew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        patient_id: patientId,
        message: {
          text: transcript,
          sender: "doctor",
          timestamp: new Date().toISOString()
        }
      })
    });
    console.log("Conversation saved successfully");
  } catch (err) {
    console.error("Failed to save conversation:", err);
  }
};
const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    mediaRecorder.current = new MediaRecorder(stream);
    audioChunks.current = [];

    mediaRecorder.current.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.current.push(e.data);
    };

    mediaRecorder.current.start();
    setRecording(true);
  } catch (err) {
    console.error("Microphone access denied:", err);
    alert("Microphone permission is required.");
  }
};

const stopRecording = () => {
  if (!mediaRecorder.current) return;

  mediaRecorder.current.onstop = async () => {
    // All audio chunks are available here
    await processAudio();
  };

  mediaRecorder.current.stop();
  mediaRecorder.current.stream.getTracks().forEach(track => track.stop()); // release mic
  setRecording(false);
};

const processAudio = async () => {
  if (audioChunks.current.length === 0) {
    alert("No audio recorded!");
    return;
  }

  setProcessing(true);

  const blob = new Blob(audioChunks.current, { type: "audio/webm" });
  const formData = new FormData();
  formData.append("file", blob, "audio.webm");

  try {
    const res = await fetch("https://doctorassist.ai/api/transcribe_labs", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    const text = data?.text || "";

    setTranscript(text);
    if (onTranscribe) onTranscribe(text);

    if (mode === "conversation") {
      await saveConversation();
    }
  } catch (err) {
    console.error(err);
    alert("Transcription failed");
  }

  setProcessing(false);
};



 return (
  <Card
    sx={{
      mb: 3,
      borderRadius: "28px",
      background:
        "linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.35))",
      backdropFilter: "blur(32px) saturate(180%)",
      border: "1px solid rgba(255,255,255,0.6)",
      boxShadow: "0 20px 50px rgba(31,38,135,0.12)"
    }}
  >
    <CardContent>

      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <Box
  sx={{
    width: 44,
    height: 44,
    borderRadius: "14px",
    background: `
      linear-gradient(135deg,
        rgba(255,255,255,0.55),
        rgba(63,182,255,0.35)
      )
    `,
    backdropFilter: "blur(14px)",
    border: "1px solid rgba(255,255,255,0.6)",
    color: "#1f6fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 20px rgba(63,182,255,0.25)"
  }}
>
  <GraphicEq sx={glassIcon} />
</Box>
<Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
  <Typography fontSize={12} fontWeight={700} sx={{ opacity: 0.7 }}>
    Mode:
  </Typography>

  <Box
    component="select"
    value={mode}
    onChange={(e) => setMode(e.target.value)}
    style={{
      padding: "6px 12px",
      borderRadius: "12px",
      border: "1px solid rgba(63,182,255,0.4)",
      background: "rgba(255,255,255,0.6)",
      fontWeight: 600,
      outline: "none",
      cursor: "pointer"
    }}
  >
    <option value="normal">Normal</option>
    <option value="conversation">Conversation</option>
  </Box>
</Box>


        <Box>
          <Typography fontWeight={800} fontSize={15}>
            Voice Transcription
          </Typography>
          <Typography fontSize={11} sx={{ opacity: 0.6 }}>
            Real-time medical dictation
          </Typography>
        </Box>
      </Box>

      {/* Controls */}
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", mb: 3 }}>
        <Button
  onClick={recording ? stopRecording : startRecording}
  sx={{
      borderRadius: "18px",
      px: 3,
      py: 1,
      fontWeight: 700,
      border: "1px solid rgba(63,182,255,0.4)",
      color: "#3fb6ff"
  }}
>
  {recording ? <Stop sx={{ mr: 1 }} /> : <Mic sx={{ mr: 1 }} />}
  {recording ? "Stop" : "Record"}
</Button>

        <Button
          disabled={processing || recording}
          onClick={processAudio}
          sx={{
            borderRadius: "18px",
            px: 3,
            py: 1,
            fontWeight: 700,
            border: "1px solid rgba(63,182,255,0.4)",
            color: "#3fb6ff"
          }}
        >
          <AutoFixHigh sx={{ mr: 1 }} />
          {processing ? "Processing..." : "Transcribe"}
        </Button>

        {recording && (
          <Typography sx={{ color: "#ff5c5c", fontWeight: 700, ml: 1 }}>
            ● Recording
          </Typography>
        )}
      </Box>

      {/* Transcript */}
      <Box
        sx={{
          borderRadius: "20px",
          border: "1px solid rgba(255,255,255,0.6)",
          background: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(24px)",
          boxShadow: "inset 0 2px 8px rgba(255,255,255,0.4)",
          p: 2
        }}
      >
        <TextareaAutosize
  minRows={6}
  value={transcript}
  onChange={(e) => {
   const text = e.target.value;
  setTranscript(text);
  if (onTranscribe) onTranscribe(text);
}}
  placeholder="Transcription will appear here..."
  style={{
    width: "100%",
    border: "none",
    background: "transparent",
    resize: "none",
    outline: "none",
    fontSize: "14px",
    fontFamily: "Inter, sans-serif"
  }}
/>

      </Box>

    </CardContent>
  </Card>
);
}