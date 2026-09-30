import React, { useState } from "react";
import { Box, Typography } from "@mui/material";
import { motion, AnimatePresence } from "framer-motion";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = { black:"#000", charcoal:"#444", ash:"#888", mist:"#e0e0e0", ghost:"#fafafa", white:"#fff" };
const os = (x = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, WebkitFontSmoothing: "antialiased", ...x });

const Section = ({ title, count, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ border:`1px solid ${C.mist}`, mb:1.5, "&:hover":{ borderColor:C.black }, transition:"border-color 0.2s" }}>
      <Box onClick={() => setOpen(v => !v)} sx={{ px:2, py:1.5, display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", background: open ? C.ghost : C.white, borderBottom: open ? `1px solid ${C.mist}` : "none", userSelect:"none" }}>
        <Box sx={{ display:"flex", alignItems:"center", gap:1.5 }}>
          <Typography sx={{ ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR, letterSpacing:"0.05em", textTransform:"uppercase" }) }}>{title}</Typography>
          {count > 0 && (
            <Box sx={{ background:C.ghost, border:`1px solid ${C.mist}`, px:1, py:0.1 }}>
              <Typography sx={{ ...os({ fontSize:10, color:C.ash }) }}>{count}</Typography>
            </Box>
          )}
        </Box>
        {open ? <ExpandLessIcon sx={{ fontSize:14, color:C.ash }} /> : <ExpandMoreIcon sx={{ fontSize:14, color:C.ash }} />}
      </Box>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:"auto", opacity:1 }} exit={{ height:0, opacity:0 }} transition={{ duration:0.18 }} style={{ overflow:"hidden" }}>
            <Box sx={{ px:2, py:2 }}>{children}</Box>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
};
const InfoRow = ({ label, value }) => (
  <Box sx={{ display:"flex", gap:1, py:0.4, borderBottom:`1px solid ${C.mist}` }}>
    <Typography sx={{ ...os({ fontSize:11, color:C.ash, minWidth:140 }) }}>{label}</Typography>
    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, fontWeight:FW_REGULAR, flex:1 }) }}>{value || "—"}</Typography>
  </Box>
);
const Strip = ({ text }) => (
  <Box sx={{ px:1.5, py:1, mt:1, background:C.ghost, border:`1px solid ${C.mist}`, borderLeft:`2px solid ${C.charcoal}` }}>
    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, lineHeight:1.6 }) }}>{text}</Typography>
  </Box>
);

const reasons = [
  "Multiple possible treatment sequences",
  "Conflicting pathology/imaging",
  "Molecular findings requiring interpretation",
  "Need for surgery + systemic therapy + radiation coordination",
];
const questions = [
  ["Disease","Is distant disease excluded? Liver MRI needed.","Radiology"],
  ["Disease","Is HER2 status established? ISH needed.","Pathology"],
  ["Surgery","Is breast conservation feasible now or only after response?","Surgical Oncology"],
  ["Surgery","Should the biopsied node be clipped before therapy?","Surgical Oncology"],
  ["Medical Oncology","Is neoadjuvant systemic therapy indicated?","Medical Oncology"],
  ["Medical Oncology","Which regimen if ISH positive, and which if negative?","Medical Oncology"],
  ["Radiation Oncology","Will regional nodal irradiation be needed, and how is cardiac dose managed?","Radiation Oncology"],
  ["Other","Genetic counselling and germline testing?","Genetics"],
  ["Other","Clinical trial available?","Trials office"],
];
const radiology = [["Left breast primary 4.4 cm","Confirmed"],["Level I axillary node 1.8 cm","Confirmed"],["Liver segment VI 6 mm lesion","Indeterminate"],["Bones and lungs clear","Confirmed"]];
const pathology = [["Histology IDC, grade 3","Verified"],["ER / PR","Verified"],["HER2","Additional testing: ISH"],["LVI","Not reported on core"],["Specimen adequacy","Adequate"]];
const transcript = [
  ["Radiologist","Segment six lesion is 6 mm and not FDG-avid. Most likely a cyst, but I'd confirm with MRI."],
  ["Pathologist","HER2 is 2+ equivocal. Dual-probe ISH is sent; result expected Monday."],
  ["Medical oncologist","If ISH is positive, neoadjuvant chemotherapy with dual HER2 blockade. If negative, I would still lean neoadjuvant: grade 3, Ki-67 35 and node positive."],
  ["Surgical oncologist","Neoadjuvant may allow breast conservation. Please clip the node before starting."],
  ["Radiation oncologist","Left-sided, so breath-hold planning. Nodal irradiation decision after surgery."],
  ["Chair","Refer for genetic counselling given the mother's history. Reconvene if the MRI is not benign."],
];
const consensus = [
  ["Consensus strategy","Neoadjuvant systemic therapy, regimen by HER2 ISH result"],
  ["Sequence","Node clip → neoadjuvant therapy → response assessment → surgery → radiation → endocrine therapy"],
  ["Intent","Curative"],
  ["Reasoning documented by MDT","Grade 3, Ki-67 35%, node-positive; response information will guide adjuvant therapy and may enable breast conservation."],
  ["Surgery","Clip node now; surgical plan after response assessment"],
  ["Medical Oncology","TCHP if ISH positive; dose-dense AC then paclitaxel if negative"],
  ["Radiation Oncology","Post-operative, breath-hold; nodal fields after pathology"],
  ["Pathology","ISH by 29 Sep"],
  ["Radiology","Liver MRI; breast MRI for baseline extent"],
  ["Molecular / Genetics","Genetic counselling referral"],
  ["Unresolved","HER2 status, Liver lesion"],
  ["Additional investigations","Dual-probe ISH, Liver MRI, Echocardiogram, HBsAg, anti-HBc"],
  ["Follow-up decision point","Return to MDT if liver MRI is not benign"],
];
const pathA = [
  ["Now","Clip biopsied node; confirm HER2, LVEF, liver MRI",false],
  ["Treat","Neoadjuvant systemic therapy (regimen by ISH)",false],
  ["Decision point","Response assessment after 4 cycles: response, stable or progression",true],
  ["Then","Surgery: breast conservation or mastectomy with axillary surgery",false],
  ["Decision point","Residual disease or pathological complete response guides adjuvant therapy",true],
  ["Then","Radiation, endocrine therapy",false],
];
const pathB = [
  ["Now","Breast and liver MRI, surgical assessment",false],
  ["Treat","Surgery with axillary staging",false],
  ["Decision point","Final pathology: size, nodes, margins, grade",true],
  ["Then","Adjuvant systemic therapy by risk",false],
  ["Then","Radiation, endocrine therapy",false],
];

