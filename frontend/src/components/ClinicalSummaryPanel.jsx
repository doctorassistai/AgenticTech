import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

import {
  Box,
  Typography,
  TextField,
  Button,
  Divider,
  Paper,
  Stack,
  Card,
  CardContent,
} from "@mui/material";
import {
  PictureAsPdf,
  Visibility,
  LocalHospital,
  Person,
  MedicalServices,
} from "@mui/icons-material";
import jsPDF from "jspdf";

export default function ClinicalSummaryPanel({
  hospitalName,
  hospitalAddress,
  hospitalContact,
  hospitalLogo,
  doctorName,
  doctorRegistration,
  doctorDepartment,
  patientName,
  patientId,
  data,
  onSave,
}) {
  const [form, setForm] = useState({
    chief_complaint: "",
    diagnoses: "",
    key_findings: "",
    treatment_plan_summary: "",
    follow_up_plan: "",
    prognosis_category: "",
    prognosis_severity: "",
    prognosis_trend: "",
  });
  
  const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "");

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const doctorId = queryParams.get("doctor_id");
  const patientIdFromUrl = queryParams.get("patient_id");

  const [doctorInfo, setDoctorInfo] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);

  const isReady = doctorInfo && patientInfo;
  useEffect(() => {
  if (!doctorId || !patientIdFromUrl) return;

  const controller = new AbortController();

  const fetchMetadata = async () => {
    try {
      const [doctorRes, patientRes] = await Promise.all([
        fetch(
          `${BASE_URL}hms/users/data/context/get-doctor-info?sys_user_id=${doctorId}`,
          { signal: controller.signal }
        ),
        fetch(
          `${BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patientIdFromUrl}`,
          { signal: controller.signal }
        ),
      ]);

      if (!doctorRes.ok) throw new Error("Doctor fetch failed");
      if (!patientRes.ok) throw new Error("Patient fetch failed");

      const doctorData = await doctorRes.json();
      const patientData = await patientRes.json();

      setDoctorInfo(doctorData?.data ?? doctorData);
      setPatientInfo(patientData?.data ?? patientData);

    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Metadata fetch error:", error);
      }
    }
  };

  fetchMetadata();

  return () => controller.abort();
}, [doctorId, patientIdFromUrl]);

  /* ================= BACKEND → FRONTEND ================= */
  useEffect(() => {
    if (!data) return;
    const summary = data?.clinical_summary || data;

    setForm({
      chief_complaint: summary?.chief_complaint || "",
      diagnoses: Array.isArray(summary?.diagnoses)
        ? summary.diagnoses.join(", ")
        : summary?.diagnoses || "",
      key_findings: summary?.key_findings_summary || "",
      treatment_plan_summary: summary?.treatment_plan_summary || "",
      follow_up_plan: summary?.follow_up_plan || "",
      prognosis_category: summary?.prognosis?.category || "",
      prognosis_severity: summary?.prognosis?.severity || "",
      prognosis_trend: summary?.prognosis?.trend_direction || "",
    });
  }, [data]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /* ================= CORPORATE PDF ================= */
  const generatePDF = (preview = false) => {
    const doc = new jsPDF("p", "mm", "a4");

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;

    let y = 20;

    /* -------- Page Break -------- */
    const checkPageBreak = (requiredHeight = 10) => {
      if (y + requiredHeight > pageHeight - 25) {
        doc.addPage();
        y = 20;
        drawHeader(false);
      }
    };

    /* -------- Header -------- */
    const drawHeader = (isFirstPage = true) => {
      doc.setDrawColor(0, 102, 153);
      doc.setLineWidth(0.8);

      if (hospitalLogo) {
        try {
          doc.addImage(hospitalLogo, "PNG", margin, 10, 22, 22);
        } catch (e) {
          // Prevent crash if logo format invalid
        }
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(0, 70, 140);

      const hospitalTitle = doctorInfo?.hospital_name || "Hospital Name";
      const hospitalTitleLines = doc.splitTextToSize(
        hospitalTitle,
        pageWidth - 80
      );
      doc.text(hospitalTitleLines, pageWidth / 2, 18, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(80);

      doc.line(margin, 36, pageWidth - margin, 36);

      y = 45;

      if (isFirstPage) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("CLINICAL SUMMARY REPORT", pageWidth / 2, y, {
          align: "center",
        });
        y += 12;
      }
    };

    drawHeader(true);

    /* -------- Info Box -------- */
    const drawInfoBox = () => {
      checkPageBreak(40);

      const boxHeight = 30;

      doc.setFillColor(245, 248, 250);
      doc.setDrawColor(210);
      doc.roundedRect(margin, y, contentWidth, boxHeight, 3, 3, "FD");

      let boxY = y + 8;

      const leftX = margin + 6;
      const rightX = pageWidth / 2 + 5;

      doc.setFontSize(10);
      doc.setTextColor(60);

      const safeText = (text, maxWidth) =>
        doc.splitTextToSize(text || "-", maxWidth);

      doc.setFont("helvetica", "bold");
      doc.text("Patient Name:", leftX, boxY);
      doc.setFont("helvetica", "normal");
      doc.text(
        safeText(patientInfo?.patient_name, 60),
        leftX + 32,
        boxY
      );

      doc.setFont("helvetica", "bold");
      doc.text("Patient ID:", rightX, boxY);
      doc.setFont("helvetica", "normal");
      doc.text(
        safeText(patientInfo?.hms_id, 50),
        rightX + 25,
        boxY
      );

      boxY += 8;

      doc.setFont("helvetica", "bold");
      doc.text("Doctor:", leftX, boxY);
      doc.setFont("helvetica", "normal");
      doc.text(
        safeText(doctorInfo?.name?.toUpperCase(), 60),
        leftX + 18,
        boxY
      );

      doc.setFont("helvetica", "bold");
      doc.text("Department:", rightX, boxY);
      doc.setFont("helvetica", "normal");
      doc.text(
        safeText(doctorInfo?.specialization?.toUpperCase(), 50),
        rightX + 28,
        boxY
      );

      boxY += 8;



      doc.setFont("helvetica", "bold");
      doc.text("Report Date:", rightX, boxY);
      doc.setFont("helvetica", "normal");
      doc.text(
        new Date().toLocaleDateString(),
        rightX + 25,
        boxY
      );

      y += boxHeight + 15;
    };

    drawInfoBox();

    /* -------- Section Template -------- */
    const addSection = (title, content) => {
      checkPageBreak(20);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0, 70, 140);
      doc.text(title.toUpperCase(), margin, y);

      y += 6;
      doc.setDrawColor(220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(30);

      const text = content?.trim() ? content : "-";
      const lines = doc.splitTextToSize(text, contentWidth);

      checkPageBreak(lines.length * 6 + 8);

      doc.text(lines, margin, y);
      y += lines.length * 6 + 12;
    };

    /* -------- Content -------- */

    addSection("Chief Complaint", form.chief_complaint);
    addSection("Diagnoses", form.diagnoses);
    addSection("Key Clinical Findings", form.key_findings);

    addSection(
      "Prognosis Assessment",
      `Category: ${form.prognosis_category || "-"}\n` +
        `Severity: ${form.prognosis_severity || "-"}\n` +
        `Trend Direction: ${form.prognosis_trend || "-"}`
    );

    addSection("Treatment Plan Summary", form.treatment_plan_summary);
    addSection("Follow-up Plan", form.follow_up_plan);

    /* -------- Signature -------- */
    checkPageBreak(30);

    y += 10;

    doc.line(pageWidth - 70, y, pageWidth - margin, y);
    y += 6;

    doc.setFontSize(10);
    doc.text(doctorInfo?.name || "-", pageWidth - 68, y);
    y += 5;
    doc.text("Authorized Medical Practitioner", pageWidth - 68, y);

    /* -------- Footer -------- */
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Confidential Medical Record | Page ${i} of ${pages}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: "center" }
      );
    }

    if (preview) {
      window.open(doc.output("bloburl"), "_blank");
    } else {
      doc.save(`Clinical_Summary_${patientInfo?.hms_id || "Patient"}_${Date.now()}.pdf`);

    }
  };

  /* ================= UI (UNCHANGED DESIGN) ================= */
  return (
    <Box
      sx={{
        maxWidth: 1100,
        mx: "auto",
        p: 4,
        background: "#f4f8fb",
        minHeight: "100vh",
      }}
    >
      <Card elevation={4} sx={{ mb: 4, borderRadius: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack direction="row" alignItems="center" spacing={2} mb={3}>
            <LocalHospital sx={{ fontSize: 40, color: "#1f4e79" }} />
            <Typography variant="h4" fontWeight="bold" color="#1f4e79">
              Clinical Summary Report
            </Typography>
          </Stack>

          <Stack direction="row" spacing={3}>
            <Button
              variant="contained"
              startIcon={<Visibility />}
              onClick={() => generatePDF(true)}
              sx={{ bgcolor: "#1f4e79" }}
            >
              Preview PDF
            </Button>

            <Button
              variant="outlined"
              startIcon={<PictureAsPdf />}
              onClick={() => generatePDF(false)}
              sx={{ borderColor: "#1f4e79", color: "#1f4e79" }}
            >
              Download PDF
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card elevation={3} sx={{ mb: 4, borderRadius: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" fontWeight="bold" color="#1f4e79" mb={3}>
            <Person /> Patient Information
          </Typography>

          <Stack spacing={3}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="caption">Patient ID</Typography>
              <Typography variant="h6">{patientId || "-"}</Typography>
            </Paper>


            <Paper sx={{ p: 3 }}>
              <Typography variant="caption">Report Date</Typography>
              <Typography variant="h6">
                {new Date().toLocaleDateString()}
              </Typography>
            </Paper>
          </Stack>
        </CardContent>
      </Card>

      <Card elevation={3} sx={{ borderRadius: 3 }}>
        <CardContent sx={{ p: 5 }}>
          <Stack spacing={4}>
            <TextField
              label="Chief Complaint"
              multiline
              rows={3}
              fullWidth
              value={form.chief_complaint}
              onChange={(e) =>
                handleChange("chief_complaint", e.target.value)
              }
            />

            <TextField
              label="Diagnoses"
              multiline
              rows={3}
              fullWidth
              value={form.diagnoses}
              onChange={(e) =>
                handleChange("diagnoses", e.target.value)
              }
            />

            <TextField
              label="Key Clinical Findings"
              multiline
              rows={4}
              fullWidth
              value={form.key_findings}
              onChange={(e) =>
                handleChange("key_findings", e.target.value)
              }
            />

            <Divider />

            <Typography variant="h6" fontWeight="bold">
              <MedicalServices /> Prognosis Assessment
            </Typography>

            <TextField
              label="Category"
              fullWidth
              value={form.prognosis_category}
              onChange={(e) =>
                handleChange("prognosis_category", e.target.value)
              }
            />

            <TextField
              label="Severity"
              fullWidth
              value={form.prognosis_severity}
              onChange={(e) =>
                handleChange("prognosis_severity", e.target.value)
              }
            />

            <TextField
              label="Trend Direction"
              fullWidth
              value={form.prognosis_trend}
              onChange={(e) =>
                handleChange("prognosis_trend", e.target.value)
              }
            />

            <TextField
              label="Treatment Plan Summary"
              multiline
              rows={4}
              fullWidth
              value={form.treatment_plan_summary}
              onChange={(e) =>
                handleChange("treatment_plan_summary", e.target.value)
              }
            />

            <TextField
              label="Follow-up Plan"
              multiline
              rows={3}
              fullWidth
              value={form.follow_up_plan}
              onChange={(e) =>
                handleChange("follow_up_plan", e.target.value)
              }
            />
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
