// tabs/SpecimenProcessingTab.jsx — Microbiology Tab 2: Specimen processing & triage
//
// The bench-dispatch step. For each specimen registered in Tab 1 (read-only
// reference), the technologist records how it was processed: containment, media
// inoculated, atmosphere, incubation, and — for the parallel tracks — blood-culture
// bottles and the parasitology slide preparation panel.
//
// Stored as specimen_processing = { [specimen_id]: { …record } } — keyed by the
// registration specimen_id so downstream tabs (Tab 3 direct exam, Tab 4 culture
// setup) fetch their own specimen's record by id.
//
// Which sub-panels appear on a specimen's card is derived from that specimen's
// ordered tests (case type activation/suppression resolves there), not stored here:
//   • culture media groups      ← tests culture_aerobic / culture_anaerobic /
//                                  lj_mgit_culture / fungal_culture
//   • blood-culture bottle panel ← blood_culture test (CLSI M47)
//   • parasitology prep panel   ← parasitology test values (no incubation fields)
//   • PGx receipt check         ← pgx_panel / hla_typing / g6pd (no culture at all)
//
// The derivation is per specimen, never per case. That is what makes a Combined
// case work with no special rule: a PGx blood tube and a urine culture registered
// on one case are two specimens, so each card carries only its own panel. Deriving
// from the case type instead would leave a PGx sample riding along with infection
// work with no receipt check at all — which is the case that needs it most.

import React, { useEffect, useRef, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
} from "@mui/material";
import {
  DeleteOutlineRounded, MicRounded, StopRounded, AutoAwesomeRounded,
} from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  FieldLabel, Sel, CbxGroup,
} from "../../shared/FormComponents";
import {
  CONTAINMENT_OPTIONS,
  MEDIA_GROUPS,
  MEDIA_GROUP_TEST_TRIGGERS,
  INOCULATION_METHOD_OPTIONS,
  ATMOSPHERE_OPTIONS,
  INDICATOR_COLOUR_OPTIONS,
  TEMPERATURE_OPTIONS,
  BLOOD_BOTTLE_TYPE_OPTIONS,
  BLOOD_MONITOR_OPTIONS,
  PARASITOLOGY_TEST_VALUES,
  PARASITE_PREP_METHOD_OPTIONS,
  SLIDE_TYPE_OPTIONS,
  PGX_TUBE_OPTIONS,
  PGX_INTEGRITY_ISSUES,
  PGX_STORAGE_OPTIONS,
  pgxTestsFor,
  YES_NO_UNKNOWN_OPTIONS,
} from "../constants";
import { FLAG_COLOR } from "./genomics/fields";
import { structureProcessing, TRANSCRIBE_URL } from "../shared/api";

const gridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0, 1fr))" },
  gap: 2,
};

// ─── Derivation helpers (pure; nothing stored here is repeated) ──────────────

const toArray = (v) => (Array.isArray(v) ? v : []);

// Culture media groups offered for a specimen, from its ordered tests.
const mediaGroupsFor = (tests) =>
  MEDIA_GROUPS.filter((g) =>
    (MEDIA_GROUP_TEST_TRIGGERS[g.key] || []).some((tv) => tests.includes(tv))
  );

const isParasitology = (tests) => tests.some((t) => PARASITOLOGY_TEST_VALUES.includes(t));

const isBloodCulture = (sp) =>
  toArray(sp.tests_ordered).includes("blood_culture") ||
  /blood culture/i.test(sp.specimen_type || "");

// Auto containment per CLSI M29-A4: BSC for AFB work-up, BALF, CSF.
const suggestContainment = (sp) => {
  const tests = toArray(sp.tests_ordered);
  const type = (sp.specimen_type || "").toLowerCase();
  if (tests.includes("lj_mgit_culture") || tests.includes("afb_smear") || /balf/.test(type) || /cerebrospinal|csf/.test(type)) {
    return "BSC required";
  }
  return "Routine bench";
};

// Default media for a urine / wound / generic aerobic culture specimen.
const suggestBacteriologyMedia = (sp) => {
  const type = (sp.specimen_type || "").toLowerCase();
  const site = (sp.site_of_collection || "").toLowerCase();
  if (/urine/.test(type)) return ["CLED agar", "Blood agar (BA)"];
  if (/pus|wound|abscess/.test(type) || /aspirate|collection/.test(site)) return ["Blood agar (BA)", "Chocolate agar (CHOC)", "MacConkey agar (MAC)"];
  if (/stool/.test(type)) return ["MacConkey agar (MAC)", "Blood agar (BA)"];
  if (/cerebrospinal|csf/.test(type)) return ["Blood agar (BA)", "Chocolate agar (CHOC)"];
  if (/sputum|balf|bronchoalveolar/.test(type)) return ["Blood agar (BA)", "Chocolate agar (CHOC)", "MacConkey agar (MAC)"];
  return ["Blood agar (BA)", "Chocolate agar (CHOC)", "MacConkey agar (MAC)"];
};

