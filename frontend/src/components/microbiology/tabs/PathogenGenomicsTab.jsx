// tabs/PathogenGenomicsTab.jsx — Microbiology Tab 15: Pathogen Genomics
//
// Sequencing the ORGANISM, as distinct from Tab 8 (Molecular / NAAT), which
// detects a known pathogen at a specific target. Four sub-tabs, switched on by
// what the specimen ordered:
//
//   [ WGS ]  [ mNGS ]  [ TB — tNGS ]  [ Targeted panels ]
//
// Persistence: keyed by specimen_id, like every other analytical track in this
// module — "this K. pneumoniae from this urine is ST131 with blaNDM-1" is a
// property of that specimen of that case.
//
//   pathogen_genomics = { [specimen_id]: { wgs, mngs, tngs, targeted } }
//
// A sub-record is null unless the specimen ordered the matching test, so the
// sub-tab bar and the stored shape cannot disagree (see hydrateSpecimen).
//
// Send Preliminary dispatches a versioned entry into preliminary_reports with
// content_type "genomics". A tNGS result carrying MDR / pre-XDR / XDR-TB is
// flagged notifiable — public health, not the STAT-critical channel — which is
// the same notifiable flag Tab 8 uses for MTB detected on GeneXpert.

import React, { useEffect, useRef, useState } from "react";
import { Box, Typography, Button, TextField, CircularProgress } from "@mui/material";
import { MicRounded, StopRounded, AutoAwesomeRounded } from "@mui/icons-material";
import { C, FONT, FW_NORMAL, FW_LIGHT, inputSx, saveBtnSx, outlineBtnSx } from "../../shared/designTokens";
import { SectionBox } from "../../shared/FormComponents";
import { genomicsTestsFor, GENOMICS_SUBTABS, genotypingPanelsForTests, isMtbcSpecies } from "../constants";
import { hydrateSpecimen } from "./genomics/records";
// The summarizer lives with the other track summarizers so a preliminary and the
// printed report describe the same result identically (shared/resultSummaries.js).
import { summarizeGenomics } from "../shared/resultSummaries";
import { genexpertFromMolecular } from "../shared/genomics";
import { mergeGenomicsRecord } from "./genomics/dictation";
import { structurePathogenGenomics, TRANSCRIBE_URL } from "../shared/api";
import WgsPanel from "./genomics/WgsPanel";
import MngsPanel from "./genomics/MngsPanel";
import TngsPanel from "./genomics/TngsPanel";
import TargetedPanel from "./genomics/TargetedPanel";

const PANELS = {
  wgs: WgsPanel,
  mngs: MngsPanel,
  tngs: TngsPanel,
  targeted: TargetedPanel,
};

// TB classifications that trigger a public-health notification. The same list
// Tab 13 auto-detects on, so a dispatched preliminary and the infection-control
// flag cannot disagree.
const NOTIFIABLE_TB = ["MDR-TB", "pre-XDR-TB", "XDR-TB"];

// Per-sub-tab dictation copy. The heading and button name the panel the strip
// will fill, because the box targets whichever sub-tab is active rather than the
// tab as a whole; the placeholder shows the shape of a real result.
const DICTATION_COPY = {
  wgs: {
    label: "WGS",
    heading: "Dictate this specimen's WGS result",
    placeholder: 'e.g. "WGS of the K. pneumoniae isolate on MiSeq, ST131, blaNDM-1 carbapenem resistant, IncX3 plasmid, high confidence, concordant with AST". Autofill fills empty WGS fields only — a named determinant with no row is added as a new row, nothing already entered is overwritten or cleared.',
  },
  mngs: {
    label: "mNGS",
    heading: "Dictate this specimen's mNGS result",
    placeholder: 'e.g. "mNGS on BALF, host reads 92%, K. pneumoniae 4500 RPM significantly above background likely pathogen, CMV 60% genome coverage, blaKPC detected". Autofill fills empty mNGS fields only — a named hit with no row is added as a new row, nothing already entered is overwritten or cleared.',
  },
  tngs: {
    label: "tNGS",
    heading: "Dictate this specimen's tNGS result",
    placeholder: 'e.g. "Deeplex on the sputum, prior GeneXpert MTB detected with rifampicin resistance not detected, rpoB S450L rifampicin resistant WHO group 1, katG S315T isoniazid resistant, mean depth 120x, QC pass". Autofill fills empty tNGS fields only — the TB classification is derived from the calls, never dictated.',
  },
  targeted: {
    label: "Targeted Panel",
    heading: "Dictate this specimen's targeted panel result",
    placeholder: 'e.g. "carbapenemase gene panel by amplicon sequencing, blaNDM-1 meropenem resistant, high confidence". Autofill fills empty fields of the matching panel order only, and never switches an order’s panel — nothing already entered is overwritten or cleared.',
  },
};

