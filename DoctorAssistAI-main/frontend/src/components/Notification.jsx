import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Box, Typography } from "@mui/material";

export default function Notification({ doctorId, patientId }) {
  const [message, setMessage] = useState("");
  const [featureName, setFeatureName] = useState("During Consultation Updates");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const MAX_LENGTH = 260;

  const previewText = useMemo(() => {
    if (message.length <= MAX_LENGTH) return message;
    return message.slice(0, MAX_LENGTH) + "...";
  }, [message]);

  useEffect(() => {
    if (!doctorId || !patientId) return;

    const loadNotification = async () => {
      try {
        const res = await fetch(
          `https://demo.doctorassist.ai/api/hms/users/speciality/during-get-clinical-configuration/${doctorId}?consultation_phase=DURING_CONSULTATION`
        );
        const config = await res.json();
        if (!config?.data?.length) return;

        let allMessages = [];

        for (const item of config.data) {
          const payload = {
            consultation_phase: item.consultation_phase,
            feature_id: item.feature_id,
            patient_id: patientId,
            form_id: item.form_id,
            doctor_id: doctorId
          };

          const exec = await fetch(
            "https://demo.doctorassist.ai/api/hms/users/speciality/execute-specialty-feature-db",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            }
          );

          const result = await exec.json();

          const text =
            result?.analysis_result?.forms_output
              ?.map(f => f.analysis)
              .join("\n\n") ||
            result?.message;

          if (text) allMessages.push(`• ${text}`);
        }

        if (!allMessages.length) return;

        setMessage(allMessages.join("\n\n"));
        setExpanded(false);
        setOpen(true);
      } catch (err) {
        console.error("Notification error:", err);
      }
    };

    loadNotification();
  }, [doctorId, patientId]);

  const handleClear = () => {
    setOpen(false);
    setExpanded(false);
    setMessage("");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -25 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -25 }}
          transition={{ duration: 0.3 }}
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999
          }}
        >
          <Box
            sx={{
              width: 380,
              maxWidth: "92vw",
              px: 2.5,
              py: 2,
              borderRadius: "18px",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.45))",
              backdropFilter: "blur(18px) saturate(180%)",
              WebkitBackdropFilter: "blur(18px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.6)",
              boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
              color: "#1d1d1f"
            }}
          >
            <Typography
              sx={{
                fontSize: "13px",
                fontWeight: 700,
                mb: 0.5,
                letterSpacing: "0.03em",
                textTransform: "uppercase",
                color: "#2b5cff"
              }}
            >
              {featureName}
            </Typography>

            <Box sx={{ height: 1, background: "rgba(0,0,0,0.06)", mb: 1 }} />

            <Typography
              sx={{
                fontSize: "12.8px",
                lineHeight: 1.55,
                whiteSpace: "pre-line",
                maxHeight: expanded ? 220 : "none",
                overflowY: expanded ? "auto" : "hidden",
                pr: expanded ? 1 : 0
              }}
            >
              {expanded ? message : previewText}
            </Typography>

            {message.length > MAX_LENGTH && (
              <Typography
                onClick={() => setExpanded(v => !v)}
                sx={{
                  mt: 1,
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "#2b5cff",
                  userSelect: "none"
                }}
              >
                {expanded ? "Show less" : "Read more"}
              </Typography>
            )}

            <Typography
              onClick={handleClear}
              sx={{
                mt: 1,
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                color: "#ff4d4f",
                userSelect: "none"
              }}
            >
              Clear
            </Typography>
          </Box>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
