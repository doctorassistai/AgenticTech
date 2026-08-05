import React, { useState, useEffect } from "react";
import {
  Box, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  TextField, Select, MenuItem, FormControl, Button
} from "@mui/material";
import { AddRounded, SaveRounded } from "@mui/icons-material";
const FONT = '"Open Sans", sans-serif';
const C = {
  black: "#000000",
  white: "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary: "#f5f5f5",
  textPrimary: "#000000",
  textSecond: "#444444",
  border: "#e0e0e0",
};

const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: 300,
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.black },
    "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: 1 },
  },
  "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 13 },
};

const saveBtnSx = {
  px: 3, py: 0.9, background: C.black, color: C.white,
  fontFamily: FONT, fontWeight: 400, fontSize: 12,
  textTransform: "none", borderRadius: 0,
  "&:hover": { background: "#1a1a1a" },
};

const outlineBtnSx = {
  px: 3, py: 0.9, background: C.white, color: C.black,
  border: `1px solid ${C.black}`, fontFamily: FONT, fontWeight: 400,
  fontSize: 12, textTransform: "none", borderRadius: 0,
  "&:hover": { background: C.bgTertiary },
};

const thSx = {
  fontFamily: FONT, fontSize: 11, fontWeight: 400,
  textTransform: "uppercase", letterSpacing: "0.08em",
  py: 1, px: 1.5, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`,
};

const tdSx = {
  fontFamily: FONT, fontSize: 12, fontWeight: 300, py: 1.25, px: 1.5,
};

const sectionHeaderSx = {
  px: 2.5, py: 1.25, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`,
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em",
  color: C.textPrimary, fontFamily: FONT, fontWeight: 400,
};

const SectionBox = ({ title, children, style = {} }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2.5, ...style }}>
    <Box sx={sectionHeaderSx}>{title}</Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

const saveDoctorLogs = async (doctorId, data) => {
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
  const url = `${API_BASE_URL}hms/users/data/context/doctor-logs`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doctor_id: doctorId, data })
  });
  if (!res.ok) {
    throw new Error("Failed to save log book");
  }
  return res.json();
};

const getDoctorLogs = async (doctorId) => {
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
  const url = `${API_BASE_URL}hms/users/data/context/doctor-logs/${doctorId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch log book");
  }
  return res.json();
};

const EMPTY_LOG = { date: "", patientName: "", age: "", sex: "M", patientId: "", diagnosis: "", procedure: "", unitName: "", surgeon: "", status: "Primary", nature: "Major" };

const DoctorLogBook = ({ doctorId, initialData }) => {
  const [entries, setEntries] = useState(() => {
    if (initialData && Array.isArray(initialData)) return initialData;
    if (initialData && Array.isArray(initialData.entries)) return initialData.entries;
    return [{ ...EMPTY_LOG }];
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (doctorId) {
      setLoading(true);
      getDoctorLogs(doctorId)
        .then(res => {
          if (res.data && res.data["log-book"] && Array.isArray(res.data["log-book"].entries)) {
            setEntries(res.data["log-book"].entries);
          }
        })
        .catch(err => console.error("Error fetching logs:", err))
        .finally(() => setLoading(false));
    }
  }, [doctorId]);

  const addRow = () => setEntries(p => [...p, { ...EMPTY_LOG }]);
  const se = (i, k, v) => setEntries(p => { const a = [...p]; a[i] = { ...a[i], [k]: v }; return a; });

  const handleSave = async () => {
    if (doctorId) {
      try {
        await saveDoctorLogs(doctorId, { entries });
        alert("Log Book saved successfully");
      } catch(e) {
        console.error(e);
        alert("Error saving log book");
      }
    } else {
      console.log("Log Book data:", { entries });
      alert("Doctor ID not provided.");
    }
  };

  return (
    <Box sx={{ padding: "2rem", background: "#fff", flex: 1, minHeight: "100vh" }}>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 300, marginBottom: "1.5rem" }}>Surgeon Log Book {loading && <span style={{fontSize: "0.8rem", color: "#888"}}>(Loading...)</span>}</h2>
      <SectionBox title="Log Book Entries">
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 1100 }}>
            <TableHead>
              <TableRow>
                {["SNo", "Date", "Patient Name", "Age", "Sex", "Patient ID", "Diagnosis", "Procedure", "Unit", "Surgeon", "Status", "Nature"].map(h => (
                  <TableCell key={h} sx={thSx}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((row, i) => (
                <TableRow key={i}>
                  <TableCell sx={tdSx}>{i + 1}</TableCell>
                  <TableCell sx={tdSx}>
                    <TextField type="date" size="small" value={row.date} onChange={e => se(i, "date", e.target.value)} sx={{ ...inputSx, width: 130 }} InputLabelProps={{ shrink: true }} />
                  </TableCell>
                  <TableCell sx={tdSx}><TextField size="small" value={row.patientName} onChange={e => se(i, "patientName", e.target.value)} sx={{ ...inputSx, width: 120 }} /></TableCell>
                  <TableCell sx={tdSx}><TextField type="number" size="small" value={row.age} onChange={e => se(i, "age", e.target.value)} sx={{ ...inputSx, width: 60 }} /></TableCell>
                  <TableCell sx={tdSx}>
                    <FormControl size="small" sx={{ ...inputSx, width: 70 }}>
                      <Select value={row.sex} onChange={e => se(i, "sex", e.target.value)}>
                        {["M", "F", "O"].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell sx={tdSx}><TextField size="small" value={row.patientId} onChange={e => se(i, "patientId", e.target.value)} sx={{ ...inputSx, width: 110 }} /></TableCell>
                  <TableCell sx={tdSx}><TextField size="small" value={row.diagnosis} onChange={e => se(i, "diagnosis", e.target.value)} sx={{ ...inputSx, width: 130 }} /></TableCell>
                  <TableCell sx={tdSx}><TextField size="small" value={row.procedure} onChange={e => se(i, "procedure", e.target.value)} sx={{ ...inputSx, width: 130 }} /></TableCell>
                  <TableCell sx={tdSx}><TextField size="small" value={row.unitName} onChange={e => se(i, "unitName", e.target.value)} sx={{ ...inputSx, width: 100 }} /></TableCell>
                  <TableCell sx={tdSx}><TextField size="small" value={row.surgeon} onChange={e => se(i, "surgeon", e.target.value)} sx={{ ...inputSx, width: 110 }} /></TableCell>
                  <TableCell sx={tdSx}>
                    <FormControl size="small" sx={{ ...inputSx, width: 130 }}>
                      <Select value={row.status} onChange={e => se(i, "status", e.target.value)}>
                        {["Primary", "Assistant", "Supervised", "Observed"].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell sx={tdSx}>
                    <FormControl size="small" sx={{ ...inputSx, width: 120 }}>
                      <Select value={row.nature} onChange={e => se(i, "nature", e.target.value)}>
                        {["Major", "Minor", "Emergency", "Elective"].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Button sx={{ ...outlineBtnSx, mt: 1.5 }} onClick={addRow}><AddRounded sx={{ mr: 0.5, fontSize: 14 }} />Add Entry</Button>
      </SectionBox>
      <Button sx={saveBtnSx} onClick={handleSave}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Log Book</Button>
    </Box>
  );
};

export default DoctorLogBook;
