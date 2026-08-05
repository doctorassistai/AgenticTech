// shared/usePatientInfo.js — Hook to auto-populate patient info by ID
// Replaces the duplicated autoPopulate functions in OTBookingTab, AnaesthesiaTab,
// DiagrammaticTemplateTab, LogBookTab, etc.

import { useState, useEffect, useCallback } from "react";
import { getPatientInfo } from "./api";

/**
 * Fetches and caches patient info (name, ageSex) for a given patient ID.
 *
 * @param {string} patientId — The patient ID to look up
 * @returns {{ name: string, ageSex: string, isLoading: boolean, error: string|null, refetch: () => void }}
 *
 * @example
 * const { name, ageSex, isLoading } = usePatientInfo(patientId);
 * // name = "John Doe", ageSex = "45 / Male"
 */
export function usePatientInfo(patientId) {
  const [info, setInfo] = useState({ name: "", ageSex: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchInfo = useCallback(async (id) => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getPatientInfo(id);
      setInfo({
        name: data.patient_name || "",
        ageSex: ((data.age ? data.age + " / " : "") + (data.gender || "")).trim() || "",
      });
    } catch (err) {
      console.error("[usePatientInfo] fetch error:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (patientId) {
      fetchInfo(patientId);
    }
  }, [patientId, fetchInfo]);

  const refetch = useCallback(() => {
    if (patientId) fetchInfo(patientId);
  }, [patientId, fetchInfo]);

  return { ...info, isLoading, error, refetch };
}

export default usePatientInfo;
