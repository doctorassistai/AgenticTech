// tabs/CultureSetupTab.jsx — Microbiology Tab 4: Culture setup
//
// The culture "job card". For each specimen it confirms the dispatch decisions
// made in Tab 2 (media, incubator, atmosphere — prefilled, editable), and owns
// the read schedule that drives Tab 5's plate reading:
//   culture_setup = {
//     [specimen_id]: {
//       media, media_remarks, incubator_bay, atmosphere,
//       blood: { bottle_type, monitor_system, bay, ttp_hours },
//       reads: [ { read_id, label, status: "pending" | "done", done_at } ],
//       window_closed,   // negative-report trigger flag (issue action lives in Tab 5)
//       notes,
//     }
//   }
//
// Reads are auto-seeded from the specimen's track (see readScheduleFor in
// constants.js) so Tab 5 has a schedule to consume; rows are editable.

import React, { useEffect, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton,
} from "@mui/material";
import { AddRounded, DeleteOutlineRounded } from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FieldLabel, Sel, CbxGroup,
} from "../../shared/FormComponents";
import {
  MEDIA_GROUPS,
  MEDIA_GROUP_TEST_TRIGGERS,
  ATMOSPHERE_OPTIONS,
  BLOOD_BOTTLE_TYPE_OPTIONS,
  BLOOD_MONITOR_OPTIONS,
  BLOOD_VOLUME_OPTIONS,
  WINDOW_CLOSED_OPTIONS,
  readScheduleFor,
  cultureTestsFor,
} from "../constants";

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

const READ_STATUS_OPTIONS = ["pending", "done"];

const mediaGroupsFor = (tests) =>
  MEDIA_GROUPS.filter((g) =>
    (MEDIA_GROUP_TEST_TRIGGERS[g.key] || []).some((tv) => tests.includes(tv))
  );

const isBloodCulture = (sp) =>
  (Array.isArray(sp?.tests_ordered) && sp.tests_ordered.includes("blood_culture")) ||
  /blood culture/i.test(sp?.specimen_type || "");

const seedReads = (sp, savedReads) => {
  if (Array.isArray(savedReads) && savedReads.length) {
    return savedReads.map((r) => ({ read_id: r.read_id || makeUid("READ"), label: r.label, status: r.status || "pending", done_at: r.done_at || "" }));
  }
  return readScheduleFor(sp).map(({ label }) => ({ read_id: makeUid("READ"), label, status: "pending", done_at: "" }));
};

const blankFor = (sp, saved = {}, processingRec) => {
  const blood = {
    bottle_type: "",
    monitor_system: "",
    volume_inoculated: "",
    bay: "",
    ttp_hours: "",
    ...((saved && saved.blood) || {}),
    ...((processingRec && processingRec.blood_culture) || {}),
  };
  const prefilledMedia = Array.isArray(processingRec?.media) ? processingRec.media : [];
  const media = Array.isArray(saved?.media) && saved.media.length ? saved.media : prefilledMedia;
  return {
    media,
    media_remarks: saved?.media_remarks || "",
    incubator_bay: saved?.incubator_bay || processingRec?.blood_culture?.incubator_bay || "",
    atmosphere: saved?.atmosphere || processingRec?.atmosphere || "",
    blood,
    reads: seedReads(sp, saved?.reads),
    window_closed: saved?.window_closed || "",
    notes: saved?.notes || "",
  };
};

