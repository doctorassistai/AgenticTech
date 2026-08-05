// shared/usePathologyCase.js — Core hook for pathology case data
//
// Mirrors surgical-oncology's useBookingData, but simpler: one document per
// CASE (case_id), no cross-form anaesthesia merge chain. It:
//   1. Loads all cases for a patient (history list, newest first)
//   2. Loads the full document for the active/latest case
//   3. Exposes helpers to switch cases and a `pick()` merge helper
//
// Returns: { cases, currentCaseId, currentCaseData, isLoading, error,
//            refetch, switchCase, pick }

import { useState, useEffect, useCallback } from "react";
import { getPatientCases, getCase, getLatestCase } from "./api";

/**
 * @param {string} patientId
 * @param {string} doctorId — reserved for parity with useBookingData / worklist scoping
 */
export function usePathologyCase(patientId, doctorId) {
  const [cases, setCases] = useState([]);
  const [currentCaseId, setCurrentCaseId] = useState("");
  const [currentCaseData, setCurrentCaseData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Fetch the case list + the active/latest case's full document ─────────
  const fetchCases = useCallback(async () => {
    if (!patientId) {
      setCases([]);
      setCurrentCaseId("");
      setCurrentCaseData(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const listResult = await getPatientCases(patientId);
      const caseList = listResult.cases || [];
      setCases(caseList);

      // Prefer the active case; else the newest (list is newest-first).
      const latest = await getLatestCase(patientId);
      const latestDoc = latest.data && latest.data.case_id ? latest.data : null;

      // If the returned case is signed-out, treat it as "no current editable case"
      // so the form clears after sign-out (user can still view it via history).
      if (latestDoc && latestDoc.status !== "Signed-out") {
        setCurrentCaseId(latestDoc.case_id);
        setCurrentCaseData(latestDoc);
      } else {
        setCurrentCaseId("");
        setCurrentCaseData(null);
      }
    } catch (err) {
      console.error("[usePathologyCase] fetch error:", err);
      setError(err.message);
      setCurrentCaseId("");
      setCurrentCaseData(null);
    } finally {
      setIsLoading(false);
    }
  }, [patientId]);

  // ─── Initial fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // ─── Switch to a different case ───────────────────────────────────────────
  const switchCase = useCallback(async (caseId) => {
    if (!caseId) return;
    setIsLoading(true);
    try {
      const full = await getCase(caseId);
      const data = full.data && full.data.case_id ? full.data : null;
      setCurrentCaseId(data ? data.case_id : "");
      setCurrentCaseData(data);
    } catch (err) {
      console.error("[usePathologyCase] switchCase error:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─── Helper: first non-empty value (array-aware) ──────────────────────────
  const pick = useCallback((...sources) => {
    for (let i = 0; i < sources.length; i++) {
      const v = sources[i];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (v === "") continue;
      return v;
    }
    const last = sources[sources.length - 1];
    if (Array.isArray(last)) return [];
    return last ?? "";
  }, []);

  return {
    cases,
    currentCaseId,
    currentCaseData,
    isLoading,
    error,
    refetch: fetchCases,
    switchCase,
    pick,
  };
}

export default usePathologyCase;
