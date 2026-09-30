import React, { useRef, useState } from "react";
import { useNephrology } from "../context/NephrologyContext";
import { structureNephrologyDictation, transcribeNephrologyAudio } from "../services/nephrologyApi";
import {
  extractNephrologyLocalDictation,
  resolveProcedureCategoryAndType,
  procedureFieldsFor,
} from "./procedureDictation";

const VoiceDictationPanel = ({ section, fields, onStructured, transformStructuredValues }) => {
  const { updateFields, sessionStatus } = useNephrology();
  const isReadOnly = sessionStatus === "completed";
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isStructuring, setIsStructuring] = useState(false);
  const [message, setMessage] = useState("");
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      setMessage("");
      setIsRecording(true);
    } catch (error) {
      console.error("Unable to access microphone:", error);
      setMessage("Microphone access was denied or is unavailable.");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || !isRecording) return;
    recorder.onstop = async () => {
      setIsRecording(false);
      setIsTranscribing(true);
      try {
        const audio = new Blob(chunksRef.current, { type: "audio/webm" });
        const result = await transcribeNephrologyAudio(audio);
        const text = result?.text || result?.transcription || "";
        if (!text) throw new Error("The transcription service returned no text");
        setTranscript((previous) => previous ? `${previous} ${text}` : text);
        setMessage("Audio transcribed. Review the text, then run AI auto-fill.");
      } catch (error) {
        console.error("Nephrology audio transcription failed:", error);
        setMessage(error.message || "Audio transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
  };

  const autofill = async () => {
    if (!transcript.trim()) return;
    setIsStructuring(true);
    setMessage("");

    // 1. Instant smart local clinical rule-based extraction
    let localValues = {};
    try {
      localValues = extractNephrologyLocalDictation(transcript);
    } catch (e) {
      console.warn("Local extractor notice:", e);
    }

    // 2. Resolve true category and procType dynamically from speech text
    const resolved = resolveProcedureCategoryAndType(
      localValues.proc_category,
      localValues.proc_type,
      transcript
    );

    // 3. Dynamically query correct fields for the detected procedure
    const dynamicFields = procedureFieldsFor(resolved.category, resolved.procType, transcript) || fields;

    // 4. Attempt backend Groq LLM extraction
    let backendValues = {};
    try {
      const result = await structureNephrologyDictation({
        text: transcript,
        fields: dynamicFields,
        section: `Nephrology Operative Record — ${resolved.procType || resolved.category || section || "Procedure"}`
      });
      backendValues = result?.data || {};
    } catch (error) {
      console.warn("Nephrology LLM backend notice, using instant local extractor:", error.message);
    }

    // 5. Merge values: local guaranteed fallback + backend LLM
    let merged = {
      ...localValues,
      ...backendValues,
      proc_category: resolved.category,
      proc_type: resolved.procType,
    };

    if (transformStructuredValues) {
      merged = transformStructuredValues({ values: merged, transcript });
    }

    updateFields(merged);
    if (onStructured) onStructured({ values: merged, transcript });

    const count = Object.keys(merged).length;
    setMessage(count ? `${count} field${count === 1 ? "" : "s"} auto-filled. Please verify before saving.` : "Dictation applied.");
    setIsStructuring(false);
  };

  return (
    <div style={{ border: "1px solid #d0d0d0", background: "#fafafa", padding: "14px", marginBottom: "20px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>Voice Dictation & AI Auto-fill</div>
      <textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        disabled={isReadOnly || isRecording || isTranscribing || isStructuring}
        placeholder={`Type or dictate ${section.toLowerCase()} notes here...`}
        rows={4}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d0d0d0", padding: "10px", fontSize: "12px", resize: "vertical", marginBottom: "10px" }}
      />
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isReadOnly || isTranscribing || isStructuring}
          style={{ border: "1px solid #000", background: isRecording ? "#b42318" : "#000", color: "#fff", padding: "7px 14px", cursor: "pointer" }}
        >
          {isTranscribing ? "Transcribing..." : isRecording ? "Stop Dictation" : "Start Dictation"}
        </button>
        <button
          type="button"
          onClick={autofill}
          disabled={isReadOnly || !transcript.trim() || isRecording || isTranscribing || isStructuring}
          style={{ border: "1px solid #000", background: "#fff", color: "#000", padding: "7px 14px", cursor: "pointer" }}
        >
          {isStructuring ? "Extracting..." : "AI Auto-fill Fields"}
        </button>
        {message && <span style={{ fontSize: "11px", color: message.includes("failed") || message.includes("denied") ? "#b42318" : "#386a20" }}>{message}</span>}
      </div>
    </div>
  );
};

export default VoiceDictationPanel;