export default function CultureSetupTab({
  caseId,
  initialData,      // culture_setup section: { [specimen_id]: {…} }
  caseRegister,     // case_register (specimens + tests)
  processingData,   // specimen_processing section (Tab 2 prefill)
  onSave,
}) {
  const [records, setRecords] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];
  // Only specimens with a culture test ordered get a job card. Records for every
  // specimen are still hydrated below, so a stored culture_setup block is never
  // dropped from the section when a specimen's ordered tests change.
  const cultureSpecimens = specimens.filter((sp) => cultureTestsFor(sp.tests_ordered).length > 0);

  useEffect(() => {
    const saved = (initialData && typeof initialData === "object") ? initialData : {};
    const processing = (processingData && typeof processingData === "object") ? processingData : {};
    const hydrated = {};
    specimens.forEach((sp) => {
      hydrated[sp.specimen_id] = blankFor(sp, saved[sp.specimen_id], processing[sp.specimen_id]);
    });
    setRecords(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patch = (specimenId, patchObj) =>
    setRecords((prev) => ({ ...prev, [specimenId]: { ...prev[specimenId], ...patchObj } }));

  const patchNested = (specimenId, group, patchObj) =>
    setRecords((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], [group]: { ...prev[specimenId][group], ...patchObj } },
    }));

  const patchRead = (specimenId, readId, patchObj) =>
    setRecords((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        reads: prev[specimenId].reads.map((r) => (r.read_id === readId ? { ...r, ...patchObj } : r)),
      },
    }));

  const addRead = (specimenId, label) =>
    setRecords((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        reads: [...prev[specimenId].reads, { read_id: makeUid("READ"), label: label || "Additional read", status: "pending", done_at: "" }],
      },
    }));

  const removeRead = (specimenId, readId) =>
    setRecords((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], reads: prev[specimenId].reads.filter((r) => r.read_id !== readId) },
    }));

  const handleSave = async () => {
    setNotice("");
    setIsSaving(true);
    try {
      await onSave("culture-setup", records);
    } catch (err) {
      console.error("[CultureSetupTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (cultureSpecimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          {specimens.length === 0
            ? "No specimens registered. Add specimens in Registration & Accession first."
            : "No specimen in this case has a culture test ordered — culture setup does not apply."}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {cultureSpecimens.map((sp, i) => {
        const rec = records[sp.specimen_id] || blankFor(sp);
        const tests = Array.isArray(sp.tests_ordered) ? sp.tests_ordered : [];
        const mediaGroups = mediaGroupsFor(tests);
        const bloodCulture = isBloodCulture(sp);

        return (
          <SectionBox
            key={sp.specimen_id}
            title={`Specimen ${i + 1} — ${sp.specimen_type || "Unspecified"} · ${sp.specimen_id}`}
          >
            {/* Setup confirmation (prefilled from Tab 2) */}
            <Box sx={{ mb: 2.5 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5, mb: 1.5 }}>
                <Box>
                  <FieldLabel>Incubator / bay</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} placeholder="e.g. Incubator 2 · bay 4" value={rec.incubator_bay} onChange={(e) => patch(sp.specimen_id, { incubator_bay: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Atmosphere confirmed</FieldLabel>
                  <Sel label="Atmosphere" options={ATMOSPHERE_OPTIONS} value={rec.atmosphere} onChange={(v) => patch(sp.specimen_id, { atmosphere: v })} />
                </Box>
              </Box>

              {mediaGroups.length > 0 && (
                <Box sx={{ mb: 1 }}>
                  <FieldLabel>Media (confirmed from processing, editable)</FieldLabel>
                  {mediaGroups.map((g) => (
                    <Box key={g.key} sx={{ mb: 0.5 }}>
                      <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.25 }}>
                        {g.label}
                      </Typography>
                      <CbxGroup
                        label=""
                        options={g.options}
                        value={rec.media}
                        onChange={(v) => patch(sp.specimen_id, { media: v })}
                      />
                    </Box>
                  ))}
                  <TextField size="small" fullWidth sx={{ ...inputSx, mt: 0.5 }} placeholder="Other media / remarks" value={rec.media_remarks || ""} onChange={(e) => patch(sp.specimen_id, { media_remarks: e.target.value })} />
                </Box>
              )}

              {bloodCulture && (
                <Box sx={{ mt: 1.5, border: `1px solid ${C.border}`, p: 1.5, background: C.bgTertiary }}>
                  <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}>
                    Blood culture config (CLSI M47)
                  </Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                    <Box>
                      <FieldLabel>Bottle type</FieldLabel>
                      <Sel label="Bottle type" options={BLOOD_BOTTLE_TYPE_OPTIONS} value={rec.blood.bottle_type} onChange={(v) => patchNested(sp.specimen_id, "blood", { bottle_type: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Volume inoculated</FieldLabel>
                      <Sel label="Volume" options={BLOOD_VOLUME_OPTIONS} value={rec.blood.volume_inoculated} onChange={(v) => patchNested(sp.specimen_id, "blood", { volume_inoculated: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Monitor system</FieldLabel>
                      <Sel label="Monitor" options={BLOOD_MONITOR_OPTIONS} value={rec.blood.monitor_system} onChange={(v) => patchNested(sp.specimen_id, "blood", { monitor_system: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Time to positivity (TTP, h)</FieldLabel>
                      <TextField size="small" fullWidth sx={inputSx} placeholder="recorded on signal" value={rec.blood.ttp_hours} onChange={(e) => patchNested(sp.specimen_id, "blood", { ttp_hours: e.target.value })} />
                    </Box>
                  </Box>
                </Box>
              )}
            </Box>

            {/* Read schedule */}
            <Box sx={{ border: `1px solid ${C.border}`, p: 1.5, background: C.bgTertiary }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1 }}>
                <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT }}>
                  Read schedule (drives Tab 5)
                </Typography>
                <Box sx={{ display: "flex", gap: 0.75 }}>
                  <Button size="small" onClick={() => addRead(sp.specimen_id, "")} sx={{ px: 1, py: 0.3, fontSize: 10, border: `1px solid ${C.border}`, color: C.textSecond, fontFamily: FONT, textTransform: "none", cursor: "pointer", background: C.white, "&:hover": { borderColor: C.black } }}>
                    <AddRounded sx={{ fontSize: 12, mr: 0.25 }} /> Read
                  </Button>
                </Box>
              </Box>

              {rec.reads.length === 0 && (
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1 }}>
                  No read schedule yet for this specimen.
                </Typography>
              )}

              {rec.reads.map((r, ri) => (
                <Box key={r.read_id} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 150px 190px auto" }, gap: 1, alignItems: "center", mb: 1 }}>
                  <Box>
                    <FieldLabel>{ri === 0 ? "Read" : ""}</FieldLabel>
                    <TextField size="small" fullWidth sx={inputSx} value={r.label} onChange={(e) => patchRead(sp.specimen_id, r.read_id, { label: e.target.value })} />
                  </Box>
                  <Box>
                    <FieldLabel>{ri === 0 ? "Status" : ""}</FieldLabel>
                    <Sel label="Status" options={READ_STATUS_OPTIONS} value={r.status} onChange={(v) => patchRead(sp.specimen_id, r.read_id, { status: v, done_at: v === "done" ? (r.done_at || new Date().toISOString().slice(0, 16)) : "" })} />
                  </Box>
                  <Box>
                    <FieldLabel>{ri === 0 ? "Done at" : ""}</FieldLabel>
                    <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={r.done_at} onChange={(e) => patchRead(sp.specimen_id, r.read_id, { done_at: e.target.value })} InputLabelProps={{ shrink: true }} />
                  </Box>
                  <IconButton size="small" onClick={() => removeRead(sp.specimen_id, r.read_id)} sx={{ color: C.textSecond, "&:hover": { color: C.black }, mt: 1.5 }}><DeleteOutlineRounded fontSize="small" /></IconButton>
                </Box>
              ))}
            </Box>

            {/* Window end / negative report flag */}
            <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 2fr" }, gap: 1.5 }}>
              <Box>
                <FieldLabel>Incubation window ended (negative-report flag)</FieldLabel>
                <Sel label="Window status" options={WINDOW_CLOSED_OPTIONS} value={rec.window_closed} onChange={(v) => patch(sp.specimen_id, { window_closed: v })} />
              </Box>
              <Box>
                <FieldLabel>Notes</FieldLabel>
                <TextField size="small" fullWidth sx={inputSx} value={rec.notes || ""} onChange={(e) => patch(sp.specimen_id, { notes: e.target.value })} placeholder="Culture job-card notes" />
              </Box>
            </Box>
          </SectionBox>
        );
      })}

      {notice && (
        <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1 }}>
        <Button onClick={handleSave} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Culture Setup"}
        </Button>
      </Box>
    </Box>
  );
}