const Marker = ({ s = "rv" }) => {
  const M = {
    ok:{ borderRadius:"50%", background:C.black },
    rv:{ borderRadius:"50%", border:`1.5px solid ${C.black}`, background:`linear-gradient(90deg,${C.black} 50%,transparent 50%)` },
    cr:{ rotate:45, borderRadius:0, background:C.black },
    ms:{ borderRadius:"50%", border:`1.5px dashed ${C.black}` },
  };
  return <Box sx={{ width:11, height:11, mt:0.6, flexShrink:0, ...M[s] }} />;
};

export default function TumourBoard() {
  const [ish, setIsh] = useState("pending");
  const [captured, setCaptured] = useState(0);

  const ishNote = {
    pending: "ISH pending: both regimen branches stay open.",
    positive: "If ISH positive: neoadjuvant chemotherapy with dual HER2 blockade becomes the strongly supported route.",
    negative: "If ISH negative: both routes remain reasonable; menopausal status and genomic risk gain weight.",
  }[ish];

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      <Box sx={{ pb:3, mb:3, borderBottom:`1px solid ${C.mist}` }}>
        <Typography sx={{ ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase", mb:1 }) }}>
          Latha Varghese / Tumour board
        </Typography>
        <Typography sx={{ ...os({ fontSize:22, color:C.black, lineHeight:1.3, mb:1.5 }) }}>
          The board decides between two pathways; HER2 and the liver lesion decide which one.
        </Typography>
        <Typography sx={{ ...os({ fontSize:13, color:C.ash, maxWidth:"60ch" }) }}>
          Prepared from the verified story, so meeting time goes to decisions, not history.
        </Typography>
      </Box>

      <Section title="Why this case is here" count={reasons.length} defaultOpen>
        <Box sx={{ display:"flex", flexWrap:"wrap", gap:1 }}>
          {reasons.map(r => (
            <Box key={r} sx={{ border:`1px solid ${C.black}`, borderRadius:"999px", px:1.5, py:0.5, fontSize:11, color:C.black, fontFamily:FONT }}>
              {r}
            </Box>
          ))}
        </Box>
      </Section>

      <Section title="Board view" defaultOpen>
        <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", md:"1fr 1fr" }, gap:3 }}>
          <Box>
            <Typography sx={{ ...os({ fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.1em", mb:1 }) }}>Patient and disease</Typography>
            <InfoRow label="Case" value="New cancer" />
            <InfoRow label="Cancer" value="Breast cancer, left" />
            <InfoRow label="Histology" value="Invasive ductal carcinoma, Grade 3" />
            <InfoRow label="Stage" value="cT2 cN1 cM0 · Stage IIB" />
            <InfoRow label="Intent considered" value="Curative" />
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.1em", mb:1 }) }}>Disease evidence</Typography>
            <InfoRow label="Tumour size" value="4.4 cm (PET) · 4.2 cm (mammogram)" />
            <InfoRow label="Nodes" value="1 level I axillary node, cytology positive" />
            <InfoRow label="Metastasis" value="None confirmed · liver lesion indeterminate" />
            <InfoRow label="ER / PR" value="90% / 40%" />
            <InfoRow label="HER2" value="IHC 2+ equivocal · ISH pending" />
            <InfoRow label="Ki-67" value="35%" />
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.1em", mb:1 }) }}>Treatment history</Typography>
            <InfoRow label="Systemic therapy" value="None" />
            <InfoRow label="Surgery" value="Core biopsy only" />
            <InfoRow label="Radiation" value="None" />
            <InfoRow label="Prior cancer" value="None documented" />
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.1em", mb:1 }) }}>Patient factors</Typography>
            <InfoRow label="Performance status" value="ECOG 1" />
            <InfoRow label="Comorbidities" value="Type 2 diabetes (HbA1c 7.8%), hypertension" />
            <InfoRow label="Medications" value="Metformin 1 g BD, amlodipine 5 mg OD" />
            <InfoRow label="Supplements" value="Ayurvedic preparation, name not documented" />
            <InfoRow label="Allergies" value="Sulfonamide (rash)" />
          </Box>
        </Box>
      </Section>

      <Section title="Decisions required" count={questions.length} defaultOpen>
        <Box component="table" sx={{ width:"100%", borderCollapse:"collapse", fontFamily:FONT }}>
          <Box component="thead">
            <Box component="tr">
              {["Area","Question","Owner","Status"].map(h => (
                <Box component="th" key={h} sx={{ textAlign:"left", fontWeight:FW_LIGHT, fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.08em", py:1, borderBottom:`1px solid ${C.mist}` }}>{h}</Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {questions.map((q, i) => (
              <Box component="tr" key={i}>
                <Box component="td" sx={{ fontSize:11, color:C.charcoal, py:1.2, borderBottom:`1px solid ${C.mist}`, verticalAlign:"top" }}>{q[0]}</Box>
                <Box component="td" sx={{ fontSize:11, color:C.black, py:1.2, borderBottom:`1px solid ${C.mist}`, verticalAlign:"top" }}>{q[1]}</Box>
                <Box component="td" sx={{ fontSize:11, color:C.ash, py:1.2, borderBottom:`1px solid ${C.mist}`, verticalAlign:"top" }}>{q[2]}</Box>
                <Box component="td" sx={{ py:1.2, borderBottom:`1px solid ${C.mist}`, verticalAlign:"top" }}>
                  <Box component="select" sx={{ fontFamily:FONT, fontWeight:FW_LIGHT, fontSize:11, border:`1px solid ${C.mist}`, background:"transparent", px:1, py:0.4 }}>
                    <option>Open</option><option>Resolved</option><option>Deferred</option>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Section>

      <Section title="Clinical pathway simulation" defaultOpen>
        <Typography sx={{ ...os({ fontSize:11, color:C.ash, mb:2 }) }}>
          Two pathways modelled, not ranked. It shows what each step teaches and which decision it unlocks; it does not predict response.
        </Typography>

        <Box sx={{ mb:2, display:"flex", alignItems:"center", gap:1.5 }}>
          <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>HER2 ISH</Typography>
          <Box sx={{ display:"inline-flex", border:`1px solid ${C.black}` }}>
            {["pending","positive","negative"].map(k => (
              <Box key={k} component="button" onClick={() => setIsh(k)} sx={{ fontFamily:FONT, fontWeight:FW_LIGHT, fontSize:11, px:1.5, py:0.6, border:"none", borderRight:`1px solid ${C.black}`, background: ish === k ? C.black : C.white, color: ish === k ? C.white : C.black, cursor:"pointer", "&:last-child":{ borderRight:"none" } }}>
                {k[0].toUpperCase()+k.slice(1)}
              </Box>
            ))}
          </Box>
          <Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{ishNote}</Typography>
        </Box>

        <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", md:"1fr 1fr" }, gap:3 }}>
          {[{ title:"A. Neoadjuvant therapy first", nodes:pathA }, { title:"B. Surgery first", nodes:pathB }].map((p, pi) => (
            <Box key={pi} sx={{ borderTop:`2px solid ${C.black}`, pt:2 }}>
              <Typography sx={{ ...os({ fontSize:14, color:C.black, fontWeight:FW_REGULAR, mb:1.5 }) }}>{p.title}</Typography>
              <Box sx={{ borderLeft:`1px solid ${C.black}`, pl:2 }}>
                {p.nodes.map((n, i) => (
                  <Box key={i} sx={{ position:"relative", pb:1.5 }}>
                    <Box sx={{ position:"absolute", left:-22, top:6, width:9, height:9, transform:"rotate(45deg)", background: n[2] ? C.black : C.white, border:`1px solid ${C.black}` }} />
                    <Typography sx={{ ...os({ fontSize:10, color:C.ash }) }}>{n[0]}</Typography>
                    <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{n[1]}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Section>

      <Section title="Specialty workspaces" defaultOpen>
        <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", md:"1fr 1fr" }, gap:3 }}>
          <Box>
            <Typography sx={{ ...os({ fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.1em", mb:1 }) }}>Radiology verification</Typography>
            {radiology.map(([t, s], i) => (
              <Box key={i} sx={{ display:"grid", gridTemplateColumns:"20px 1fr auto", gap:1.5, py:1, borderBottom:`1px solid ${C.mist}`, alignItems:"center" }}>
                <Marker s={s === "Confirmed" ? "ok" : "rv"} />
                <Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{t}</Typography>
                <Box component="select" defaultValue={s} sx={{ fontFamily:FONT, fontWeight:FW_LIGHT, fontSize:10, border:`1px solid ${C.mist}`, background:"transparent", px:1, py:0.3 }}>
                  {["Confirmed","Possible","Indeterminate","Needs further imaging"].map(o => <option key={o}>{o}</option>)}
                </Box>
              </Box>
            ))}
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.1em", mb:1 }) }}>Pathology verification</Typography>
            {pathology.map(([t, s], i) => (
              <Box key={i} sx={{ display:"grid", gridTemplateColumns:"20px 1fr auto", gap:1.5, py:1, borderBottom:`1px solid ${C.mist}`, alignItems:"center" }}>
                <Marker s={s === "Verified" || s === "Adequate" ? "ok" : "rv"} />
                <Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{t}</Typography>
                <Typography sx={{ ...os({ fontSize:10, color:C.ash }) }}>{s}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Section>

      <Section title="Live discussion" defaultOpen>
        <Typography sx={{ ...os({ fontSize:11, color:C.ash, mb:2 }) }}>
          Speech-to-text with speaker attribution; each point confirmed by the speaker.
        </Typography>
        <Box component="button" onClick={() => setCaptured(c => Math.min(c + 1, transcript.length))} sx={{ fontFamily:FONT, fontWeight:FW_REGULAR, fontSize:11, color:C.white, background:C.black, border:`1px solid ${C.black}`, px:2, py:1, cursor:"pointer", textTransform:"uppercase", letterSpacing:"0.08em", mb:2 }}>
          {captured >= transcript.length ? "Capture complete" : captured ? "Capturing…" : "Start capture"}
        </Box>
        {transcript.slice(0, captured).map((t, i) => (
          <Box key={i} sx={{ borderLeft:`1px solid ${C.mist}`, pl:2, mb:1.5 }}>
            <Typography sx={{ ...os({ fontSize:10, color:C.ash }) }}>{t[0]}</Typography>
            <Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.6 }) }}>{t[1]}</Typography>
          </Box>
        ))}
      </Section>

      <Section title="Tumour board decision" defaultOpen>
        <Typography sx={{ ...os({ fontSize:11, color:C.ash, mb:2 }) }}>
          Recorded separately from the AI-prepared material.
        </Typography>
        {consensus.map(([k,v], i) => <InfoRow key={i} label={k} value={v} />)}
        <Box sx={{ display:"flex", gap:1.5, mt:2, flexWrap:"wrap" }}>
          <Box component="button" sx={{ fontFamily:FONT, fontWeight:FW_REGULAR, fontSize:11, color:C.white, background:C.black, border:`1px solid ${C.black}`, px:2, py:0.9, cursor:"pointer", textTransform:"uppercase", letterSpacing:"0.08em" }}>Record MDT decision</Box>
          <Box component="button" sx={{ fontFamily:FONT, fontWeight:FW_REGULAR, fontSize:11, color:C.black, background:"transparent", border:`1px solid ${C.mist}`, px:2, py:0.9, cursor:"pointer", textTransform:"uppercase", letterSpacing:"0.08em", "&:hover":{ borderColor:C.black, background:C.ghost } }}>Continue to first-line plan</Box>
        </Box>
      </Section>

      <Strip text="Molecular tumour board: Not triggered for this patient. HER2 ISH is a pathology test; germline testing goes through genetic counselling." />
    </motion.div>
  );
}