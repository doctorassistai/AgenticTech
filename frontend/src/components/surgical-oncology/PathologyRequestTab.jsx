import React, { useEffect, useState } from "react";
import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { AddRounded, DeleteRounded, SaveRounded, ScienceRounded } from "@mui/icons-material";

import { C, FONT, FW_BOLD, inputSx, outlineBtnSx, saveBtnSx } from "./shared/designTokens";
import { CbxGroup, FG, ROInput, SectionBox, Sel } from "./shared/FormComponents";
import { createPathologyRequest, getSourcePathologyRequests, saveSection } from "./shared/api";

const PATHOLOGY_TESTS = ["Histology", "IHC", "Molecular", "FISH / ISH", "Frozen Section", "Cytology", "Other"];

const makePathologySpecimen = (defaults = {}) => ({
  source_item_id: globalThis.crypto?.randomUUID?.() || `specimen-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  specimen_description: "",
  anatomical_site: "",
  laterality: "",
  collection_datetime: "",
  specimen_label: "",
  container_details: "",
  notes: "",
  priority: "Routine",
  requested_tests: ["Histology"],
  other_test: "",
  request_refs: [],
  ...defaults,
});

const PathologyRequestTab = ({ patientId, doctorId, doctorName, currentBookingId, bookingData }) => {
  const booking = bookingData?.booking || {};
  const management = bookingData?.management || {};
  const savedSpecimens = bookingData?.pathology_handoffs?.specimens;
  const [specimens, setSpecimens] = useState(() => (
    Array.isArray(savedSpecimens) && savedSpecimens.length > 0
      ? savedSpecimens.map(item => makePathologySpecimen(item))
      : [makePathologySpecimen({
          specimen_description: management.materialsForwarded || "",
          anatomical_site: management.anatomicalSite || "",
        })]
  ));
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [savingItemId, setSavingItemId] = useState("");
  const [message, setMessage] = useState({ severity: "success", text: "" });

  const procedure = management.nameOfProcedure
    || management.otherNameOfProcedure
    || (management.typeOfSurgery || []).join(", ")
    || booking.procedureName
    || "";
  const patientName = booking.patientName || "";
  const referringDepartment = booking.unitName || "Surgical Oncology";

  const loadRequests = async () => {
    if (!currentBookingId) return;
    setLoadingRequests(true);
    try {
      const result = await getSourcePathologyRequests("ot_booking", currentBookingId);
      setRequests(result.requests || []);
    } catch (err) {
      console.error("[PathologyRequestTab] request history fetch:", err);
      setMessage({ severity: "error", text: "Unable to load pathology request statuses." });
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => { loadRequests(); }, [currentBookingId]);

  const requestsFor = (sourceItemId) => requests
    .filter(request => request.source_item_id === sourceItemId)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const updateSpecimen = (sourceItemId, key, value) => {
    setSpecimens(current => current.map(item => item.source_item_id === sourceItemId ? { ...item, [key]: value } : item));
  };

  const persistSpecimens = async (nextSpecimens) => {
    await saveSection(currentBookingId, "pathology_handoffs", { specimens: nextSpecimens });
  };

  const saveDrafts = async () => {
    setSavingItemId("all");
    setMessage({ severity: "success", text: "" });
    try {
      await persistSpecimens(specimens);
      setMessage({ severity: "success", text: "Pathology specimen drafts saved." });
    } catch (err) {
      console.error("[PathologyRequestTab] draft save:", err);
      setMessage({ severity: "error", text: "Unable to save pathology specimen drafts." });
    } finally {
      setSavingItemId("");
    }
  };

  const sendRequest = async (specimen) => {
    const itemRequests = requestsFor(specimen.source_item_id);
    const latestRequest = itemRequests[itemRequests.length - 1];
    if (["pending", "accepted", "completed"].includes(latestRequest?.status)) return;
    if (!specimen.specimen_description.trim() || !specimen.anatomical_site.trim() || !specimen.collection_datetime || !procedure.trim()) {
      setMessage({ severity: "error", text: "Specimen description, anatomical site, collection date/time, and procedure are required." });
      return;
    }
    if (!Array.isArray(specimen.requested_tests) || specimen.requested_tests.length === 0) {
      setMessage({ severity: "error", text: "Select at least one requested pathology test." });
      return;
    }
    if (specimen.requested_tests.includes("Other") && !specimen.other_test.trim()) {
      setMessage({ severity: "error", text: "Describe the requested Other test before sending." });
      return;
    }

    setSavingItemId(specimen.source_item_id);
    setMessage({ severity: "success", text: "" });
    try {
      await persistSpecimens(specimens);
      const result = await createPathologyRequest({
        patient_id: patientId,
        patient_name: patientName,
        requester_doctor_id: doctorId,
        requester_doctor_name: doctorName || booking.treatingDoctor || "",
        source_specialization: "Surgical Oncology",
        source_module: "OTRecord.PathologyRequest",
        referring_department: referringDepartment,
        request_type: "Surgical specimen",
        details: {
          procedure,
          surgery_date: booking.surgeryDate || "",
          preoperative_diagnosis: management.preOperativeDiagnosis || booking.preOpDiagnosis || "",
          postoperative_diagnosis: management.postOperativeDiagnosis || "",
          operative_findings: management.findings || "",
          specimen: {
            description: specimen.specimen_description,
            anatomical_site: specimen.anatomical_site,
            laterality: specimen.laterality,
            collection_datetime: specimen.collection_datetime,
            specimen_label: specimen.specimen_label,
            container_details: specimen.container_details,
            notes: specimen.notes,
            other_requested_test: specimen.other_test,
          },
        },
        reason: "other",
        reason_other: "Post-operative surgical specimen examination",
        suspected_primary_site: specimen.anatomical_site,
        requested_tests: specimen.requested_tests,
        summary: [management.postOperativeDiagnosis || booking.preOpDiagnosis, specimen.notes].filter(Boolean).join(". "),
        priority: specimen.priority,
        source_record_type: "ot_booking",
        source_record_id: currentBookingId,
        source_item_id: specimen.source_item_id,
        replacement_for_request_id: latestRequest?.status === "declined" ? latestRequest.request_id : null,
        provenance: {
          source: "surgical_oncology_ot_record",
          submitted_from: "pathology_request_tab",
        },
      });
      const created = result.request;
      const sentAt = created?.created_at || new Date().toISOString();
      const nextSpecimens = specimens.map(item => item.source_item_id === specimen.source_item_id
        ? {
            ...item,
            request_refs: [
              ...(item.request_refs || []),
              {
                request_id: created.request_id,
                status_at_send: created.status,
                sent_at: sentAt,
                replacement_for_request_id: created.replacement_for_request_id || "",
              },
            ],
          }
        : item);
      setSpecimens(nextSpecimens);
      setRequests(current => [...current, created]);
      await persistSpecimens(nextSpecimens);
      setMessage({ severity: "success", text: latestRequest ? "Replacement pathology request sent." : "Pathology request sent." });
    } catch (err) {
      console.error("[PathologyRequestTab] request send:", err);
      setMessage({ severity: "error", text: err.message || "Unable to send pathology request." });
      await loadRequests();
    } finally {
      setSavingItemId("");
    }
  };

  return (
    <Box>
      {message.text && <Alert severity={message.severity} sx={{ mb: 2, fontFamily: FONT }}>{message.text}</Alert>}
      <SectionBox title="Surgical Context">
        <FG cols={3}>
          <ROInput label="Patient" value={patientName || patientId} />
          <ROInput label="Procedure" value={procedure} />
          <ROInput label="Surgery Date" value={booking.surgeryDate} />
          <ROInput label="Surgeon" value={doctorName || booking.treatingDoctor || booking.surgeonName} />
          <ROInput label="Post-Operative Diagnosis" value={management.postOperativeDiagnosis || booking.preOpDiagnosis} />
          <ROInput label="Source Booking" value={currentBookingId} />
        </FG>
      </SectionBox>

      {specimens.map((specimen, index) => {
        const itemRequests = requestsFor(specimen.source_item_id);
        const latestRequest = itemRequests[itemRequests.length - 1];
        const unresolved = ["pending", "accepted"].includes(latestRequest?.status);
        const completed = latestRequest?.status === "completed";
        const requestClosed = unresolved || completed;
        const canRemove = itemRequests.length === 0 && !(specimen.request_refs || []).length;
        return (
          <SectionBox key={specimen.source_item_id} title={`Specimen ${index + 1}`}>
            <FG cols={3}>
              <TextField label="Specimen Description *" value={specimen.specimen_description} size="small" onChange={e => updateSpecimen(specimen.source_item_id, "specimen_description", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Anatomical Site *" value={specimen.anatomical_site} size="small" onChange={e => updateSpecimen(specimen.source_item_id, "anatomical_site", e.target.value)} sx={inputSx} fullWidth />
              <Sel label="Laterality" value={specimen.laterality} onChange={value => updateSpecimen(specimen.source_item_id, "laterality", value)} options={["Left", "Right", "Bilateral", "Midline", "Not applicable"]} />
              <TextField label="Collection Date / Time *" type="datetime-local" value={specimen.collection_datetime} size="small" onChange={e => updateSpecimen(specimen.source_item_id, "collection_datetime", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
              <TextField label="Specimen / Container Label" value={specimen.specimen_label} size="small" onChange={e => updateSpecimen(specimen.source_item_id, "specimen_label", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Container / Fixative Details" value={specimen.container_details} size="small" onChange={e => updateSpecimen(specimen.source_item_id, "container_details", e.target.value)} sx={inputSx} fullWidth />
              <Sel label="Priority" value={specimen.priority} onChange={value => updateSpecimen(specimen.source_item_id, "priority", value)} options={["Routine", "Urgent", "STAT"]} />
              <Box sx={{ gridColumn: "span 2" }}>
                <CbxGroup label="Requested Tests *" options={PATHOLOGY_TESTS} value={specimen.requested_tests || []} onChange={value => updateSpecimen(specimen.source_item_id, "requested_tests", value)} />
              </Box>
              {specimen.requested_tests?.includes("Other") && (
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Other Requested Test *" value={specimen.other_test} size="small" onChange={e => updateSpecimen(specimen.source_item_id, "other_test", e.target.value)} sx={inputSx} fullWidth /></Box>
              )}
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Specimen / Clinical Notes" value={specimen.notes} size="small" multiline rows={3} onChange={e => updateSpecimen(specimen.source_item_id, "notes", e.target.value)} sx={inputSx} fullWidth /></Box>
            </FG>

            {loadingRequests && <Typography sx={{ mt: 1.5, fontSize: 12, color: C.textMuted }}>Loading request status...</Typography>}
            {itemRequests.length > 0 && (
              <Box sx={{ mt: 2, borderTop: `1px solid ${C.border}`, pt: 1.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}>Request History</Typography>
                {itemRequests.map(request => (
                  <Box key={request.request_id} sx={{ display: "flex", flexWrap: "wrap", gap: 2, py: 0.75, borderBottom: `1px solid ${C.border}` }}>
                    <Typography sx={{ fontSize: 12 }}>ID: {request.request_id}</Typography>
                    <Typography sx={{ fontSize: 12, textTransform: "capitalize" }}>Status: {request.status}</Typography>
                    <Typography sx={{ fontSize: 12 }}>Sent: {request.created_at ? new Date(request.created_at).toLocaleString() : "-"}</Typography>
                    {request.decline_reason && <Typography sx={{ fontSize: 12 }}>Decline reason: {request.decline_reason}</Typography>}
                  </Box>
                ))}
              </Box>
            )}

            <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
              {requestClosed ? (
                <Box sx={{ display: "inline-flex", alignItems: "center", px: 1.5, py: 0.9, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
                  <ScienceRounded sx={{ mr: 0.75, fontSize: 14, color: C.textMuted }} />
                  <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
                    Pathology request {completed ? "completed" : latestRequest.status === "accepted" ? "accepted" : "pending"}
                  </Typography>
                </Box>
              ) : (
                <Button sx={saveBtnSx} disabled={savingItemId === specimen.source_item_id} onClick={() => sendRequest(specimen)}>
                  <ScienceRounded sx={{ mr: 0.5, fontSize: 14 }} />
                  {savingItemId === specimen.source_item_id ? "Sending..." : latestRequest ? "Send Replacement Request" : "Send Pathology Request"}
                </Button>
              )}
              <Button sx={outlineBtnSx} disabled={!canRemove} onClick={() => setSpecimens(current => current.filter(item => item.source_item_id !== specimen.source_item_id))}>
                <DeleteRounded sx={{ mr: 0.5, fontSize: 14 }} />Remove
              </Button>
            </Box>
          </SectionBox>
        );
      })}

      <Box sx={{ display: "flex", gap: 1, mb: 3 }}>
        <Button sx={outlineBtnSx} onClick={() => setSpecimens(current => [...current, makePathologySpecimen({ anatomical_site: management.anatomicalSite || "" })])}>
          <AddRounded sx={{ mr: 0.5, fontSize: 14 }} />Add Specimen
        </Button>
        <Button sx={outlineBtnSx} disabled={savingItemId === "all"} onClick={saveDrafts}>
          <SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />{savingItemId === "all" ? "Saving..." : "Save Drafts"}
        </Button>
      </Box>
    </Box>
  );
};

export default PathologyRequestTab;
