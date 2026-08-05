// shared/useBookingData.js — Core hook for booking data + cross-form merge logic
//
// This hook centralizes:
// 1. Fetching all bookings for a patient+doctor
// 2. Fetching the full document for the current (latest) booking
// 3. Fetching the external anaesthesia checklist
// 4. Read-time merging of shared fields across forms
//
// The merge logic implements the priority chain:
//   For Group A (Pre-Op Assessment):  checklist > booking
//   For Group B (Pre-Induction):      anaesthesia.pi > checklist > booking
//   For Group C (Anaesthesia CL):     checklist > external anaesthesia checklist

import { useState, useEffect, useCallback, useMemo } from "react";
import { getBookings, getBooking } from "./api";
import { getActiveAnaesthesiaRecord, getAnaesthesiaRecordByBooking } from "../../shared/api";

/**
 * @param {string} patientId
 * @param {string} doctorId
 * @returns {object} — See return value at bottom of hook
 */
export function useBookingData(patientId, doctorId) {
  const [bookings, setBookings] = useState([]);
  const [currentBookingDoc, setCurrentBookingDoc] = useState(null);
  const [activeAnaesthesiaRecord, setActiveAnaesthesiaRecord] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Fetch all bookings for this patient+doctor ─────────────────────────
  const fetchBookings = useCallback(async () => {
    if (!doctorId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await getBookings(doctorId, { patient_id: patientId || undefined });
      const bookingsList = result.bookings || [];
      setBookings(bookingsList);

      // Find the active booking, fallback to the latest
      if (bookingsList.length > 0) {
        const latest = bookingsList.find(b => b.is_active) || bookingsList[bookingsList.length - 1];
        const latestId = latest.booking_id;

        if (latestId) {
          // Fetch full document for the latest booking
          const fullDoc = await getBooking(latestId);
          setCurrentBookingDoc(fullDoc.data || null);

          // Fetch linked anaesthesia record (active OR completed) for cross-form population
          getAnaesthesiaRecordByBooking(latestId)
            .then(d => {
              if (d?.status === "success" && d.data) {
                setActiveAnaesthesiaRecord(d.data);
              } else {
                return getActiveAnaesthesiaRecord(patientId).then(a => setActiveAnaesthesiaRecord(a?.data || null));
              }
            })
            .catch(() => {
              getActiveAnaesthesiaRecord(patientId)
                .then(a => setActiveAnaesthesiaRecord(a?.data || null))
                .catch(err => {
                  console.error("[useBookingData] anaesthesia record fetch error:", err);
                  setActiveAnaesthesiaRecord(null);
                });
            });
        } else {
          setCurrentBookingDoc(null);
          setActiveAnaesthesiaRecord(null);
        }
      } else {
        setCurrentBookingDoc(null);
        setActiveAnaesthesiaRecord(null);
      }
    } catch (err) {
      console.error("[useBookingData] fetch error:", err);
      setError(err.message);
      setCurrentBookingDoc(null);
      setActiveAnaesthesiaRecord(null);
    } finally {
      setIsLoading(false);
    }
  }, [patientId, doctorId]);

  // ─── Initial fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);


  // ─── Switch to a different booking ──────────────────────────────────────
  const switchBooking = useCallback(async (bookingId) => {
    if (!bookingId) return;
    setIsLoading(true);
    try {
      const fullDoc = await getBooking(bookingId);
      setCurrentBookingDoc(fullDoc.data || null);
    } catch (err) {
      console.error("[useBookingData] switchBooking error:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─── Helper: nullish-coalesce with array awareness ──────────────────────
  // For arrays, we treat empty arrays as "not set" (fall through to next source)
  const pick = useCallback((...sources) => {
    for (let i = 0; i < sources.length; i++) {
      const v = sources[i];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (v === "") continue;
      return v;
    }
    // Return the last argument's type-appropriate default
    const last = sources[sources.length - 1];
    if (Array.isArray(last)) return [];
    return last ?? "";
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE FUNCTIONS — Read-time merge of shared fields
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get merged initialData for the Surgical Checklist form.
   * Priority: checklist own value > external anaesthesia checklist > booking value
   */
  const getMergedChecklist = useCallback(() => {
    if (!currentBookingDoc) return {};
    const booking = currentBookingDoc.booking || {};
    const checklist = currentBookingDoc.checklist || {};
    const doctorsNote = currentBookingDoc.doctors_note || {};
    const extCL = activeAnaesthesiaRecord?.checklist || {};

    return {
      ...checklist,
      // ── Group A: Pre-Op Assessment (checklist > booking) ──
      viralMarkers:        pick(checklist.viralMarkers, booking.viralMarkers, []),
      insurance:           pick(checklist.insurance, booking.insurance, ""),
      insuranceType:       pick(checklist.insuranceType, booking.insuranceType, []),
      asaClass:            pick(checklist.asaClass, booking.asaClass, ""),
      highRiskMDT:         pick(checklist.highRiskMDT, booking.highRiskMDT, ""),
      mdtComments:         pick(checklist.mdtComments, booking.mdtComments, ""),
      bloodGroup:          pick(checklist.bloodGroup, booking.bloodGroup, ""),
      pastTransfusion:     pick(checklist.pastTransfusion, booking.pastTransfusion, ""),
      transfusionReaction: pick(checklist.transfusionReaction, booking.transfusionReaction, ""),
      reactionDetails:     pick(checklist.reactionDetails, booking.reactionDetails, ""),
      remarks:             pick(checklist.remarks, booking.remarks, ""),

      // ── Group B: Pre-Induction (checklist > doctors_note > booking) ──
      surgery:               pick(checklist.surgery, doctorsNote.surgery, booking.procedureName, ""),
      asaStatus:             pick(checklist.asaStatus, doctorsNote.asaStatus, booking.asaClass ? [booking.asaClass] : [], []),
      aspirationRisk:        pick(checklist.aspirationRisk, doctorsNote.aspirationRisk, ""),
      bloodConfirmed:        pick(checklist.bloodConfirmed, doctorsNote.bloodConfirmed, ""),
      surgeryType:           pick(checklist.surgeryType, doctorsNote.surgeryType, booking.surgeryType, booking.caseStatus ? [booking.caseStatus] : [], []),
      machineCheck:          pick(checklist.machineCheck, doctorsNote.machineCheck, ""),
      informedConsent:       pick(checklist.informedConsent, doctorsNote.informedConsent, []),
      premedication:         pick(checklist.premedication, doctorsNote.premedication, []),
      premedicationDetails:  pick(checklist.premedicationDetails, doctorsNote.premedicationDetails, ""),
      bp:                    pick(checklist.bp, doctorsNote.bp, ""),
      rr:                    pick(checklist.rr, doctorsNote.rr, ""),
      pr:                    pick(checklist.pr, doctorsNote.pr, ""),
      spo2:                  pick(checklist.spo2, doctorsNote.spo2, ""),
      temperature:           pick(checklist.temperature, doctorsNote.temperature, ""),
      consciousness:         pick(checklist.consciousness, doctorsNote.consciousness, ""),

      // ── Group C: Anaesthesia Checklist (checklist > external) ──
      signin_consent_status:          pick(checklist.signin_consent_status, extCL.signin_consent, ""),
      signin_consent_remarks:         pick(checklist.signin_consent_remarks, extCL.signin_consent_remark, ""),
      signin_machine_status:          pick(checklist.signin_machine_status, extCL.signin_machine, ""),
      signin_machine_remarks:         pick(checklist.signin_machine_remarks, extCL.signin_machine_remark, ""),
      signin_oximeter_status:         pick(checklist.signin_oximeter_status, extCL.signin_oximeter, ""),
      signin_oximeter_remarks:        pick(checklist.signin_oximeter_remarks, extCL.signin_oximeter_remark, ""),
      signin_airway_status:           pick(checklist.signin_airway_status, extCL.signin_airway, ""),
      signin_airway_remarks:          pick(checklist.signin_airway_remarks, extCL.signin_airway_remark, ""),
      signin_aspiration_status:       pick(checklist.signin_aspiration_status, extCL.signin_aspiration, ""),
      signin_aspiration_remarks:      pick(checklist.signin_aspiration_remarks, extCL.signin_aspiration_remark, ""),
      signin_starvation_status:       pick(checklist.signin_starvation_status, extCL.signin_starvation, ""),
      signin_starvation_remarks:      pick(checklist.signin_starvation_remarks, extCL.signin_starvation_remark, ""),
      signin_allergy_status:          pick(checklist.signin_allergy_status, extCL.signin_allergy, ""),
      signin_allergy_remarks:         pick(checklist.signin_allergy_remarks, extCL.signin_allergy_remark, ""),
      timeout_antibiotic_status:      pick(checklist.timeout_antibiotic_status, extCL.timeout_antibiotic, ""),
      timeout_antibiotic_remarks:     pick(checklist.timeout_antibiotic_remarks, extCL.timeout_antibiotic_remark, ""),
      timeout_throat_status:          pick(checklist.timeout_throat_status, extCL.timeout_throat, ""),
      timeout_throat_remarks:         pick(checklist.timeout_throat_remarks, extCL.timeout_throat_remark, ""),
      timeout_events_anaesthesia:     pick(checklist.timeout_events_anaesthesia, extCL.timeout_anaesthesia_events, ""),
      signout_concerns_anaesthesia:   pick(checklist.signout_concerns_anaesthesia, extCL.signout_concerns, ""),
      extubation_throat_status:       pick(checklist.extubation_throat_status, extCL.extubation_throat, ""),
      extubation_throat_remarks:      pick(checklist.extubation_throat_remarks, extCL.extubation_throat_remark, ""),

      // ── Checklist-only fields (no overlap — pass through) ──
      signin_identity_status:   checklist.signin_identity_status || "",
      signin_identity_remarks:  checklist.signin_identity_remarks || "",
      signin_procedure_status:  checklist.signin_procedure_status || "",
      signin_procedure_remarks: checklist.signin_procedure_remarks || "",
      signin_side_status:       checklist.signin_side_status || "",
      signin_side_remarks:      checklist.signin_side_remarks || "",
      signin_site_status:       checklist.signin_site_status || "",
      signin_site_remarks:      checklist.signin_site_remarks || "",
      signin_viral_status:      checklist.signin_viral_status || "",
      signin_viral_remarks:     checklist.signin_viral_remarks || "",
      signin_blood_status:      checklist.signin_blood_status || "",
      signin_blood_remarks:     checklist.signin_blood_remarks || "",
      signin_instruments_status: checklist.signin_instruments_status || "",
      signin_instruments_remarks: checklist.signin_instruments_remarks || "",
      signin_position_status:   checklist.signin_position_status || "",
      signin_position_remarks:  checklist.signin_position_remarks || "",

      timeout_intro_status:     checklist.timeout_intro_status || "",
      timeout_intro_remarks:    checklist.timeout_intro_remarks || "",
      timeout_patient_status:   checklist.timeout_patient_status || "",
      timeout_patient_remarks:  checklist.timeout_patient_remarks || "",
      timeout_procedure_status: checklist.timeout_procedure_status || "",
      timeout_procedure_remarks: checklist.timeout_procedure_remarks || "",
      timeout_side_status:      checklist.timeout_side_status || "",
      timeout_side_remarks:     checklist.timeout_side_remarks || "",
      timeout_events_surgeon:   checklist.timeout_events_surgeon || "",
      timeout_events_nursing:   checklist.timeout_events_nursing || "",
      timeout_mop_status:       checklist.timeout_mop_status || "",
      timeout_mop_remarks:      checklist.timeout_mop_remarks || "",
      timeout_imaging_status:   checklist.timeout_imaging_status || "",
      timeout_imaging_remarks:  checklist.timeout_imaging_remarks || "",
      timeout_hpr_status:       checklist.timeout_hpr_status || "",
      timeout_hpr_remarks:      checklist.timeout_hpr_remarks || "",
      timeout_tourniquet_status:  checklist.timeout_tourniquet_status || "",
      timeout_tourniquet_remarks: checklist.timeout_tourniquet_remarks || "",

      signout_name_status:      checklist.signout_name_status || "",
      signout_name_remarks:     checklist.signout_name_remarks || "",
      signout_count_status:     checklist.signout_count_status || "",
      signout_count_remarks:    checklist.signout_count_remarks || "",
      signout_specimen_status:  checklist.signout_specimen_status || "",
      signout_specimen_remarks: checklist.signout_specimen_remarks || "",
      signout_equipment_status: checklist.signout_equipment_status || "",
      signout_equipment_remarks: checklist.signout_equipment_remarks || "",
      signout_concerns_surgeon: checklist.signout_concerns_surgeon || "",
      signout_concerns_nursing: checklist.signout_concerns_nursing || "",

      // ── Common context fields ──
      wardBed:  pick(checklist.wardBed, booking.wardBed, ""),
      unitName: pick(checklist.unitName, booking.unitName, ""),
    };
  }, [currentBookingDoc, activeAnaesthesiaRecord, pick]);

  /**
   * Get merged initialData for the Anaesthesia Pre-Induction form.
   * Priority: anaesthesia.pi > checklist > booking
   */
  const getMergedDoctorsNote = useCallback(() => {
    if (!currentBookingDoc) return {};
    const booking = currentBookingDoc.booking || {};
    const checklist = currentBookingDoc.checklist || {};
    const pi = currentBookingDoc.doctors_note || {};

    return {
      // Pre-Induction fields (pi > checklist > booking)
      surgery:               pick(pi.surgery, checklist.surgery, booking.procedureName, ""),
      asaStatus:             pick(pi.asaStatus, checklist.asaStatus, booking.asaClass ? [booking.asaClass] : [], []),
      aspirationRisk:        pick(pi.aspirationRisk, checklist.aspirationRisk, ""),
      bloodConfirmed:        pick(pi.bloodConfirmed, checklist.bloodConfirmed, ""),
      surgeryType:           pick(pi.surgeryType, checklist.surgeryType, booking.surgeryType, booking.caseStatus ? [booking.caseStatus] : [], []),
      machineCheck:          pick(pi.machineCheck, checklist.machineCheck, ""),
      informedConsent:       pick(pi.informedConsent, checklist.informedConsent, []),
      premedication:         pick(pi.premedication, checklist.premedication, []),
      premedicationDetails:  pick(pi.premedicationDetails, checklist.premedicationDetails, ""),
      bp:                    pick(pi.bp, checklist.bp, ""),
      rr:                    pick(pi.rr, checklist.rr, ""),
      pr:                    pick(pi.pr, checklist.pr, ""),
      spo2:                  pick(pi.spo2, checklist.spo2, ""),
      temperature:           pick(pi.temperature, checklist.temperature, ""),
      consciousness:         pick(pi.consciousness, checklist.consciousness, ""),

      // PI-only fields (no overlap)
      height:        pi.height || "",
      weight:        pi.weight || "",

      // Pre-Op Clinical Staging (cTNM)
      clinicalStagingT:      pi.clinicalStagingT || "",
      clinicalStagingN:      pi.clinicalStagingN || "",
      clinicalStagingM:      pi.clinicalStagingM || "",
      clinicalStageGroup:    pi.clinicalStageGroup || "",
      clinicalDiagnosis:     pi.clinicalDiagnosis || "",
      clinicalStagingBasis:  pi.clinicalStagingBasis || [],
      clinicalStagingNotes:  pi.clinicalStagingNotes || "",

      // Common context fields
      wardBed:       pick(pi.wardBed, checklist.wardBed, booking.wardBed, ""),
      unitName:      pick(pi.unitName, checklist.unitName, booking.unitName, ""),
      treatingDoctor: pick(pi.treatingDoctor, booking.treatingDoctor, ""),
      
      // Feature-specific
      narration:     pi.narration || {},
    };
  }, [currentBookingDoc, pick]);

  /**
   * Get initialData for the Surgical Management form.
   * No cross-form merge needed — management only reads its own data.
   * But it does inherit some context fields from booking.
   */
  const getMergedManagement = useCallback(() => {
    if (!currentBookingDoc) return {};
    const booking = currentBookingDoc.booking || {};
    const management = currentBookingDoc.management || {};
    const checklist = currentBookingDoc.checklist || {};
    const doctorsNote = currentBookingDoc.doctors_note || {};

    return {
      ...management,
      wardBed:  pick(management.wardBed, booking.wardBed, ""),
      unitName: pick(management.unitName, booking.unitName, ""),
      nameOfProcedure: pick(management.nameOfProcedure, checklist.surgery, doctorsNote.surgery, booking.procedureName, ""),
    };
  }, [currentBookingDoc, pick]);

  /**
   * Get initialData for the Post-Op Complications form.
   */
  const getMergedPostOp = useCallback(() => {
    if (!currentBookingDoc) return {};
    const booking = currentBookingDoc.booking || {};
    const postOp = currentBookingDoc.post_op || {};

    return {
      ...postOp,
      unitName: pick(postOp.unitName, booking.unitName, ""),
    };
  }, [currentBookingDoc, pick]);

  /**
   * Get initialData for a specific anaesthesia sub-tab (mm, ga, reg, mac, io, eo).
   */
  const getAnaesthesiaSection = useCallback((subKey) => {
    if (!currentBookingDoc) return {};
    const localSurgicalCopy = currentBookingDoc.anaesthesia?.[subKey];
    // Priority 1: Local Surgical Copy (if already saved)
    if (localSurgicalCopy && Object.keys(localSurgicalCopy).length > 0) {
      return localSurgicalCopy;
    }
    // Priority 2: Anaesthesia DB active record
    return activeAnaesthesiaRecord?.[subKey] || {};
  }, [currentBookingDoc, activeAnaesthesiaRecord]);

  // ─── Derived values ─────────────────────────────────────────────────────
  const currentBookingId = currentBookingDoc?.booking_id || null;
  // Pass the FULL document (not just .booking) so sub-tabs can reach anaesthesia.*, checklist.* etc.
  const currentBookingData = currentBookingDoc || null;
  const surgeryFinished = currentBookingDoc?.surgery_finished || false;

  return {
    // Raw data
    bookings,
    currentBookingDoc,
    currentBookingId,
    currentBookingData,
    surgeryFinished,
    activeAnaesthesiaRecord,

    // State
    isLoading,
    error,

    // Actions
    refetch: fetchBookings,
    switchBooking,

    // Merge functions — call these to get pre-merged initialData for each form
    getMergedChecklist,
    getMergedDoctorsNote,
    getMergedManagement,
    getMergedPostOp,
    getAnaesthesiaSection,
  };
}

export default useBookingData;