// Media defaults across EVERY active media group, not just bacteriology. Which
// groups are active comes from the ordered tests (mediaGroupsFor), and the final
// list is intersected with the options actually offered on the card — so a default
// can never propose a plate from an inactive track, or a plate the card cannot
// hold. Sets are standard primary plates per group; selective/exotic additions
// are left to the bench (a suggestion is trimmed before saving, never overwritten).
const suggestMediaDefaults = (sp, mediaGroups) => {
  const type = (sp.specimen_type || "").toLowerCase();
  const has = (key) => mediaGroups.some((g) => g.key === key);
  const want = [];
  if (has("bacteriology")) want.push(...suggestBacteriologyMedia(sp));
  if (has("anaerobic")) {
    // Standard anaerobic primary set (CLSI M11 practice): an anaerobic blood agar
    // plus the selective KVLB (Bacteroides/Prevotella) and PEA (facultative
    // suppressant) for mixed-flora sites. Cooked-meat broth stays an enrichment the
    // bench adds only when needed.
    want.push(
      "Anaerobic blood agar (Brucella / CDC base)",
      "Phenylethyl alcohol agar (PEA)",
      "Kanamycin-Vancomycin Laked Blood (KVLB)"
    );
  }
  if (has("mycobacteriology")) {
    // RNTCP dual primary: solid LJ + liquid MGIT.
    want.push("Löwenstein-Jensen (LJ) slope", "MGIT tube");
  }
  if (has("mycology")) {
    // Plain SDA is never wrong for a fungal culture; extra plates follow the most
    // likely agent from the specimen/site rather than guessing broadly.
    if (/urine|genital|vaginal/.test(type) || /blood/.test(type) || /stool/.test(type)) {
      want.push("Sabouraud Dextrose Agar (SDA)", "Chromogenic Candida agar (CHROMagar)");
    } else if (/sputum|balf|bronchoalveolar|respirator|throat/.test(type)) {
      want.push("Sabouraud Dextrose Agar (SDA)", "SDA with antibiotics (Mycosel)");
    } else if (/skin|nail|hair|scalp|scraping/.test(type)) {
      want.push("Sabouraud Dextrose Agar (SDA)", "SDA with antibiotics (Mycosel)");
    } else if (/tissue|biopsy|bone/.test(type)) {
      want.push("Sabouraud Dextrose Agar (SDA)", "Brain Heart Infusion (BHI) agar");
    } else {
      want.push("Sabouraud Dextrose Agar (SDA)");
    }
  }
  const offered = mediaGroups.flatMap((g) => g.options);
  return [...new Set(want)].filter((m) => offered.includes(m));
};

// Expected-first-read line, auto-calculated from the specimen's culture track
// (CLSI M47 read windows / weekly AFB / fungal / anaerobic schedules). Read-only:
// the actual read schedule is formalised later in Tab 4.
const expectedFirstRead = (sp) => {
  const tests = toArray(sp.tests_ordered);
  const type = (sp.specimen_type || "").toLowerCase();
  const lines = [];
  if (tests.includes("lj_mgit_culture") || tests.includes("afb_smear")) {
    lines.push("AFB: weekly reads, up to 8 weeks (LJ)");
  }
  if (tests.includes("fungal_culture")) {
    lines.push("Fungal: 48 h first check, then weekly up to 4 weeks");
  }
  if (tests.includes("culture_anaerobic")) {
    lines.push("Anaerobic: 48 h minimum — jar must not open before 48 h");
  }
  if (isBloodCulture(sp)) {
    lines.push("Blood culture: continuous monitor up to 5 days");
  }
  if (tests.includes("culture_aerobic")) {
    if (/urine/.test(type)) lines.push("Urine culture: 24 h, 48 h");
    else if (/cerebrospinal|csf|fluid/.test(type)) lines.push("Sterile fluid culture: 24 h, 48 h, 72 h");
    else lines.push("Aerobic culture: 24 h, 48 h, 72 h");
  }
  if (isParasitology(tests)) lines.push("Parasitology: same-session slide read (no incubation)");
  return lines.length ? lines.join(" · ") : "";
};

// ─── Per-specimen blank record ────────────────────────────────────────────────

const blankSlide = () => ({ slide_type: "", count: "" });

const blankRecordFor = (sp) => ({
  specimen_id: sp.specimen_id,
  processed_at: "",
  tech_name: "",
  containment_level: suggestContainment(sp),
  media: [],
  media_lot: "",
  media_expiry: "",
  inoculation_method: "",
  atmosphere: "",
  anaerobic_indicator_lot: "",
  anaerobic_indicator_colour: "",
  incubation_temperature: "",
  incubation_started_at: "",
  blood_culture: {
    bottle_type: "",
    bottle_lot: "",
    bottle_expiry: "",
    monitor_system: "",
    incubator_bay: "",
    loaded_at: "",
  },
  parasite_prep: {
    methods: [],
    performed_by: "",
    prepared_at: "",
    slides: [blankSlide()],
  },
  // Receipt check for a PGx specimen (no culture track). Asked at the bench, never
  // autofilled: this is a safety check, and a check answered by a model from a
  // transcript is worse than no check. Kept out of `panels` below for that reason.
  pgx_receipt: {
    tube_type: "",
    integrity_issues: [],
    transfusion_recent: "",
    transplant: "",
    hold: "",
    note: "",
  },
});

// Merge a saved record over the blank so an old section hydrates fully.
const hydrateRecord = (sp, saved = {}) => {
  const base = blankRecordFor(sp);
  const rec = { ...base, ...(saved || {}) };
  rec.blood_culture = { ...base.blood_culture, ...((saved && saved.blood_culture) || {}) };
  rec.parasite_prep = { ...base.parasite_prep, ...((saved && saved.parasite_prep) || {}) };
  rec.parasite_prep.methods = Array.isArray(rec.parasite_prep.methods) ? rec.parasite_prep.methods : [];
  rec.parasite_prep.slides = Array.isArray(rec.parasite_prep.slides) && rec.parasite_prep.slides.length
    ? rec.parasite_prep.slides
    : [blankSlide()];
  rec.pgx_receipt = { ...base.pgx_receipt, ...((saved && saved.pgx_receipt) || {}) };
  rec.pgx_receipt.integrity_issues = Array.isArray(rec.pgx_receipt.integrity_issues)
    ? rec.pgx_receipt.integrity_issues
    : [];
  rec.media = Array.isArray(rec.media) ? rec.media : [];
  return rec;
};

