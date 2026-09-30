// tabs/InfectionControlTab.jsx — Microbiology Tab 13: Infection control & AMR
//
// Certain results trigger mandatory actions that run OUTSIDE the clinical chain:
// infection-control notified of MDR organisms, public health notified of
// notifiable pathogens, stewardship alerted to AMR. Per the plan these fire on
// result confirmation in Tabs 5/8/9/10 — not at sign-out.
//
// This tab has two halves:
//   1. AUTO-DETECTED flags (read-only, from shared/amrFlags.js) — scanning the
//      recorded sections it lists the AMR alerts and notifiable diseases that
//      currently apply. Detection is display-only.
//   2. DISPATCH registry (editable, saved to infection_control) — for each flag
//      the microbiologist records who was notified / the method / reference /
//      acknowledgement. Only these actions are persisted.
//
// Stored shape:
//   infection_control = {
//     alerts: [ { alert_id, kind: "amr" | "notifiable", flag, detail,
//                 specimen_id, specimen_type, stale,
//                 notified_to, method, reference_number, notified_at,
//                 acknowledged, acknowledged_at } ],
//     outbreak: { cluster_note },
//     amr_surveillance: { logged, note },
//   }
// `stale: true` marks a previously-dispatched flag whose source detection no
// longer fires (the dispatch record is kept as history).

import React, { useEffect, useState } from "react";
import { Box, Typography, TextField, Button } from "@mui/material";
import { C, FONT, inputSx, saveBtnSx } from "../../shared/designTokens";
import { SectionBox, FieldLabel, Sel } from "../../shared/FormComponents";
import { detectFlags } from "../shared/amrFlags";

const makeId = (kind, flag, specimenId) =>
  `${kind}__${flag}__${specimenId || "case"}`;

const NOTIFY_METHOD_OPTIONS = ["Phone", "LIS alert", "Email", "In person"];
const ACK_OPTIONS = ["No", "Yes"];

const emptyAlert = () => ({
  notified_to: "",
  method: "",
  reference_number: "",
  notified_at: "",
  acknowledged: "No",
  acknowledged_at: "",
});

// Merge freshly-detected candidates with saved dispatch records by alert_id.
// Saved records whose detection no longer fires are kept with stale: true.
function mergeAlerts(detected, savedAlerts) {
  const merged = [];
  const seen = new Set();

  detected.forEach((d) => {
    const kind = d.kind; // amr | notifiable (assigned by caller)
    const alert_id = makeId(kind, d.flag, d.specimen_id);
    seen.add(alert_id);
    const saved = (savedAlerts || []).find((a) => a.alert_id === alert_id);
    merged.push({
      alert_id,
      kind,
      flag: d.flag,
      detail: d.detail,
      organism: d.organism || "",
      isolate_id: d.isolate_id || "",
      specimen_id: d.specimen_id || "",
      specimen_type: d.specimen_type || "",
      stale: false,
      ...emptyAlert(),
      ...(saved ? saved : {}),
    });
  });

  // Retain dispatched records no longer detected.
  (savedAlerts || []).forEach((s) => {
    if (seen.has(s.alert_id)) return;
    const hasDispatch = s.notified_to || s.reference_number || s.acknowledged === "Yes";
    if (hasDispatch) merged.push({ ...s, stale: true });
  });

  return merged;
}