// ─── Pathogen-genomics dictation + AI autofill (per specimen card) ────────────
// Mirrors Tab 3's per-card strip. One sequencing result is read and dictated in
// one pass, so the mic + transcript + autofill box sits on the specimen card and
// targets the ACTIVE sub-tab's record only — the model is sent that panel's
// shape, so it cannot cross-wire WGS keys into tNGS. Only EMPTY fields are
// filled: nothing already entered is overwritten or cleared, free lists
// union-add, enums snap to the panel's option list, and a dictated determinant
// with no row is appended. The derived fields (TB classification,
// heteroresistance, panel kind) are recomputed by the merge, never dictated.

function GenomicsDictation({ specimen, subKey, testsOrdered, getRecord, onApply }) {
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [notice, setNotice] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const copy = DICTATION_COPY[subKey] || DICTATION_COPY.wgs;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error("[PathogenGenomicsTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.onstop = async () => {
      setIsRecording(false);
      setIsTranscribing(true);
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      audioChunksRef.current = [];
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        const response = await fetch(TRANSCRIBE_URL, { method: "POST", body: formData });
        if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
        const data = await response.json();
        const text = data.text || data.transcription || "";
        if (text) setTranscript((current) => (current ? `${current} ${text}` : text));
        else setNotice("Nothing was heard — try again.");
      } catch (error) {
        console.error("[PathogenGenomicsTab] transcription:", error);
        setNotice("Genomics dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  const handleAutofill = async () => {
    const text = transcript.trim();
    if (!text || isAutofilling) return;
    setIsAutofilling(true);
    setNotice("");
    try {
      const record = getRecord() || {};
      // The targeted sub-tab holds one order per panel, so the model is told
      // which panels this specimen actually ordered — it may not invent one.
      const panels = subKey === "targeted"
        ? genotypingPanelsForTests(testsOrdered).map((p) => ({
            value: p.value, label: p.label, kind: p.kind, loci: p.loci, drugs: p.drugs,
          }))
        : [];

      const response = await structurePathogenGenomics({
        text,
        sub_tab: subKey,
        specimen: {
          specimen_type: specimen.specimen_type || "",
          site_of_collection: specimen.site_of_collection || "",
        },
        // WGS only: whether the MTBC-only TB block is currently live on the card.
        species_is_mtbc: subKey === "wgs" ? isMtbcSpecies(record.identified_species) : false,
        panels,
      });

      const { record: merged, applied, created, dropped, dropReason } = mergeGenomicsRecord(
        subKey, record, response?.data || {}, { panels }
      );
      onApply(merged);

      if (applied === 0 && created === 0) {
        setNotice(
          dropped > 0
            ? `Nothing was applied — ${dropReason}.`
            : "Dictation matched only fields that are already filled — nothing was overwritten."
        );
      } else {
        setNotice(
          `Applied ${applied} dictated value${applied === 1 ? "" : "s"} to empty fields`
          + (created > 0 ? ` — added ${created} new row${created === 1 ? "" : "s"}` : "")
          + (dropped > 0
            ? `. ${dropped} stated entr${dropped === 1 ? "y" : "ies"} ignored — ${dropReason}.`
            : ".")
        );
      }
    } catch (error) {
      console.error("[PathogenGenomicsTab] structure:", error);
      setNotice("Genomics dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const busy = isRecording || isTranscribing || isAutofilling;

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2.5 }}>
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
        {copy.heading}
      </Typography>
      <TextField
        multiline
        minRows={2}
        fullWidth
        size="small"
        placeholder={copy.placeholder}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        sx={{ ...inputSx, background: C.white }}
      />
      <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
        <Button
          sx={{
            ...outlineBtnSx,
            background: isRecording ? "#cf1322" : C.white,
            color: isRecording ? C.white : C.black,
            borderColor: isRecording ? "#cf1322" : C.black,
            "&:hover": { background: isRecording ? "#a8071a" : C.bgTertiary },
          }}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isTranscribing || isAutofilling}
        >
          {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          {isTranscribing ? "Transcribing..." : isRecording ? "Stop Recording" : "Record"}
        </Button>
        <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={busy || !transcript.trim()}>
          {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          AI Autofill Empty {copy.label} Fields
        </Button>
        {notice && (
          <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>
            {notice}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default function PathogenGenomicsTab({
  doctorId,
  doctorName,
  caseId,
  initialData,        // pathogen_genomics section: { [specimen_id]: { wgs, mngs, tngs, targeted } }
  preliminaryReports, // preliminary_reports section (for versioned dispatch)
  caseRegister,       // case_register (specimens + ordered tests)
  molecular,          // Tab 8 — read-only, so the tNGS panel can cross-check the
                      // prior GeneXpert it has transcribed against the real result
  onSave,             // (tabKey, data) dispatch — "pathogen-genomics" | "preliminary"
}) {
  const [blocks, setBlocks] = useState({});
  const [subTab, setSubTab] = useState({}); // specimen_id → active sub-tab key
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  // Latest block snapshot for the per-card autofill handlers, so a merge never
  // lands on the copy captured when the strip last rendered.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];

  // Only specimens carrying a genomics ordered test get a block. Hydration is
  // keyed on caseId (not initialData) so that saving does not wipe in-progress
  // edits — the workflow remounts the tab on case change instead.
  useEffect(() => {
    const hydrated = {};
    specimens.forEach((sp) => {
      if (genomicsTestsFor(sp.tests_ordered).length === 0) return;
      const saved = (initialData && initialData[sp.specimen_id]) || {};
      hydrated[sp.specimen_id] = hydrateSpecimen(saved, sp.tests_ordered);
    });
    setBlocks(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patchRecord = (specimenId, subKey, patch) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        [subKey]: { ...prev[specimenId][subKey], ...patch },
      },
    }));

  const saveGenomics = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("pathogen-genomics", blocks);
    } catch (err) {
      console.error("[PathogenGenomicsTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Send a versioned preliminary for one panel's record.
  const sendPreliminary = async (sp, subKey, rec) => {
    const summary = summarizeGenomics(subKey, rec);
    if (!summary) {
      setNotice("Record a result before sending a preliminary.");
      return;
    }
    const notifiable =
      subKey === "tngs" && NOTIFIABLE_TB.includes(rec.tb_classification || "");

    setNotice("");
    setIsSaving(true);
    try {
      const versions = Array.isArray(preliminaryReports?.versions)
        ? preliminaryReports.versions
        : [];
      const version = {
        version: versions.length + 1,
        source_tab: "Pathogen Genomics",
        content_type: "genomics",
        order_id: rec.order_id,
        specimen_id: sp.specimen_id,
        specimen_type: sp.specimen_type || "",
        sub_tab: subKey,
        dispatched_at: new Date().toISOString(),
        dispatched_by: doctorName || doctorId || "",
        summary,
        ...(notifiable
          ? {
              notifiable: true,
              notifiable_reason: `${rec.tb_classification} detected by tNGS — public-health notification required`,
            }
          : {}),
      };
      const base =
        preliminaryReports && typeof preliminaryReports === "object" ? preliminaryReports : {};
      await onSave("preliminary", { ...base, versions: [...versions, version] });
      patchRecord(sp.specimen_id, subKey, {
        prelim: {
          version: version.version,
          dispatched_at: version.dispatched_at,
          notifiable,
        },
      });
    } catch (err) {
      console.error("[PathogenGenomicsTab] preliminary dispatch error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const activeSpecimens = specimens.filter((sp) => genomicsTestsFor(sp.tests_ordered).length > 0);

  if (activeSpecimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          No pathogen genomics ordered. Add a WGS, mNGS, tNGS-TB, amplicon ID or
          resistance-genotyping test to a specimen in Registration &amp; Accession.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Sequencing of the organism itself — species, strain type and resistance
        determinants. Genomic resistance is always reported as <b>predicted</b>;
        phenotypic AST remains the reference and any disagreement is recorded on the
        record rather than resolved silently.
      </Typography>

      {activeSpecimens.map((sp, i) => {
        const block = blocks[sp.specimen_id] || {};
        // Sub-tabs the specimen actually ordered — a record exists for exactly these.
        const available = GENOMICS_SUBTABS.filter((st) => block[st.key]);
        if (available.length === 0) return null;
        const currentKey = available.some((st) => st.key === subTab[sp.specimen_id])
          ? subTab[sp.specimen_id]
          : available[0].key;
        const current = available.find((st) => st.key === currentKey);
        const Panel = PANELS[currentKey];
        const rec = block[currentKey];

        // WGS / mNGS / tNGS are one assay per specimen, so the panel dispatches
        // its own record. The targeted sub-tab holds an orders[] array, so it
        // dispatches one order out of it and names which.
        const panelProps =
          currentKey === "targeted"
            ? { onSendPreliminary: (order) => sendPreliminary(sp, currentKey, order) }
            : { onSendPreliminary: () => sendPreliminary(sp, currentKey, rec) };

        return (
          <SectionBox
            key={sp.specimen_id}
            title={`Specimen ${i + 1} — ${sp.specimen_type || "Unspecified"} · ${sp.specimen_id}`}
          >
            {/* Sub-tab bar — 5A/5B/5C pattern from Culture Workup */}
            <Box sx={{ display: "flex", gap: 0, mb: 2, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
              {available.map((st) => {
                const on = st.key === currentKey;
                return (
                  <Box
                    key={st.key}
                    onClick={() => setSubTab((p) => ({ ...p, [sp.specimen_id]: st.key }))}
                    sx={{
                      px: 2.5, py: 1.25, cursor: "pointer",
                      borderBottom: on ? `2px solid ${C.black}` : "2px solid transparent",
                      background: on ? C.bgSecondary : "transparent",
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 12.5, fontFamily: FONT,
                        color: on ? C.textPrimary : C.textMuted,
                        fontWeight: on ? FW_NORMAL : FW_LIGHT,
                      }}
                    >
                      {st.label}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            {/* Dictation fills the record of whichever sub-tab is active, so the
                strip is keyed on the sub-tab: switching sub-tabs starts a fresh
                transcript rather than carrying one panel's words into another. */}
            <GenomicsDictation
              key={`dictation-${sp.specimen_id}-${currentKey}`}
              specimen={sp}
              subKey={currentKey}
              testsOrdered={sp.tests_ordered}
              getRecord={() => (blocksRef.current[sp.specimen_id] || {})[currentKey]}
              onApply={(merged) => patchRecord(sp.specimen_id, currentKey, merged)}
            />

            {current && (
              <Panel
                record={rec}
                onPatch={(patch) => patchRecord(sp.specimen_id, currentKey, patch)}
                isSaving={isSaving}
                testsOrdered={sp.tests_ordered}
                tab8Genexpert={genexpertFromMolecular(molecular, sp.specimen_id)}
                {...panelProps}
              />
            )}
          </SectionBox>
        );
      })}

      {notice && (
        <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>
            {notice}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1 }}>
        <Button onClick={saveGenomics} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Pathogen Genomics"}
        </Button>
      </Box>
    </Box>
  );
}