// Display label for an ordered-test value.
const testLabel = (value) =>
  ({ gram_stain: "Gram stain", afb_smear: "AFB smear", koh_calcofluor: "KOH / Calcofluor", india_ink: "India ink", wet_prep: "Wet prep", ova_parasite_exam: "O+P exam", blood_film: "Thick / thin film", concentration_technique: "Concentration", permanent_stain: "Permanent stain", culture_aerobic: "Culture (aerobic)", culture_anaerobic: "Anaerobic culture", blood_culture: "Blood culture", fungal_culture: "Fungal culture", lj_mgit_culture: "LJ / MGIT culture", ast: "Sensitivity (AST)", gene_xpert: "GeneXpert MTB/RIF", naat_pcr: "Targeted PCR", viral_pcr: "Viral PCR", fungal_pcr: "Fungal PCR", parasite_pcr: "Parasite PCR", serology_panel: "Serology", virology_serology: "Virology serology", fungal_antigen: "Fungal antigen", parasite_antigen: "Parasite antigen", hiv_hepatitis_serology: "HIV / Hep serology", dengue_serology: "Dengue serology" }[value] || value);

// ─── Speech-to-text dictation + AI autofill (per specimen card) ──────────────
// A bench record is dictated per specimen (process one specimen, dictate it), so
// the mic + transcript + autofill strip lives on each card and targets that card's
// record only — there is no cross-card routing. A card's shape varies (culture
// dispatch vs blood-culture bottle vs anaerobic jar vs parasitology slide-prep),
// so the request sends the card's live panels + offered media options and the
// model returns only fields the card can hold. The merge fills EMPTY fields only —
// nothing already entered is overwritten or cleared. Media and parasite-prep
// methods are union-added; parasite slides fill the first matching/blank slide row
// or append a new one. Mirrors RegistrationTab's specimen autofill.

const cleanText = (value) => (value === undefined || value === null ? "" : String(value).trim());

