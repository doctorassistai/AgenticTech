import React, { useState, useEffect } from "react";
import { Box, Typography, Accordion, AccordionSummary, AccordionDetails, CircularProgress, Chip } from "@mui/material";
import { ExpandMoreRounded } from "@mui/icons-material";
import { C, FONT } from "./shared/designTokens";
import { request, CONTEXT_BASE } from "./shared/api";
import { CompletedInvestigationsTable } from "./LabInvestigations";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const getInvestigations = (patientId, doctorId) => request(`${CONTEXT_BASE}/oncology-investigations/${patientId}?doctor_id=${doctorId || ""}`);
const getCompletedInvestigationDocuments = (patientId, doctorId) => request(`${CONTEXT_BASE}/oncology-investigations/all-completed-documents`, {
  method: "POST",
  body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId || "" })
});


const DoctorNameResolver = ({ doctorId, fallback }) => {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(!!doctorId);

  useEffect(() => {
    if (!doctorId) {
      setLoading(false);
      return;
    }
    const fetchDoc = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
        if (res.ok) {
          const json = await res.json();
          const docData = json?.data || json?.doctor || json;
          const resolvedName = docData?.name || docData?.doctor_name || `${docData?.first_name || ""} ${docData?.last_name || ""}`.trim();
          if (resolvedName && resolvedName.trim() !== "") {
            setName(resolvedName);
          }
        }
      } catch (err) {
        console.error("Failed to fetch doctor name", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDoc();
  }, [doctorId]);

  if (loading) return <Typography component="span" sx={{ fontSize: 12.5, fontStyle: "italic", color: C.textMuted || "#888" }}>Loading...</Typography>;
  return name || fallback;
};

const recordTh = {
  fontFamily: FONT, fontSize: 11, fontWeight: 600, padding: '10px 14px',
  border: `1px solid ${C.border || "#e0e0e0"}`, background: C.bgSecondary || '#fafafa', textAlign: 'left', textTransform: 'uppercase', width: '25%', color: C.textSecond || "#444"
};
const recordTd = {
  fontFamily: FONT, fontSize: 13, fontWeight: 400, padding: '10px 14px',
  border: `1px solid ${C.border || "#e0e0e0"}`, color: C.textPrimary || "#000", width: '25%', verticalAlign: 'top', wordBreak: 'break-word', lineHeight: 1.5
};

const SectionTable = ({ title, data }) => {
  if (!data || data.length === 0) return null;
  const rows = [];
  for (let i = 0; i < data.length; i += 2) {
    rows.push([data[i], data[i + 1]]);
  }
  
  return (
    <Box sx={{ mb: 3 }}>
      {title && (
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5, fontFamily: FONT, color: C.black || "#000", borderBottom: `2px solid ${C.border || "#e0e0e0"}`, pb: 0.5 }}>
          {title}
        </Typography>
      )}
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", background: C.white || "#fff", border: `1px solid ${C.border || "#e0e0e0"}` }}>
        <Box component="tbody">
          {rows.map((row, idx) => (
            <Box component="tr" key={idx} sx={{ borderBottom: `1px solid ${C.border || "#e0e0e0"}` }}>
              <Box component="th" sx={{ ...recordTh }}>{row[0].label}</Box>
              <Box component="td" sx={{ ...recordTd }}>
                {row[0].isDoctor && String(row[0].value).startsWith("DOC-") ? (
                  <DoctorNameResolver doctorId={row[0].value} fallback={row[0].value} />
                ) : (
                  row[0].value || "—"
                )}
              </Box>
              {row[1] ? (
                <>
                  <Box component="th" sx={{ ...recordTh }}>{row[1].label}</Box>
                  <Box component="td" sx={{ ...recordTd }}>
                    {row[1].isDoctor && String(row[1].value).startsWith("DOC-") ? (
                      <DoctorNameResolver doctorId={row[1].value} fallback={row[1].value} />
                    ) : (
                      row[1].value || "—"
                    )}
                  </Box>
                </>
              ) : (
                <>
                  <Box component="th" sx={{ ...recordTh, background: "transparent" }}></Box>
                  <Box component="td" sx={{ ...recordTd, borderLeft: 'none' }}></Box>
                </>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

const FullWidthTable = ({ title, data }) => {
  if (!data || data.length === 0) return null;
  return (
    <Box sx={{ mb: 3 }}>
      {title && (
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5, fontFamily: FONT, color: C.black || "#000", borderBottom: `2px solid ${C.border || "#e0e0e0"}`, pb: 0.5 }}>
          {title}
        </Typography>
      )}
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", background: C.white || "#fff", border: `1px solid ${C.border || "#e0e0e0"}` }}>
        <Box component="tbody">
          {data.map((row, idx) => (
            <Box component="tr" key={idx} sx={{ borderBottom: `1px solid ${C.border || "#e0e0e0"}` }}>
              <Box component="th" sx={{ ...recordTh, width: '20%' }}>{row.label}</Box>
              <Box component="td" sx={{ ...recordTd, width: '80%' }}>
                {row.value}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

const LabsTable = ({ labs }) => {
  if (!labs || labs.length === 0) return null;
  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5, fontFamily: FONT, color: C.black || "#000", borderBottom: `2px solid ${C.border || "#e0e0e0"}`, pb: 0.5 }}>
        Pre-Op Labs
      </Typography>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", background: C.white || "#fff", border: `1px solid ${C.border || "#e0e0e0"}` }}>
        <Box component="thead">
          <Box component="tr">
            {["Test", "Category", "Result", "Reference"].map(h => <Box component="th" key={h} sx={{ ...recordTh, width: "auto" }}>{h}</Box>)}
          </Box>
        </Box>
        <Box component="tbody">
          {labs.map((l, i) => (
             <Box component="tr" key={i} sx={{ borderBottom: `1px solid ${C.border || "#e0e0e0"}` }}>
                <Box component="td" sx={{ ...recordTd, width: "auto", fontWeight: 500 }}>{l.label}</Box>
                <Box component="td" sx={{ ...recordTd, width: "auto", color: C.textMuted || "#888" }}>{l.category}</Box>
                <Box component="td" sx={{ ...recordTd, width: "auto", fontWeight: 600, color: C.black || "#000" }}>{l.surgeryValue} <Typography component="span" sx={{ fontSize: 11, color: C.textMuted || "#888" }}>{l.unit}</Typography></Box>
                <Box component="td" sx={{ ...recordTd, width: "auto", color: C.textMuted || "#888" }}>{l.range}</Box>
             </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

const NarrationBox = ({ narration }) => {
  if (!narration || (!narration.synopticText && !narration.narrationText)) return null;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Accordion sx={{ background: "#fff", border: `1px solid ${C.border || "#e0e0e0"}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, background: C.bgSecondary || "#fafafa", borderBottom: `1px solid ${C.border || "#e0e0e0"}`, '& .MuiAccordionSummary-content': { my: 1 } }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: C.textPrimary || "#000", textTransform: 'uppercase' }}>
            Operative Note & Synopsis
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 3 }}>
           {narration.synopticText && (
             <Box sx={{ mb: 3, p: 2, background: C.bgTertiary || "#f5f5f5", borderRadius: 1, border: `1px solid ${C.border || "#e0e0e0"}` }}>
               <Typography sx={{ fontWeight: 600, fontSize: 11, mb: 1, textTransform: "uppercase", color: C.textSecond || "#444", letterSpacing: "0.05em" }}>Synoptic Summary</Typography>
               <Typography sx={{ fontSize: 13, fontFamily: FONT, whiteSpace: "pre-wrap", color: C.textPrimary || "#000" }}>{narration.synopticText}</Typography>
             </Box>
           )}
           {narration.narrationText && (
             <Box>
               <Typography sx={{ fontWeight: 600, fontSize: 11, mb: 1, textTransform: "uppercase", color: C.textSecond || "#444", letterSpacing: "0.05em" }}>Full Narration</Typography>
               <Typography sx={{ fontSize: 14, fontFamily: FONT, whiteSpace: "pre-wrap", color: C.textPrimary || "#000", lineHeight: 1.6 }}>{narration.narrationText}</Typography>
             </Box>
           )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

const processBooking = (item) => {
  // Use `fullBooking` and `checklist` per the actual API response
  const b = item.fullBooking || item.booking || item;
  const dn = item.checklist || item.doctors_note || item;
  
  const procedureName = b.procedureName || item.procedure || "Surgery";
  const surgeryDate = b.surgeryDate || item.date || "Unscheduled";
  const caseStatus = b.caseStatus || b.case_status;
  const bookingStatus = b.bookingStatus || b.booking_status;
  const surgeryType = b.surgeryType || b.surgery_type;
  const otRoom = b.otRoom || item.otRoom || b.ot_room;
  const treatingDoctor = b.treatingDoctor || b.treating_doctor;
  const surgeonName = b.surgeonName || item.surgeon || b.surgeon_name;
  const status = item.status || bookingStatus;
  
  const generalDetails = [
    { label: "Procedure Name", value: procedureName },
    { label: "Surgery Date", value: surgeryDate },
    { label: "Case Status", value: caseStatus },
    { label: "Booking Status", value: bookingStatus },
    { label: "Surgery Type", value: Array.isArray(surgeryType) ? surgeryType.join(", ") : surgeryType },
    { label: "Approach", value: Array.isArray(b.approach) ? b.approach.join(", ") : b.approach },
    { label: "Duration", value: b.duration },
    { label: "OT Room", value: otRoom },
    { label: "Treating Doctor", value: treatingDoctor },
    { label: "Surgeon", value: surgeonName, isDoctor: String(surgeonName).startsWith("DOC-") },
  ].filter(x => x.value && String(x.value).length > 0);

  const preOpDiagnosis = b.preOpDiagnosis || b.pre_op_diagnosis;
  const asaClass = b.asaClass || b.asa_class || (dn.asaStatus || dn.asa_status ? (dn.asaStatus || dn.asa_status).join(", ") : "");
  const bloodGroup = b.bloodGroup || b.blood_group;
  const highRiskMDT = b.highRiskMDT || b.high_risk_mdt;
  const insuranceType = b.insuranceType || b.insurance_type;
  const hasInsurance = b.insurance === "Yes" || b.insurance === true;

  const clinicalDetails = [
    { label: "Pre-Op Diagnosis", value: preOpDiagnosis },
    { label: "Laterality", value: b.laterality },
    { label: "ASA Class", value: asaClass },
    { label: "Blood Group", value: bloodGroup },
    { label: "High Risk MDT", value: highRiskMDT },
    { label: "Insurance", value: hasInsurance ? (Array.isArray(insuranceType) ? insuranceType.join(", ") : insuranceType) : "No" },
  ].filter(x => x.value && String(x.value).length > 0);

  const mdtRemarks = [
    { label: "MDT Comments", value: b.mdtComments || b.mdt_comments },
    { label: "Surgical Remarks", value: b.remarks },
  ].filter(x => x.value && String(x.value).length > 0);

  const aspirationRisk = dn.aspirationRisk || dn.aspiration_risk;
  const bloodConfirmed = dn.bloodConfirmed || dn.blood_confirmed;
  const premedicationDetails = dn.premedicationDetails || dn.premedication_details;

  const operationDetails = (dn.surgery || dn.consciousness || dn.bp) ? [
    { label: "Performed Surgery", value: dn.surgery },
    { label: "Consciousness", value: dn.consciousness },
    { label: "Aspiration Risk", value: aspirationRisk },
    { label: "Blood Confirmed", value: bloodConfirmed },
    { label: "Vitals (BP/PR/RR/SpO2)", value: (dn.bp || dn.pr || dn.rr || dn.spo2) ? `${dn.bp || '-'} / ${dn.pr || '-'} / ${dn.rr || '-'} / ${dn.spo2 || '-'}%` : "" },
    { label: "Temperature", value: dn.temperature ? `${dn.temperature}°C` : "" },
    { label: "Premedication", value: Array.isArray(dn.premedication) ? dn.premedication.join(", ") : dn.premedication },
    { label: "Premedication Details", value: premedicationDetails },
  ].filter(x => x.value && String(x.value).trim().length > 0 && x.value !== " /  /  / %") : [];

  const labOrder = dn.labOrder || dn.lab_order;
  const labs = labOrder?.fields?.filter(f => f.surgeryValue || f.surgery_value) || [];

  return { 
    id: item._id || item.booking_id || item.id || Math.random().toString(),
    generalDetails, 
    clinicalDetails, 
    mdtRemarks, 
    operationDetails, 
    labs, 
    narration: dn.narration || item.discharge?.courseInHospital, // Use discharge course as fallback narration
    status: status, 
    date: surgeryDate, 
    proc: procedureName
  };
};

const SurgeryOverview = ({ patientId }) => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [investigations, setInvestigations] = useState([]);
  const [doctorNamesMap, setDoctorNamesMap] = useState({});

  useEffect(() => {
    if (!patientId) return;
    
    // Fetch Lab Investigations and Completed Documents
    Promise.all([
      getInvestigations(patientId, ""),
      getCompletedInvestigationDocuments(patientId, "")
    ])
      .then(([invRes, docRes]) => {
        const history = invRes?.data || [];
        const docs = docRes?.data || [];
        
        const historyMapByDocId = history.reduce((acc, inv) => {
          if (inv.document_id != null) acc[inv.document_id] = inv;
          return acc;
        }, {});
        const historyMapById = history.reduce((acc, inv) => {
          if (inv.id !== undefined) acc[inv.id] = inv;
          return acc;
        }, {});

        const completed = docs.map(doc => {
          const match = historyMapById[doc.id] || historyMapByDocId[doc.document_id] || {};
          return {
            ...doc,
            id: doc.id !== undefined ? doc.id : match.id,
            order_context: doc.order_context || match.order_context
          };
        }).sort((a, b) => new Date(b.date_of_order || 0) - new Date(a.date_of_order || 0));

        setInvestigations(completed);

        const doctorIds = [...new Set(completed.map(inv => inv.doctor_id).filter(Boolean))];
        if (doctorIds.length > 0) {
          Promise.all(
            doctorIds.map(async (id) => {
              try {
                const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${id}`);
                if (res.ok) {
                  const json = await res.json();
                  const docData = json?.data || json?.doctor || json;
                  const resolvedName = docData?.name || docData?.doctor_name || `${docData?.first_name || ""} ${docData?.last_name || ""}`.trim();
                  if (resolvedName && resolvedName.trim() !== "") {
                    return { id, name: resolvedName };
                  }
                }
              } catch (e) {
                console.error("Failed to fetch doctor name for", id, e);
              }
              return { id, name: id };
            })
          ).then(results => {
            const map = {};
            results.forEach(r => map[r.id] = r.name);
            setDoctorNamesMap(map);
          });
        }
      })
      .catch(err => console.error("Failed to load investigations:", err));

    const loadSurgeryBookings = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const url = `${API_BASE_URL}hms/users/data/surgical-oncology/patient/${patientId}/bookings`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          let dataArray = [];
          if (Array.isArray(json)) {
            dataArray = json;
          } else if (json.data && Array.isArray(json.data)) {
            dataArray = json.data;
          } else if (json.bookings && Array.isArray(json.bookings)) {
            dataArray = json.bookings;
          }
          console.log("SURGERY API FETCH SUCCESS - Raw:", json, "Parsed Array:", dataArray);
          setBookings(dataArray.map(processBooking));
        } else {
          const errText = await res.text();
          console.error("SURGERY API FETCH FAILED:", res.status, res.statusText, errText);
          setErrorMsg(`API returned ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.error("Failed to load surgery bookings:", err);
        setErrorMsg(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadSurgeryBookings();
  }, [patientId]);

  const renderInvestigations = () => (
    <Box sx={{ p: 3, background: C.white || "#fff", border: `1px solid ${C.border || "#e0e0e0"}`, borderRadius: 1, mt: 2.5 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1.5, fontFamily: FONT, textTransform: 'uppercase', color: C.textPrimary || "#000" }}>
        Completed Investigations (Surgery)
      </Typography>
      <CompletedInvestigationsTable completedInvestigations={investigations} doctorNamesMap={doctorNamesMap} />
    </Box>
  );

  if (loading) {
    return (
      <Box sx={{ border: `1px solid ${C.border || "#e0e0e0"}`, mb: 2.5, p: 4, display: 'flex', justifyContent: 'center', background: C.white || "#fff" }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (errorMsg) {
    return (
      <Box sx={{ mb: 3 }}>
        <Accordion defaultExpanded={false} sx={{ border: `1px solid ${C.border || "#e0e0e0"}`, mb: 2.5, boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 2.5, py: 0, minHeight: 40, background: C.bgSecondary || "#fafafa", borderBottom: `1px solid ${C.border || "#e0e0e0"}`, '& .MuiAccordionSummary-content': { my: 1.25 } }}>
            <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: "#d32f2f", fontFamily: FONT, fontWeight: 700 }}>Surgery Details (Error)</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 2.5, background: C.white || "#fff" }}>
            <Typography sx={{ fontSize: 12.5, color: "#d32f2f", padding: "16px", background: "#fdeded", borderRadius: 1, border: `1px solid #f8c2c2` }}>
              {errorMsg}
            </Typography>
            {renderInvestigations()}
          </AccordionDetails>
        </Accordion>
      </Box>
    );
  }

  if (bookings.length === 0) {
    return (
      <Box sx={{ mb: 3 }}>
        <Accordion defaultExpanded={false} sx={{ border: `1px solid ${C.border || "#e0e0e0"}`, mb: 2.5, boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 2.5, py: 0, minHeight: 40, background: C.bgSecondary || "#fafafa", borderBottom: `1px solid ${C.border || "#e0e0e0"}`, '& .MuiAccordionSummary-content': { my: 1.25 } }}>
            <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textPrimary || "#000", fontFamily: FONT, fontWeight: 500 }}>Surgery Details</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 2.5, background: C.white || "#fff" }}>
            <Typography sx={{ fontSize: 12.5, color: C.textMuted || "#888", fontStyle: "italic", padding: "16px", background: C.bgSecondary || "#fafafa", borderRadius: 1, border: `1px solid ${C.border || "#e0e0e0"}` }}>
              No surgery records found for this patient.
            </Typography>
            {renderInvestigations()}
          </AccordionDetails>
        </Accordion>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Accordion defaultExpanded={false} sx={{ border: `1px solid ${C.border || "#e0e0e0"}`, mb: 2.5, boxShadow: 'none', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 2.5, py: 0, minHeight: 40, background: C.bgSecondary || "#fafafa", borderBottom: `1px solid ${C.border || "#e0e0e0"}`, '& .MuiAccordionSummary-content': { my: 1.25 } }}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textPrimary || "#000", fontFamily: FONT, fontWeight: 500 }}>
            Surgery Details
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 2, background: C.bgSecondary || "#fafafa" }}>
          {bookings.map((b, index) => (
            <Accordion key={b.id} defaultExpanded={index === 0} sx={{ border: `1px solid ${C.border || "#e0e0e0"}`, mb: index === bookings.length - 1 ? 0 : 2, boxShadow: 'none', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 2.5, py: 0, minHeight: 48, background: C.white || "#fff", borderBottom: `1px solid ${C.border || "#e0e0e0"}`, '& .MuiAccordionSummary-content': { my: 1.25, display: 'flex', alignItems: 'center', gap: 2 } }}>
                <Typography sx={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textPrimary || "#000", fontFamily: FONT, fontWeight: 500 }}>
                  {b.date} — {b.proc}
                </Typography>
                {b.status && (
                  <Chip label={b.status} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }} />
                )}
              </AccordionSummary>
              <AccordionDetails sx={{ p: 3, background: C.white || "#fff" }}>
                <SectionTable title="Booking Details" data={b.generalDetails} />
                <SectionTable title="Clinical Assessment" data={b.clinicalDetails} />
                <FullWidthTable title="MDT & Planning" data={b.mdtRemarks} />
                
                {b.operationDetails.length > 0 && (
                  <SectionTable title="Operation Note Details" data={b.operationDetails} />
                )}
                <LabsTable labs={b.labs} />
                <NarrationBox narration={b.narration} />
              </AccordionDetails>
            </Accordion>
          ))}
          {renderInvestigations()}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default SurgeryOverview;