export default function InfectionControlTab({
  caseId,
  initialData,        // infection_control section
  caseRegister,
  cultureWorkup,
  molecular,
  serology,
  mycobacteriology,
  directExamination,
  pathogenGenomics,   // Tab 15 section — WGS/mNGS/tNGS-derived flags. Human
                      // genomics is deliberately NOT scanned: it produces no
                      // infection-control flags.
  onSave,             // (tabKey, data) dispatch — "infection-control"
}) {
  const [alerts, setAlerts] = useState([]);
  const [outbreak, setOutbreak] = useState({ cluster_note: "" });
  const [surveillance, setSurveillance] = useState({ logged: "", note: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const src = (initialData && typeof initialData === "object") ? initialData : {};
    setOutbreak({ cluster_note: src.outbreak?.cluster_note || "" });
    setSurveillance({ logged: src.amr_surveillance?.logged || "", note: src.amr_surveillance?.note || "" });

    const detected = detectFlags({
      caseRegister,
      cultureWorkup,
      molecular,
      serology,
      mycobacteriology,
      directExamination,
      pathogenGenomics,
    });
    const amrCandidates = (detected.amr || []).map((d) => ({ ...d, kind: "amr" }));
    const notifCandidates = (detected.notifiable || []).map((d) => ({ ...d, kind: "notifiable" }));
    setAlerts(mergeAlerts([...amrCandidates, ...notifCandidates], Array.isArray(src.alerts) ? src.alerts : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patchAlert = (alert_id, patchObj) =>
    setAlerts((prev) => prev.map((a) => (a.alert_id === alert_id ? { ...a, ...patchObj } : a)));

  const save = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      // Persist only alerts that carry a dispatch action (detection itself is
      // not saved — it is re-derived on load).
      const kept = alerts.filter(
        (a) => a.notified_to || a.reference_number || a.acknowledged === "Yes" || a.notified_at
      );
      await onSave("infection-control", {
        alerts: kept.map(({ stale, ...rest }) => rest),
        outbreak,
        amr_surveillance: surveillance,
      });
    } catch (err) {
      console.error("[InfectionControlTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const amrAlerts = alerts.filter((a) => a.kind === "amr");
  const notifiableAlerts = alerts.filter((a) => a.kind === "notifiable");

  const renderAlertRows = (rows) =>
    rows.map((a) => (
      <Box key={a.alert_id} sx={{ border: `1px solid ${C.border}`, mb: 1.5, p: 1.5, background: C.bgTertiary }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
          <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: "600", color: C.textPrimary }}>
            {a.flag}
          </Typography>
          {a.specimen_type && (
            <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted }}>
              {a.specimen_type}{a.specimen_id ? ` · ${a.specimen_id}` : ""}
            </Typography>
          )}
          {a.stale && (
            <Typography sx={{ fontSize: 10, fontFamily: FONT, px: 1, py: 0.15, border: `1px solid ${C.border}`, color: C.textMuted }}>
              source detection no longer fires — record kept
            </Typography>
          )}
        </Box>
        <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, mb: 1 }}>
          {a.detail}
        </Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr 1fr" }, gap: 1 }}>
          <Box>
            <FieldLabel>Notified to (name / team)</FieldLabel>
            <TextField size="small" fullWidth sx={inputSx} value={a.notified_to} onChange={(e) => patchAlert(a.alert_id, { notified_to: e.target.value })} />
          </Box>
          <Box>
            <FieldLabel>Method</FieldLabel>
            <Sel label="Method" options={NOTIFY_METHOD_OPTIONS} value={a.method} onChange={(v) => patchAlert(a.alert_id, { method: v })} />
          </Box>
          {a.kind === "notifiable" && (
            <Box>
              <FieldLabel>Reference number</FieldLabel>
              <TextField size="small" fullWidth sx={inputSx} value={a.reference_number} onChange={(e) => patchAlert(a.alert_id, { reference_number: e.target.value })} />
            </Box>
          )}
          <Box>
            <FieldLabel>Notified at</FieldLabel>
            <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={a.notified_at} onChange={(e) => patchAlert(a.alert_id, { notified_at: e.target.value })} InputLabelProps={{ shrink: true }} />
          </Box>
          <Box>
            <FieldLabel>Acknowledged</FieldLabel>
            <Sel
              label="Acknowledged"
              options={ACK_OPTIONS}
              value={a.acknowledged}
              onChange={(v) =>
                patchAlert(a.alert_id, {
                  acknowledged: v,
                  acknowledged_at: v === "Yes" ? (a.acknowledged_at || new Date().toISOString()) : "",
                })
              }
            />
          </Box>
        </Box>
      </Box>
    ));

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Flags are auto-detected from the recorded tracks (AMR mechanisms in culture AST, notifiable pathogens across
        direct exam / molecular / serology / mycobacteriology). Detection is read-only — you dispatch and acknowledge each
        flag here, and only those dispatch actions are saved. These actions are independent of sign-out.
      </Typography>

      {/* AMR alert flags */}
      <SectionBox title={`Infection-control / AMR alerts (${amrAlerts.length})`}>
        {amrAlerts.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
            No AMR alert flags detected from the current records.
          </Typography>
        )}
        {renderAlertRows(amrAlerts)}
      </SectionBox>

      {/* Notifiable disease flags */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title={`Notifiable / public-health flags (${notifiableAlerts.length})`}>
          {notifiableAlerts.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
              No notifiable-disease flags detected from the current records.
            </Typography>
          )}
          {renderAlertRows(notifiableAlerts)}
        </SectionBox>
      </Box>

      {/* Outbreak linkage */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title="Outbreak linkage">
          <FieldLabel>Cluster note (same organism + resistance pattern + ward / time window)</FieldLabel>
          <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={outbreak.cluster_note} onChange={(e) => setOutbreak({ cluster_note: e.target.value })} placeholder="e.g. 3 CRE cases, ICU bay B, same week — link to outbreak investigation record (future module)" />
        </SectionBox>
      </Box>

      {/* AMR surveillance contribution */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title="AMR surveillance contribution (de-identified)">
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 2fr" }, gap: 1.5 }}>
            <Box>
              <FieldLabel>Logged to antibiogram DB</FieldLabel>
              <Sel label="Logged" options={["No", "Yes"]} value={surveillance.logged} onChange={(v) => setSurveillance((p) => ({ ...p, logged: v }))} />
            </Box>
            <Box>
              <FieldLabel>Note</FieldLabel>
              <TextField size="small" fullWidth sx={inputSx} value={surveillance.note} onChange={(e) => setSurveillance((p) => ({ ...p, note: e.target.value }))} placeholder="Background contribution — does not block sign-out" />
            </Box>
          </Box>
        </SectionBox>
      </Box>

      {notice && (
        <Box sx={{ my: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1 }}>
        <Button onClick={save} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Infection Control"}
        </Button>
      </Box>
    </Box>
  );
}