const canon = (s) => cleanText(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Snap free-text dictation to a real option (normalized exact match, then a
// contained-substring fallback). Returns "" when nothing matches.
const coerceEnum = (value, options) => {
  const target = canon(value);
  if (!target) return "";
  return (
    options.find((o) => canon(o) === target)
    || options.find((o) => {
      const c = canon(o);
      return c.length >= 3 && (target.includes(c) || c.includes(target));
    })
    || ""
  );
};

// A datetime-local input only accepts YYYY-MM-DDTHH:MM — normalize what the model
// returned; "" when it isn't a datetime, so a malformed value is dropped.
const toDateTimeLocal = (value) => {
  const m = cleanText(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}`;
};

// A date input accepts YYYY-MM-DD only; normalize similarly.
const toDate = (value) => {
  const m = cleanText(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
};

// Merge a single structure response into ONE specimen's processing record. Only
// fields that are empty on the card are written; the incoming key set was already
// restricted to the card's live panels by the backend prompt, and coerce steps
// here keep every <Select>/<input> within the options its type accepts.
const mergeProcessing = (record, incoming, panels = {}) => {
  const src = (incoming && typeof incoming === "object") ? incoming : {};
  const has = (target, key) => cleanText(target[key]) !== "";
  let applied = 0;

  const put = (target, key, raw) => {
    if (has(target, key)) return;
    const val = cleanText(raw);
    if (!val) return;
    target[key] = val;
    applied += 1;
  };
  const putEnum = (target, key, raw, options) => {
    if (has(target, key)) return;
    const snap = coerceEnum(raw, options);
    if (!snap) return;
    target[key] = snap;
    applied += 1;
  };
  const putDate = (target, key, raw) => {
    if (has(target, key)) return;
    const v = toDate(raw);
    if (!v) return;
    target[key] = v;
    applied += 1;
  };
  const putDateTime = (target, key, raw) => {
    if (has(target, key)) return;
    const v = toDateTimeLocal(raw);
    if (!v) return;
    target[key] = v;
    applied += 1;
  };

  const next = {
    ...record,
    blood_culture: { ...(record.blood_culture || {}) },
    parasite_prep: { ...(record.parasite_prep || {}) },
    media: Array.isArray(record.media) ? [...record.media] : [],
  };
  next.parasite_prep.methods = Array.isArray(record.parasite_prep.methods)
    ? [...record.parasite_prep.methods]
    : [];
  next.parasite_prep.slides = Array.isArray(record.parasite_prep.slides)
    ? record.parasite_prep.slides.map((s) => ({ ...s }))
    : [];

  // Always-on fields. Tech / performed-by identity is deliberately not autofilled
  // (staff identity belongs to the application) and the backend never returns it.
  putDateTime(next, "processed_at", src.processed_at);
  put(next, "notes", src.notes);

  // Common dispatch row (containment is suppressed on parasitology cards).
  putEnum(next, "containment_level", src.containment_level, CONTAINMENT_OPTIONS);

  // Culture dispatch: media (restricted to the options actually offered on the
  // card), remarks, lot/expiry, inoculation, atmosphere, incubation.
  const mediaOptions = Array.isArray(panels.media_options) ? panels.media_options : [];
  (Array.isArray(src.media) ? src.media : []).forEach((m) => {
    const snap = coerceEnum(m, mediaOptions);
    if (!snap || next.media.includes(snap)) return;
    next.media.push(snap);
    applied += 1;
  });
  put(next, "media_remarks", src.media_remarks);
  put(next, "media_lot", src.media_lot);
  putDate(next, "media_expiry", src.media_expiry);
  putEnum(next, "inoculation_method", src.inoculation_method, INOCULATION_METHOD_OPTIONS);
  putEnum(next, "atmosphere", src.atmosphere, ATMOSPHERE_OPTIONS);
  putEnum(next, "incubation_temperature", src.incubation_temperature, TEMPERATURE_OPTIONS);
  putDateTime(next, "incubation_started_at", src.incubation_started_at);

  // Anaerobic jar integrity.
  put(next, "anaerobic_indicator_lot", src.anaerobic_indicator_lot);
  putEnum(next, "anaerobic_indicator_colour", src.anaerobic_indicator_colour, INDICATOR_COLOUR_OPTIONS);

  // Blood-culture bottle block.
  const bc = (src.blood_culture && typeof src.blood_culture === "object") ? src.blood_culture : {};
  putEnum(next.blood_culture, "bottle_type", bc.bottle_type, BLOOD_BOTTLE_TYPE_OPTIONS);
  put(next.blood_culture, "bottle_lot", bc.bottle_lot);
  putDate(next.blood_culture, "bottle_expiry", bc.bottle_expiry);
  putEnum(next.blood_culture, "monitor_system", bc.monitor_system, BLOOD_MONITOR_OPTIONS);
  put(next.blood_culture, "incubator_bay", bc.incubator_bay);
  putDateTime(next.blood_culture, "loaded_at", bc.loaded_at);

  // Parasitology slide-preparation block.
  const pp = (src.parasite_prep && typeof src.parasite_prep === "object") ? src.parasite_prep : {};
  (Array.isArray(pp.methods) ? pp.methods : []).forEach((m) => {
    const snap = coerceEnum(m, PARASITE_PREP_METHOD_OPTIONS);
    if (!snap || next.parasite_prep.methods.includes(snap)) return;
    next.parasite_prep.methods.push(snap);
    applied += 1;
  });
  putDateTime(next.parasite_prep, "prepared_at", pp.prepared_at);

  // Slides: one record never filled twice in a single pass. A dictated slide goes
  // to the first slide row already of that type, else the first blank row, else a
  // new row is appended.
  if (Array.isArray(pp.slides)) {
    const used = new Set();
    pp.slides.forEach((slide) => {
      const type = coerceEnum(slide && slide.slide_type, SLIDE_TYPE_OPTIONS);
      if (!type) return;
      let idx = next.parasite_prep.slides.findIndex((s, i) => !used.has(i) && s.slide_type === type);
      if (idx === -1) idx = next.parasite_prep.slides.findIndex((s, i) => !used.has(i) && !cleanText(s.slide_type));
      if (idx === -1) {
        next.parasite_prep.slides.push(blankSlide());
        idx = next.parasite_prep.slides.length - 1;
      }
      used.add(idx);
      const row = next.parasite_prep.slides[idx];
      if (!row.slide_type) { row.slide_type = type; applied += 1; }
      const count = cleanText(slide && slide.count);
      if (!row.count && count) { row.count = count; applied += 1; }
    });
  }

  return { record: next, applied };
};

// Deterministic SOP defaults for a card's still-empty decision fields, derived
// from specimen type + ordered tests (CLSI-style rules — the same intent as the
// auto-suggested containment at record creation, extended across the dispatch
// row). Not an LLM: nothing here is invented, and physical-observation fields
// (media/bottle/indicator lots, expiries, incubator bay), identity and real
// timestamps are deliberately never defaulted. Returns the partial record to
// merge (fill-empty semantics) plus human-readable parts for a preview line.
const defaultCandidates = (sp, panels, record) => {
  const tests = toArray(sp.tests_ordered);
  const rec = record || {};
  const empty = (v) => cleanText(v) === "";
  const incoming = {};
  const parts = [];
  const mediaGroups = mediaGroupsFor(tests);
  const hasFungal = mediaGroups.some((g) => g.key === "mycology");

  if (panels.containment && empty(rec.containment_level)) {
    incoming.containment_level = suggestContainment(sp);
    parts.push(`containment ${incoming.containment_level}`);
  }
  if (panels.culture) {
    if (empty(rec.inoculation_method)) {
      incoming.inoculation_method = "Loop";
      parts.push("inoculation Loop");
    }
    if (empty(rec.atmosphere)) {
      incoming.atmosphere = tests.includes("culture_anaerobic") ? "Anaerobic jar / chamber" : "Aerobic";
      parts.push(`atmosphere ${incoming.atmosphere}`);
    }
    if (empty(rec.incubation_temperature)) {
      incoming.incubation_temperature = hasFungal ? "30 °C" : "35–37 °C";
      parts.push(`temperature ${incoming.incubation_temperature}`);
    }
  }
  if (panels.media && (!Array.isArray(rec.media) || rec.media.length === 0)) {
    const defaults = suggestMediaDefaults(sp, mediaGroups);
    if (defaults.length) {
      incoming.media = defaults;
      parts.push(`media ${defaults.join(" + ")}`);
    }
  }
  if (panels.blood_culture && empty((rec.blood_culture || {}).bottle_type)) {
    incoming.blood_culture = {
      bottle_type: /anaerobic bottle/i.test(sp.specimen_type || "") ? "Anaerobic" : "Aerobic",
    };
    parts.push(`bottle ${incoming.blood_culture.bottle_type}`);
  }
  if (panels.parasitology) {
    const methods = (rec.parasite_prep || {}).methods || [];
    const wants = [];
    if (tests.includes("ova_parasite_exam") || tests.includes("concentration_technique")) {
      wants.push("Formol-ether concentration (FEC)");
    }
    if (tests.includes("permanent_stain")) {
      wants.push("Permanent stain (trichrome / iron haematoxylin)");
    }
    if (tests.includes("blood_film")) {
      wants.push("Thick blood film preparation", "Thin blood film preparation", "Giemsa staining");
    }
    if ((!Array.isArray(methods) || methods.length === 0) && wants.length) {
      incoming.parasite_prep = { methods: wants };
      parts.push(`prep ${wants.join(" + ")}`);
    }
  }
  return { hasAny: parts.length > 0, incoming, parts };
};

// Self-contained mic + transcript + autofill strip for one specimen card. Each
// instance owns its recorder/autofill state (self-contained per the shared
// transcribe reference — no recorder abstraction). getRecord() returns the latest
// record snapshot (via a parent ref) so a merge never lands on a stale copy.
function SpecimenDictation({ specimen, panels, getRecord, onApply }) {
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [notice, setNotice] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

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
      console.error("[SpecimenProcessing] microphone:", error);
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
        console.error("[SpecimenProcessing] transcription:", error);
        setNotice("Processing dictation transcription failed.");
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
      const response = await structureProcessing({
        text,
        specimen: {
          specimen_type: specimen.specimen_type || "",
          site_of_collection: specimen.site_of_collection || "",
        },
        panels,
      });
      const data = response?.data || {};
      const { record: merged, applied } = mergeProcessing(getRecord(), data, panels);
      onApply(merged);
      if (applied === 0) {
        setNotice("Dictation matched only fields that are already filled — nothing was overwritten.");
      } else {
        setNotice(`Applied ${applied} dictated value${applied === 1 ? "" : "s"} to empty fields.`);
      }
    } catch (error) {
      console.error("[SpecimenProcessing] structure:", error);
      setNotice("Processing dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const busy = isRecording || isTranscribing || isAutofilling;

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2.5 }}>
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
        Dictate this specimen's processing
      </Typography>
      <TextField
        multiline
        minRows={2}
        fullWidth
        size="small"
        placeholder="e.g. set up at 8 am on CLED and blood agar, loop inoculation, aerobic, 37 °C, media lot A1 expiry today; or for a parasite slide card: two thick films and one thin film made after formol-ether concentration."
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
          AI Autofill Empty Fields
        </Button>
        {notice && (
          <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        )}
      </Box>
    </Box>
  );
}

// One-line SOP-default preview + Apply for a card's still-empty decision fields.
// Renders only while there is something to apply (or a just-applied confirmation);
// after Apply it reads the freshest record via getRecord() so the merge lands on
// current state. Nothing is written until Apply is pressed.
function SuggestedDefaultsRow({ sp, panels, record, getRecord, onApply }) {
  const [applied, setApplied] = useState("");
  const cand = defaultCandidates(sp, panels, record);
  if (!cand.hasAny && !applied) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 2.5 }}>
      <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted }}>
        {applied && !cand.hasAny
          ? applied
          : `Suggested defaults — ${cand.parts.join(" · ")}`}
      </Typography>
      {cand.hasAny && (
        <Button
          size="small"
          sx={{ ...outlineBtnSx, py: 0.4, px: 1.5, fontSize: 11 }}
          onClick={() => {
            const current = getRecord();
            const c = defaultCandidates(sp, panels, current);
            if (!c.hasAny) return;
            const { record: merged, applied: n } = mergeProcessing(current, c.incoming, panels);
            onApply(merged);
            setApplied(n ? `Applied ${n} suggested default${n === 1 ? "" : "s"}.` : "");
          }}
        >
          Apply
        </Button>
      )}
    </Box>
  );
}

export default function SpecimenProcessingTab({
  caseId,
  initialData,          // specimen_processing section: { [specimen_id]: record }
  caseRegister,         // case_register (has .case_type and .specimens)
  onSave,
}) {
  const [records, setRecords] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  // Latest records snapshot for the per-card autofill handlers, so a merge that
  // resolves after an await always reads current values (never a stale copy).
  const recordsRef = useRef(records);
  recordsRef.current = records;

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];

  // Hydrate once when the case changes (remount also resets via key upstream).
  useEffect(() => {
    const saved = (initialData && typeof initialData === "object") ? initialData : {};
    const hydrated = {};
    specimens.forEach((sp) => { hydrated[sp.specimen_id] = hydrateRecord(sp, saved[sp.specimen_id]); });
    setRecords(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patch = (specimenId, patchObj) =>
    setRecords((prev) => ({ ...prev, [specimenId]: { ...prev[specimenId], ...patchObj } }));

  const patchNested = (specimenId, group, patchObj) =>
    setRecords((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        [group]: { ...prev[specimenId][group], ...patchObj },
      },
    }));

  // Whole-record replace for the dictation autofill (the merge already fills
  // empty fields only, so a replace cannot clobber manual entries).
  const replaceRecord = (specimenId, record) =>
    setRecords((prev) => ({ ...prev, [specimenId]: record }));

  const handleSave = async () => {
    setNotice("");
    setIsSaving(true);
    try {
      await onSave("processing", records);
    } catch (err) {
      console.error("[SpecimenProcessingTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (specimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          No specimens registered. Add specimens in Registration & Accession first.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {specimens.map((sp, i) => {
        const rec = records[sp.specimen_id] || blankRecordFor(sp);
        const tests = toArray(sp.tests_ordered);
        const mediaGroups = mediaGroupsFor(tests);
        const parasitology = isParasitology(tests);
        const bloodCulture = isBloodCulture(sp);
        const anaerobicCulture = tests.includes("culture_anaerobic");
        const anyCultureTrack = mediaGroups.length > 0 || bloodCulture;
        // PGx is a track like any other here: it is read off THIS specimen's tests,
        // so a PGx tube sharing a case with a culture still gets its own card.
        const pgx = pgxTestsFor(tests).length > 0;
        const receipt = rec.pgx_receipt;
        // A container the lab cannot rescue, or a sample that may not be the
        // patient's own. Both are derived, never stored, so the mark cannot
        // disagree with the fields that produced it.
        const tubeStop = PGX_TUBE_OPTIONS.find((o) => o.value === receipt.tube_type && !o.ok);
        const donorRisk = ["transfusion_recent", "transplant"].some(
          (k) => receipt[k] === "Yes" || receipt[k] === "Unknown"
        );
        const pgxFlagged = Boolean(tubeStop) || donorRisk;
        // Containment is about aerosol risk when handling infected material, and a
        // blood tube drawn for a genotype has none — so it is dropped, but only on a
        // specimen whose ONLY track is PGx. A specimen that also carries a culture
        // keeps it, which is the case that would otherwise lose a real field.
        const pgxOnly = pgx && !anyCultureTrack;
        // Live panels of this card — exactly what the autofill request must send so
        // the structure prompt only targets fields this card can actually hold.
        // `pgx_receipt` is deliberately absent: the receipt check is a safety check,
        // so it is filled by the bench and never by the autofill.
        const panels = {
          containment: !parasitology && !pgxOnly,
          media: mediaGroups.length > 0,
          culture: anyCultureTrack,
          blood_culture: bloodCulture,
          anaerobic: anaerobicCulture,
          parasitology,
          media_options: mediaGroups.flatMap((g) => g.options),
        };

        return (
          <Box key={sp.specimen_id} sx={{ border: `1px solid ${C.border}`, mb: 2.5, background: C.white }}>
            {/* Card header: read-only specimen reference from Tab 1 */}
            <Box sx={{ px: 2, py: 1.25, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
              <Box>
                <Typography sx={{ fontFamily: FONT, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textSecond }}>
                  Specimen {i + 1} · {sp.specimen_type || "Unspecified type"}
                </Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.25 }}>
                  {sp.specimen_id}{sp.site_of_collection ? ` · ${sp.site_of_collection}` : ""}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {tests.map((t) => (
                  <Typography key={t} sx={{ px: 1, py: 0.2, border: `1px solid ${C.border}`, fontSize: 10, fontFamily: FONT, color: C.textSecond }}>
                    {testLabel(t)}
                  </Typography>
                ))}
              </Box>
            </Box>

            <Box sx={{ p: 2 }}>
              {/* Per-card dictation → fills empty fields of this specimen's record */}
              <SpecimenDictation
                specimen={sp}
                panels={panels}
                getRecord={() => recordsRef.current[sp.specimen_id] || rec}
                onApply={(merged) => replaceRecord(sp.specimen_id, merged)}
              />

              {/* SOP defaults (specimen type + ordered tests) → still-empty decision fields */}
              <SuggestedDefaultsRow
                sp={sp}
                panels={panels}
                record={rec}
                getRecord={() => recordsRef.current[sp.specimen_id] || rec}
                onApply={(merged) => replaceRecord(sp.specimen_id, merged)}
              />

              {/* Processed-by / containment row */}
              <Box sx={gridSx}>
                <Box>
                  <FieldLabel>Technologist</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} value={rec.tech_name} onChange={(e) => patch(sp.specimen_id, { tech_name: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Processing datetime</FieldLabel>
                  <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={rec.processed_at} onChange={(e) => patch(sp.specimen_id, { processed_at: e.target.value })} InputLabelProps={{ shrink: true }} />
                </Box>
                {!parasitology && (
                  <Box>
                    <FieldLabel>Containment (CLSI M29-A4)</FieldLabel>
                    <Sel label="Containment" options={CONTAINMENT_OPTIONS} value={rec.containment_level} onChange={(v) => patch(sp.specimen_id, { containment_level: v })} />
                  </Box>
                )}
              </Box>

              {/* ── Culture dispatch ── */}
              {anyCultureTrack ? (
                <Box sx={{ mt: 2.5, border: `1px solid ${C.border}`, p: 2 }}>
                  <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1.5 }}>
                    Culture dispatch
                  </Typography>

                  {mediaGroups.length > 0 && (
                    <Box sx={{ mb: 1.5 }}>
                      <FieldLabel>Media inoculated</FieldLabel>
                      {mediaGroups.map((g) => (
                        <Box key={g.key} sx={{ mb: 0.75 }}>
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
                      <TextField size="small" fullWidth sx={{ ...inputSx, mt: 1 }} placeholder="Other media / remarks" value={rec.media_remarks || ""} onChange={(e) => patch(sp.specimen_id, { media_remarks: e.target.value })} />
                    </Box>
                  )}

                  {bloodCulture && (
                    <Box sx={{ mb: 1.5, border: `1px solid ${C.border}`, p: 1.5, background: C.bgTertiary }}>
                      <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}>
                        Blood culture bottle (CLSI M47)
                      </Typography>
                      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                        <Box>
                          <FieldLabel>Bottle type</FieldLabel>
                          <Sel label="Bottle type" options={BLOOD_BOTTLE_TYPE_OPTIONS} value={rec.blood_culture.bottle_type} onChange={(v) => patchNested(sp.specimen_id, "blood_culture", { bottle_type: v })} />
                        </Box>
                        <Box>
                          <FieldLabel>Monitor system</FieldLabel>
                          <Sel label="Monitor" options={BLOOD_MONITOR_OPTIONS} value={rec.blood_culture.monitor_system} onChange={(v) => patchNested(sp.specimen_id, "blood_culture", { monitor_system: v })} />
                        </Box>
                        <Box>
                          <FieldLabel>Incubator bay</FieldLabel>
                          <TextField size="small" fullWidth sx={inputSx} value={rec.blood_culture.incubator_bay} onChange={(e) => patchNested(sp.specimen_id, "blood_culture", { incubator_bay: e.target.value })} />
                        </Box>
                        <Box>
                          <FieldLabel>Bottle lot</FieldLabel>
                          <TextField size="small" fullWidth sx={inputSx} value={rec.blood_culture.bottle_lot} onChange={(e) => patchNested(sp.specimen_id, "blood_culture", { bottle_lot: e.target.value })} />
                        </Box>
                        <Box>
                          <FieldLabel>Bottle expiry</FieldLabel>
                          <TextField size="small" fullWidth type="date" sx={inputSx} value={rec.blood_culture.bottle_expiry} onChange={(e) => patchNested(sp.specimen_id, "blood_culture", { bottle_expiry: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Box>
                        <Box>
                          <FieldLabel>Load datetime</FieldLabel>
                          <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={rec.blood_culture.loaded_at} onChange={(e) => patchNested(sp.specimen_id, "blood_culture", { loaded_at: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Box>
                      </Box>
                    </Box>
                  )}

                  {/* Inoculation / atmosphere / temperature */}
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                    <Box>
                      <FieldLabel>Inoculation method</FieldLabel>
                      <Sel label="Inoculation" options={INOCULATION_METHOD_OPTIONS} value={rec.inoculation_method} onChange={(v) => patch(sp.specimen_id, { inoculation_method: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Atmosphere</FieldLabel>
                      <Sel label="Atmosphere" options={ATMOSPHERE_OPTIONS} value={rec.atmosphere} onChange={(v) => patch(sp.specimen_id, { atmosphere: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Incubation temperature</FieldLabel>
                      <Sel label="Temperature" options={TEMPERATURE_OPTIONS} value={rec.incubation_temperature} onChange={(v) => patch(sp.specimen_id, { incubation_temperature: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Incubation start</FieldLabel>
                      <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={rec.incubation_started_at} onChange={(e) => patch(sp.specimen_id, { incubation_started_at: e.target.value })} InputLabelProps={{ shrink: true }} />
                    </Box>
                  </Box>

                  {anaerobicCulture && (
                    <Box sx={{ mt: 1.5, border: `1px solid ${C.border}`, p: 1.5, background: C.bgTertiary }}>
                      <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}>
                        Anaerobic jar integrity
                      </Typography>
                      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.5 }}>
                        <Box>
                          <FieldLabel>Indicator strip lot</FieldLabel>
                          <TextField size="small" fullWidth sx={inputSx} value={rec.anaerobic_indicator_lot} onChange={(e) => patch(sp.specimen_id, { anaerobic_indicator_lot: e.target.value })} />
                        </Box>
                        <Box>
                          <FieldLabel>Colour confirmation</FieldLabel>
                          <Sel label="Colour" options={INDICATOR_COLOUR_OPTIONS} value={rec.anaerobic_indicator_colour} onChange={(v) => patch(sp.specimen_id, { anaerobic_indicator_colour: v })} />
                        </Box>
                      </Box>
                    </Box>
                  )}

                  {/* Media QC (CLSI M22-A3) */}
                  <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.5 }}>
                    <Box>
                      <FieldLabel>Media lot</FieldLabel>
                      <TextField size="small" fullWidth sx={inputSx} value={rec.media_lot} onChange={(e) => patch(sp.specimen_id, { media_lot: e.target.value })} />
                    </Box>
                    <Box>
                      <FieldLabel>Media expiry</FieldLabel>
                      <TextField size="small" fullWidth type="date" sx={inputSx} value={rec.media_expiry} onChange={(e) => patch(sp.specimen_id, { media_expiry: e.target.value })} InputLabelProps={{ shrink: true }} />
                    </Box>
                  </Box>

                  {expectedFirstRead(sp) && (
                    <Typography sx={{ mt: 1.5, fontSize: 11.5, fontFamily: FONT, color: C.textMuted, fontStyle: "italic" }}>
                      Expected first read: {expectedFirstRead(sp)}
                    </Typography>
                  )}
                </Box>
              ) : (
                !parasitology && !pgx && (
                  <Box sx={{ mt: 2, px: 2, py: 1.5, border: `1px dashed ${C.border}`, background: C.bgSecondary }}>
                    <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                      No culture track activated for this specimen (no culture / blood-culture test ordered in Registration). Serology / NAAT specimens proceed without a culture dispatch card.
                    </Typography>
                  </Box>
                )
              )}

              {/* ── PGx receipt check (stands in for culture dispatch) ── */}
              {pgx && (
                <Box sx={{ mt: 2.5, border: `1px solid ${C.border}`, p: 2 }}>
                  <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1.5 }}>
                    Pharmacogenomic receipt check
                  </Typography>

                  {/* Both marks are drawn from the fields below, so neither can be
                      dismissed by editing a separate status: clearing the container
                      or the history is what clears the mark. */}
                  {pgxFlagged && (
                    <Box sx={{ mb: 1.5, border: `1px solid ${FLAG_COLOR}`, p: 1.5 }}>
                      {tubeStop && (
                        <Typography sx={{ fontSize: 12, fontFamily: FONT, color: FLAG_COLOR, lineHeight: 1.6 }}>
                          ⚠ {tubeStop.why}
                        </Typography>
                      )}
                      {donorRisk && (
                        <Typography sx={{ fontSize: 12, fontFamily: FONT, color: FLAG_COLOR, lineHeight: 1.6, mt: tubeStop ? 0.75 : 0 }}>
                          ⚠ Recent transfusion, or a stem-cell transplant, means the DNA in this
                          sample may not be the patient's own — the genotype would describe the
                          donor. Confirm a pre-transfusion sample, or send saliva / buccal instead.
                        </Typography>
                      )}
                    </Box>
                  )}

                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.5 }}>
                    <Box>
                      <FieldLabel>Container received</FieldLabel>
                      <Sel label="Container" options={PGX_TUBE_OPTIONS} value={receipt.tube_type} onChange={(v) => patchNested(sp.specimen_id, "pgx_receipt", { tube_type: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Held as</FieldLabel>
                      <Sel label="Storage" options={PGX_STORAGE_OPTIONS} value={receipt.hold} onChange={(v) => patchNested(sp.specimen_id, "pgx_receipt", { hold: v })} />
                    </Box>
                  </Box>

                  <Box sx={{ mt: 1.5 }}>
                    <FieldLabel>Problems found at receipt</FieldLabel>
                    <CbxGroup
                      label=""
                      options={PGX_INTEGRITY_ISSUES}
                      value={receipt.integrity_issues}
                      onChange={(v) => patchNested(sp.specimen_id, "pgx_receipt", { integrity_issues: v })}
                    />
                    <Typography sx={{ mt: 0.75, fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                      Blood-specific only. Volume, labelling and container integrity are on the
                      specimen's quality block in Registration, along with any rejection.
                    </Typography>
                  </Box>

                  {/* The two questions with no culture equivalent. "Unknown" is a
                      real answer and is treated exactly as "Yes" — a genotype
                      reported off donor DNA is wrong whichever way it was missed. */}
                  <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.5 }}>
                    <Box>
                      <FieldLabel>Transfusion in the last 3 months?</FieldLabel>
                      <Sel label="Transfusion" options={YES_NO_UNKNOWN_OPTIONS} value={receipt.transfusion_recent} onChange={(v) => patchNested(sp.specimen_id, "pgx_receipt", { transfusion_recent: v })} />
                    </Box>
                    <Box>
                      <FieldLabel>Stem-cell (bone-marrow) transplant?</FieldLabel>
                      <Sel label="Transplant" options={YES_NO_UNKNOWN_OPTIONS} value={receipt.transplant} onChange={(v) => patchNested(sp.specimen_id, "pgx_receipt", { transplant: v })} />
                    </Box>
                  </Box>

                  <Box sx={{ mt: 1.5 }}>
                    <FieldLabel>Receipt note</FieldLabel>
                    <TextField size="small" fullWidth sx={inputSx} value={receipt.note} onChange={(e) => patchNested(sp.specimen_id, "pgx_receipt", { note: e.target.value })} placeholder="Action taken, recollection requested, who was informed…" />
                  </Box>
                </Box>
              )}

              {/* ── Parasitology preparation panel (no incubation) ── */}
              {parasitology && (
                <Box sx={{ mt: 2.5, border: `1px solid ${C.border}`, p: 2 }}>
                  <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1.5 }}>
                    Parasitology — slide preparation
                  </Typography>

                  <Box sx={{ mb: 1.5 }}>
                    <FieldLabel>Preparation method(s)</FieldLabel>
                    <CbxGroup
                      label=""
                      options={PARASITE_PREP_METHOD_OPTIONS}
                      value={rec.parasite_prep.methods}
                      onChange={(v) => patchNested(sp.specimen_id, "parasite_prep", { methods: v })}
                    />
                  </Box>

                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.5, mb: 1.5 }}>
                    <Box>
                      <FieldLabel>Prepared by</FieldLabel>
                      <TextField size="small" fullWidth sx={inputSx} value={rec.parasite_prep.performed_by} onChange={(e) => patchNested(sp.specimen_id, "parasite_prep", { performed_by: e.target.value })} />
                    </Box>
                    <Box>
                      <FieldLabel>Preparation datetime</FieldLabel>
                      <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={rec.parasite_prep.prepared_at} onChange={(e) => patchNested(sp.specimen_id, "parasite_prep", { prepared_at: e.target.value })} InputLabelProps={{ shrink: true }} />
                    </Box>
                  </Box>

                  <FieldLabel>Slides prepared</FieldLabel>
                  {rec.parasite_prep.slides.map((slide, si) => (
                    <Box key={si} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "2fr 1fr auto" }, gap: 1, alignItems: "center", mb: 1 }}>
                      <Sel
                        label="Slide type"
                        options={SLIDE_TYPE_OPTIONS}
                        value={slide.slide_type}
                        onChange={(v) => {
                          const slides = rec.parasite_prep.slides.map((s, x) => (x === si ? { ...s, slide_type: v } : s));
                          patchNested(sp.specimen_id, "parasite_prep", { slides });
                        }}
                      />
                      <TextField size="small" fullWidth sx={inputSx} label="" placeholder="Count" value={slide.count} onChange={(e) => {
                        const slides = rec.parasite_prep.slides.map((s, x) => (x === si ? { ...s, count: e.target.value } : s));
                        patchNested(sp.specimen_id, "parasite_prep", { slides });
                      }} />
                      <IconButton
                        size="small"
                        onClick={() => {
                          const slides = rec.parasite_prep.slides.filter((_, x) => x !== si);
                          patchNested(sp.specimen_id, "parasite_prep", { slides });
                        }}
                        sx={{ color: C.textSecond, "&:hover": { color: C.black } }}
                      >
                        <DeleteOutlineRounded fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                  <Button
                    size="small"
                    onClick={() => patchNested(sp.specimen_id, "parasite_prep", { slides: [...rec.parasite_prep.slides, blankSlide()] })}
                    sx={{ px: 1.5, py: 0.5, border: `1px solid ${C.border}`, color: C.textSecond, fontSize: 11, fontFamily: FONT, textTransform: "none", cursor: "pointer", background: C.white, "&:hover": { borderColor: C.black } }}
                  >
                    + Add slide
                  </Button>
                </Box>
              )}

              {/* Notes */}
              <Box sx={{ mt: 2 }}>
                <FieldLabel>Processing notes</FieldLabel>
                <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={rec.notes || ""} onChange={(e) => patch(sp.specimen_id, { notes: e.target.value })} placeholder="Contamination, odour, specimen condition flags…" />
              </Box>
            </Box>
          </Box>
        );
      })}

      {notice && (
        <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1 }}>
        <Button onClick={handleSave} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Processing"}
        </Button>
      </Box>
    </Box>
  );
}
