# Synoptic template review worksheet

**What this is.** Every option list a pathologist reads when filling a synoptic report,
gathered from all 28 templates so the review can be done from one document instead of
opening 28 source files.

**Provenance.** Extracted verbatim from `synoptic/schemas/*.js` by text extraction — the
lists below are copied from the code, not retyped from memory, so they cannot disagree
with what the form actually offers. Re-check or regenerate after any schema edit.

**Status.** None of this is clinically approved. Every template stores
`official_cap_compliance: false` and `clinical_review_status: "Not clinically approved"`,
and the tab says so on screen. These are locally written forms modelled on CAP/WHO
protocols — they are not the CAP protocol documents, and the option lists have not been
reviewed by a pathologist. This document exists to change that.

**Who decides.** This is a departmental decision, not an accreditation one. CAP publishes
cancer protocols; it does not approve third-party software forms, and nothing here waits
on CAP. The reviewer is whoever in the department owns synoptic reporting for that organ.

**How to review one template.** For each, the judgement calls are:

1. **WHO histologic type** — are these the entities you report at this site, and is
   anything missing that you would need?
2. **Grading system / grade** — is this the grading you actually record, worded the way
   you word it?
3. **Extent of invasion** — these map to the T category. Do the boundaries match how you
   assign T?
4. **Site-specific fields** — the checks and biomarkers you record for this site. Anything
   you always record that is absent here is a gap.

Tick a template off when all four are right. Anything wrong is a one-line edit in that
template's file.

---

## Anal Canal Resection

`synoptic/schemas/anus.js` · Gastrointestinal

**WHO histologic type**

- Squamous cell carcinoma
- Cloacogenic (basaloid) carcinoma
- Adenocarcinoma
- Mucinous adenocarcinoma
- Neuroendocrine carcinoma
- Melanoma

**Grading system**

- WHO anal squamous grading
- Not applicable

**Grade**

- Well differentiated
- Moderately differentiated
- Poorly differentiated
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Invades lamina propria or muscularis mucosae
- Invades sphincter muscle
- Invades perianal skin or subcutaneous tissue
- Invades adjacent organ

**Site-specific select fields**

| Field | Options |
| --- | --- |
| HPV Association | HPV-associated, HPV-independent, Not performed, Cannot be assessed |
| Inguinal Lymph Nodes (clinical) | Not assessed, Negative, Positive, Cannot be determined |
| Perianal Skin Involvement | Not identified, Present, Cannot be determined |
| Anal Gland Involvement | Not identified, Present, Cannot be determined |

## Gallbladder and Extrahepatic Bile Duct Resection

`synoptic/schemas/biliary.js` · Hepatobiliary

**WHO histologic type**

- Adenocarcinoma, NOS
- Biliary-type adenocarcinoma
- Papillary adenocarcinoma
- Mucinous adenocarcinoma
- Signet-ring cell carcinoma
- Squamous cell carcinoma
- Neuroendocrine carcinoma
- Intraductal papillary neoplasm

**Grading system**

- WHO biliary grading (G1-G3)
- Not applicable

**Grade**

- G1
- G2
- G3
- Well differentiated
- Moderately differentiated
- Poorly differentiated
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Invades lamina propria or muscle layer
- Invades perimuscular connective tissue
- Invades serosa or adjacent structure
- Invades main portal vein or hepatic artery
- Invades two or more extrahepatic organs

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Gallstones | Not identified, Present, Cannot be determined |
| Biliary Dysplasia | Not identified, Low grade, High grade, Cannot be assessed |
| Cystic Duct Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |
| Bile Duct Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |
| Liver Transection Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |

## Urinary Bladder Resection

`synoptic/schemas/bladder.js` · Genitourinary

**WHO histologic type**

- Urothelial carcinoma, non-invasive papillary
- Urothelial carcinoma, invasive
- Urothelial carcinoma with divergent differentiation
- Nested variant urothelial carcinoma
- Micropapillary urothelial carcinoma
- Squamous cell carcinoma
- Adenocarcinoma
- Small cell neuroendocrine carcinoma
- Sarcoma

**Grading system**

- WHO/ISUP two-tier grading
- WHO 2022 grading
- Not applicable

**Grade**

- Low grade
- High grade
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Invades lamina propria
- Invades muscularis propria (detrusor)
- Invades deep perivesical fat
- Invades adjacent organ (prostate, uterus, vagina, rectum)
- Invades pelvic or abdominal wall

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Concurrent Carcinoma In Situ | Not identified, Present, Cannot be determined |
| Prostatic Urethral Involvement | Not identified, Present, Cannot be determined, Not applicable |
| Urethral Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |
| Ureteric Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |

## Breast Resection

`synoptic/schemas/breast.js` · Breast

**WHO histologic type**

- Invasive carcinoma of no special type
- Invasive lobular carcinoma
- Tubular carcinoma
- Mucinous carcinoma
- Invasive micropapillary carcinoma
- Metaplastic carcinoma
- Microinvasive carcinoma

**Grading system**

- Nottingham histologic score
- Not applicable

**Grade**

- Grade 1
- Grade 2
- Grade 3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to breast parenchyma
- Invades dermis or epidermis without ulceration
- Invades skin with ulceration or satellite nodules
- Invades chest wall
- Inflammatory carcinoma features

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Ductal Carcinoma In Situ | Not identified, Present, Cannot be determined |
| Tumor Focality | Single focus, Multiple foci, Cannot be determined |

## Breast Core Biopsy

`synoptic/schemas/breastBiopsy.js` · Breast

**WHO histologic type**

- Invasive carcinoma of no special type
- Invasive lobular carcinoma
- Tubular carcinoma
- Mucinous carcinoma
- Invasive micropapillary carcinoma
- Metaplastic carcinoma
- Microinvasive carcinoma
- No invasive carcinoma identified

**Grading system**

- Nottingham histologic score
- Not applicable

**Grade**

- Grade 1
- Grade 2
- Grade 3
- Cannot be assessed
- Not applicable

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Ductal Carcinoma In Situ | Not identified, Present, Cannot be determined |
| DCIS Nuclear Grade | Low, Intermediate, High, Cannot be assessed, Not applicable |
| Microinvasion | Not identified, Present, Cannot be determined |
| Estrogen Receptor (ER) | Positive, Negative, Not performed, Cannot be assessed |
| Progesterone Receptor (PR) | Positive, Negative, Not performed, Cannot be assessed |
| HER2 | Positive, Negative, Equivocal, Not performed, Cannot be assessed |

## Cervix Resection

`synoptic/schemas/cervix.js` · Gynaecologic

**WHO histologic type**

- Squamous cell carcinoma, HPV-associated
- Squamous cell carcinoma, HPV-independent
- Adenocarcinoma, HPV-associated
- Adenocarcinoma, usual type
- Adenosquamous carcinoma
- Adenocarcinoma, gastric type
- Neuroendocrine carcinoma
- Small cell carcinoma

**Grading system**

- WHO cervical grading
- Not applicable

**Grade**

- Well differentiated
- Moderately differentiated
- Poorly differentiated
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Invades stroma to depth 5 mm or less
- Invades stroma to depth more than 5 mm
- Invades parametrium
- Invades lower third of vagina
- Invades pelvic wall or causes hydronephrosis

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Parametrial Involvement | Not identified, Present, Cannot be determined |
| Vaginal Involvement | Not identified, Upper third, Middle third, Lower third, Cannot be determined |
| Lower Uterine Segment Involvement | Not identified, Present, Cannot be determined |
| HPV Association | HPV-associated, HPV-independent, Not performed, Cannot be assessed |

## Colorectal Resection

`synoptic/schemas/colorectal.js` · Gastrointestinal

**WHO histologic type**

- Adenocarcinoma, NOS
- Mucinous adenocarcinoma
- Signet-ring cell adenocarcinoma
- Medullary carcinoma
- Adenosquamous carcinoma
- Neuroendocrine carcinoma

**Grading system**

- WHO colorectal two-tier
- WHO colorectal four-tier
- Not applicable

**Grade**

- Low grade
- High grade
- G1
- G2
- G3
- G4
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Invades submucosa
- Invades muscularis propria
- Invades through muscularis propria into pericolorectal tissue
- Invades visceral peritoneum
- Invades adjacent organ or structure

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Tumor Deposits | Not identified, Present, Cannot be determined |
| Macroscopic Tumor Perforation | Not identified, Present, Cannot be determined |
| Mesorectum Completeness | Complete, Nearly complete, Incomplete, Not applicable, Cannot be assessed |

## Colorectal Biopsy

`synoptic/schemas/colorectalBiopsy.js` · Gastrointestinal

**WHO histologic type**

- Adenocarcinoma, NOS
- Mucinous adenocarcinoma
- Signet-ring cell adenocarcinoma
- Medullary carcinoma
- Neuroendocrine carcinoma
- High-grade dysplasia / intramucosal carcinoma
- No dysplasia or carcinoma identified

**Grading system**

- WHO colorectal two-tier
- WHO colorectal four-tier
- Not applicable

**Grade**

- Low grade
- High grade
- G1
- G2
- G3
- G4
- Cannot be assessed
- Not applicable

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Depth of Invasion | Intramucosal, Submucosal (superficial), Submucosal (deep), Cannot be assessed, Not applicable |
| Polypectomy Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |
| Tumor Budding | Not identified, Low, High, Cannot be assessed, Not applicable |
| Specimen Fragmentation | Fragmented, Intact, Cannot be assessed |

## Endometrium Resection

`synoptic/schemas/endometrium.js` · Gynaecologic

**WHO histologic type**

- Endometrioid adenocarcinoma
- Serous carcinoma
- Clear cell carcinoma
- Mucinous carcinoma
- Carcinosarcoma
- Undifferentiated carcinoma
- Endometrial stromal sarcoma
- Leiomyosarcoma
- Adenosarcoma

**Grading system**

- FIGO endometrioid grading
- WHO endometrial grading
- Not applicable

**Grade**

- FIGO grade 1
- FIGO grade 2
- FIGO grade 3
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to endometrium
- Invades less than half of myometrium
- Invades half or more of myometrium
- Invades cervical stroma
- Invades serosa or adnexa
- Invades vagina or parametrium
- Invades bladder or bowel mucosa

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Myometrial Invasion | No myometrial invasion, Less than half, Half or more, Cannot be assessed, Not applicable |
| Cervical Stroma Involvement | Not identified, Present, Cannot be determined |
| Lower Uterine Segment Involvement | Not identified, Present, Cannot be determined |
| Peritoneal Washings | Negative for malignancy, Positive for malignancy, Atypical / suspicious, Not performed, Cannot be assessed |
| Mismatch Repair / MSI Status | MMR proficient (pMMR), MMR deficient (dMMR), Not performed, Cannot be assessed |
| p53 | Abnormal (mutant pattern), Normal (wild-type pattern), Not performed, Cannot be assessed |

## Oesophagus and Gastro-oesophageal Junction Resection

`synoptic/schemas/esophagus.js` · Gastrointestinal

**WHO histologic type**

- Adenocarcinoma, NOS
- Squamous cell carcinoma
- Adenosquamous carcinoma
- Mucinous adenocarcinoma
- Signet-ring cell carcinoma
- Small cell carcinoma
- Undifferentiated carcinoma

**Grading system**

- WHO oesophageal grading (G1-G3)
- Not applicable

**Grade**

- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Invades lamina propria or muscularis mucosae
- Invades submucosa
- Invades muscularis propria
- Invades adventitia
- Invades adjacent structure

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Barrett Oesophagus | Not identified, Present, Cannot be determined |
| Circumferential Resection Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |

## Central Nervous System Tumour Resection

`synoptic/schemas/glioma.js` · Central nervous system

**WHO histologic type**

- Glioblastoma, IDH-wildtype
- Astrocytoma, IDH-mutant
- Oligodendroglioma, IDH-mutant and 1p/19q-codeleted
- Ependymoma
- Medulloblastoma
- Meningioma
- Primary CNS lymphoma
- Metastatic carcinoma
- Pilocytic astrocytoma

**Grading system**

- WHO CNS 5th edition (CNS WHO grade)
- Not applicable

**Grade**

- CNS WHO grade 1
- CNS WHO grade 2
- CNS WHO grade 3
- CNS WHO grade 4
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to site of origin
- Invades adjacent parenchyma
- Invades ventricle
- Invades meninges
- Invades skull

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Extent of Resection | Gross total resection, Subtotal resection, Partial resection, Biopsy only, Cannot be determined |
| Necrosis | Not identified, Present, Cannot be determined |
| IDH Mutation Status | IDH-mutant, IDH-wildtype, Not performed, Cannot be assessed |
| 1p/19q Codeletion | Codeleted, Not codeleted, Not performed, Cannot be assessed |
| MGMT Promoter Methylation | Methylated, Unmethylated, Not performed, Cannot be assessed |
| ATRX Expression | Retained, Lost, Not performed, Cannot be assessed |
| p53 | Abnormal (mutant pattern), Normal (wild-type pattern), Not performed, Cannot be assessed |

## Kidney Resection

`synoptic/schemas/kidney.js` · Genitourinary

**WHO histologic type**

- Clear cell renal cell carcinoma
- Papillary renal cell carcinoma
- Chromophobe renal cell carcinoma
- Clear cell papillary renal cell tumour
- Xp11 translocation renal cell carcinoma
- Collecting duct carcinoma
- Renal medullary carcinoma
- Urothelial carcinoma
- Oncocytoma
- Angiomyolipoma

**Grading system**

- WHO/ISUP nucleolar grading
- Not applicable

**Grade**

- Grade 1
- Grade 2
- Grade 3
- Grade 4
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to kidney, 7 cm or less
- Confined to kidney, more than 7 cm
- Invades perinephric tissue or renal sinus fat
- Invades renal vein or segmental branches
- Invades vena cava or Gerota fascia
- Invades adrenal gland

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Sarcomatoid Features | Not identified, Present, Cannot be determined |
| Rhabdoid Features | Not identified, Present, Cannot be determined |
| Tumour Necrosis | Not identified, Present, Cannot be determined |
| Renal Sinus Involvement | Not identified, Present, Cannot be determined |
| Collecting System Involvement | Not identified, Present, Cannot be determined |
| Adrenal Gland Involvement | Not identified, Present, Cannot be determined, Not applicable |

## Larynx, Hypopharynx and Trachea Resection

`synoptic/schemas/larynx.js` · Head and neck

**WHO histologic type**

- Squamous cell carcinoma, conventional
- Verrucous carcinoma
- Basaloid squamous cell carcinoma
- Spindle cell (sarcomatoid) carcinoma
- Neuroendocrine carcinoma
- Adenocarcinoma
- Adenoid cystic carcinoma

**Grading system**

- WHO laryngeal grading
- Not applicable

**Grade**

- Well differentiated
- Moderately differentiated
- Poorly differentiated
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to subsite of origin
- Invades adjacent subsite
- Invades paraglottic or pre-epiglottic space
- Invades thyroid cartilage or cricoid
- Invades soft tissue of neck or thyroid gland

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Cartilage Invasion | Not identified, Present, Cannot be determined |
| Extralaryngeal Extension | Not identified, Present, Cannot be determined |
| Pre-epiglottic Space Involvement | Not identified, Present, Cannot be determined |
| p16 (surrogate for HPV) | Positive, Negative, Not performed, Cannot be assessed |

## Liver Resection

`synoptic/schemas/liver.js` · Hepatobiliary

**WHO histologic type**

- Hepatocellular carcinoma
- Fibrolamellar hepatocellular carcinoma
- Combined hepatocellular-cholangiocarcinoma
- Intrahepatic cholangiocarcinoma
- Hepatoblastoma
- Angiosarcoma
- Metastatic carcinoma

**Grading system**

- WHO hepatocellular grading (G1-G4)
- Not applicable

**Grade**

- G1
- G2
- G3
- G4
- Well differentiated
- Moderately differentiated
- Poorly differentiated
- Undifferentiated
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to liver
- Invades adjacent liver parenchyma
- Invades major portal or hepatic vein branch
- Invades visceral peritoneum
- Invades adjacent organ

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Background Liver | Normal, Steatosis, Chronic hepatitis, Cirrhosis, Cannot be assessed |
| Fibrosis Stage | F0, F1, F2, F3, F4 (cirrhosis), Cannot be assessed |
| Macroscopic Vascular Invasion | Not identified, Present, Cannot be assessed |
| Satellite Nodules | Not identified, Present, Cannot be determined |
| Tumour Capsule | Absent, Present, intact, Present, breached, Cannot be assessed |

## Lung Resection

`synoptic/schemas/lung.js` · Thoracic

**WHO histologic type**

- Adenocarcinoma
- Squamous cell carcinoma
- Adenosquamous carcinoma
- Large cell carcinoma
- Large cell neuroendocrine carcinoma
- Small cell carcinoma
- Carcinoid tumor
- Pleomorphic carcinoma

**Grading system**

- WHO thoracic tumor grading
- IASLC adenocarcinoma grading
- Mitotic rate / necrosis for neuroendocrine tumor
- Not applicable

**Grade**

- Well differentiated
- Moderately differentiated
- Poorly differentiated
- Grade 1
- Grade 2
- Grade 3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to lung
- Invades visceral pleura
- Invades main bronchus
- Invades chest wall
- Invades mediastinal structure
- Separate tumor nodule(s) present

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Visceral Pleural Invasion | Not identified, Present, Indeterminate |
| Spread Through Air Spaces | Not identified, Present, Indeterminate |

## Lymph Node Resection (Lymphoma)

`synoptic/schemas/lymphoma.js` · Haematolymphoid

**WHO histologic type**

- Hodgkin lymphoma, classic
- Nodular lymphocyte predominant Hodgkin lymphoma
- Diffuse large B-cell lymphoma
- Follicular lymphoma
- Marginal zone lymphoma
- Mantle cell lymphoma
- Burkitt lymphoma
- Chronic lymphocytic leukaemia / small lymphocytic lymphoma
- Peripheral T-cell lymphoma
- Lymphoblastic lymphoma

**Grading system**

- Not applicable

**Grade**

- Not applicable

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Nodal vs Extranodal | Nodal only, Extranodal only, Nodal and extranodal, Cannot be determined |
| Capsule Status | Intact, Focally penetrated, Penetrated, Cannot be assessed |
| Growth Pattern | Nodular, Diffuse, Mixed nodular and diffuse, Interfollicular, Cannot be assessed |
| Necrosis | Not identified, Present, Cannot be determined |
| Fibrosis | Absent, Present, Cannot be determined |
| Background Lymph Node | Unremarkable, Reactive hyperplasia, Granulomatous change, Cannot be assessed |

## Cutaneous Melanoma Resection

`synoptic/schemas/melanoma.js` · Skin

**WHO histologic type**

- Superficial spreading melanoma
- Nodular melanoma
- Lentigo maligna melanoma
- Acral lentiginous melanoma
- Desmoplastic melanoma
- Mucosal melanoma
- Melanoma arising in a naevus
- Melanoma, not otherwise classified

**Grading system**

- Not applicable

**Grade**

- Not applicable

**Extent of invasion** (maps to T)

- In situ
- Invades papillary dermis
- Invades reticular dermis
- Invades subcutaneous tissue
- Invades deeper structure

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Ulceration | Not identified, Present, Cannot be determined |
| Clark Level | II, III, IV, V, Cannot be assessed, Not applicable |
| Microsatellitosis | Not identified, Present, Cannot be determined |
| Tumour-infiltrating Lymphocytes | Absent, Non-brisk, Brisk, Cannot be assessed |
| Regression | Not identified, Present, Cannot be determined |

## Oral Cavity Resection

`synoptic/schemas/oralCavity.js` · Head and neck

**WHO histologic type**

- Squamous cell carcinoma, conventional
- Squamous cell carcinoma, keratinizing
- Squamous cell carcinoma, non-keratinizing
- Verrucous carcinoma
- Basaloid squamous cell carcinoma
- Papillary squamous cell carcinoma
- Adenocarcinoma
- Mucoepidermoid carcinoma
- Adenoid cystic carcinoma

**Grading system**

- WHO oral squamous grading
- Not applicable

**Grade**

- Well differentiated
- Moderately differentiated
- Poorly differentiated
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to mucosa
- Invades submucosa
- Invades muscularis or bone
- Invades adjacent structure
- Invades skin

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Worst Pattern of Invasion | Cohesive (pattern 1-3), Non-cohesive (pattern 4-5), Cannot be assessed, Not applicable |
| Bone Invasion | Not identified, Present, Cannot be determined |
| Skin Involvement | Not identified, Present, Cannot be determined |
| p16 (surrogate for HPV) | Positive, Negative, Not performed, Cannot be assessed |

## Oropharynx Resection

`synoptic/schemas/oropharynx.js` · Head and neck

**WHO histologic type**

- Squamous cell carcinoma, non-keratinizing (HPV-associated)
- Squamous cell carcinoma, keratinizing (HPV-independent)
- Lymphoepithelial carcinoma
- Basaloid squamous cell carcinoma
- Small cell carcinoma
- Mucoepidermoid carcinoma
- Adenoid cystic carcinoma

**Grading system**

- WHO oropharyngeal grading
- Not applicable

**Grade**

- Well differentiated
- Moderately differentiated
- Poorly differentiated
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to oropharynx
- Invades adjacent oropharyngeal subsite
- Invades lingual or pharyngeal musculature
- Invades larynx or mandible
- Invades pterygoid or skull base

**Site-specific select fields**

| Field | Options |
| --- | --- |
| p16 (surrogate for HPV) | Positive, Negative, Not performed, Cannot be assessed |
| Worst Pattern of Invasion | Cohesive (pattern 1-3), Non-cohesive (pattern 4-5), Cannot be assessed, Not applicable |

## Ovary, Fallopian Tube and Primary Peritoneal Resection

`synoptic/schemas/ovary.js` · Gynaecologic

**WHO histologic type**

- High-grade serous carcinoma
- Low-grade serous carcinoma
- Endometrioid carcinoma
- Clear cell carcinoma
- Mucinous carcinoma
- Seromucinous carcinoma
- Granulosa cell tumour
- Yolk sac tumour
- Immature teratoma
- Brenner tumour

**Grading system**

- FIGO/WHO two-tier grading
- Not applicable

**Grade**

- Low grade
- High grade
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to ovary or fallopian tube
- Extends to or implants on uterus or tube
- Involves peritoneum outside pelvis
- Involves liver or splenic capsule
- Involves other parenchymal organ

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Capsule Rupture | Not identified, Preoperative, Intraoperative, Cannot be determined |
| Surface Involvement | Not identified, Present, Cannot be determined |
| Peritoneal Cytology | Negative for malignancy, Positive for malignancy, Atypical / suspicious, Not performed, Cannot be assessed |
| Omental Involvement | Not identified, Present, Cannot be determined, Not applicable |
| Residual Disease after Cytoreduction | No gross residual disease, Residual disease less than 1 cm, Residual disease 1 cm or more, Cannot be determined, Not applicable |

## Pancreas Resection

`synoptic/schemas/pancreas.js` · Hepatobiliary

**WHO histologic type**

- Pancreatic ductal adenocarcinoma
- Adenosquamous carcinoma
- Colloid (mucinous non-cystic) carcinoma
- Signet-ring cell carcinoma
- Undifferentiated carcinoma
- Pancreatic neuroendocrine tumour
- Acinar cell carcinoma
- Solid pseudopapillary neoplasm
- Ampullary adenocarcinoma

**Grading system**

- WHO pancreatic grading (G1-G3)
- PanNET grade (mitotic rate / Ki-67)
- Not applicable

**Grade**

- G1
- G2
- G3
- G4
- Well differentiated
- Moderately differentiated
- Poorly differentiated
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to pancreas
- Invades peripancreatic tissue
- Invades duodenum, bile duct or ampulla
- Invades extrapancreatic nerve plexus
- Invades major vessel
- Invades adjacent organ

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Pancreatic Transection Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |
| Bile Duct Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |
| Retroperitoneal (SMA) Margin | Uninvolved by invasive carcinoma, Involved by invasive carcinoma, Cannot be assessed, Not applicable |
| Background Pancreas | Normal, Chronic pancreatitis, PanIN, IPMN, Cannot be assessed |
| Tumour Budding | Not identified, Low, Intermediate, High, Cannot be assessed, Not applicable |

## Prostate Resection

`synoptic/schemas/prostate.js` · Genitourinary

**WHO histologic type**

- Acinar adenocarcinoma
- Ductal adenocarcinoma
- Acinar adenocarcinoma with ductal features
- Intraductal carcinoma
- Small cell neuroendocrine carcinoma
- Squamous cell carcinoma

**Grading system**

- Gleason score / ISUP Grade Group
- Not applicable

**Grade**

- Grade Group 1
- Grade Group 2
- Grade Group 3
- Grade Group 4
- Grade Group 5
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to prostate
- Extraprostatic extension
- Invades seminal vesicle
- Invades bladder neck
- Invades adjacent structure other than seminal vesicle

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Extraprostatic Extension | Not identified, Focal, Nonfocal, Cannot be determined |
| Seminal Vesicle Invasion | Not identified, Present, Cannot be determined |

## Prostate Needle Biopsy

`synoptic/schemas/prostateBiopsy.js` · Genitourinary

**WHO histologic type**

- Acinar adenocarcinoma
- Ductal adenocarcinoma
- Intraductal carcinoma
- Small cell neuroendocrine carcinoma
- No carcinoma identified

**Grading system**

- Gleason score / ISUP Grade Group

**Grade**

- Grade Group 1
- Grade Group 2
- Grade Group 3
- Grade Group 4
- Grade Group 5
- Cannot be assessed
- Not applicable

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Extent of Involvement | Single core, Multiple cores, Minimal (<5% of one core), Cannot be assessed, Not applicable |
| Perineural Invasion | Not identified, Present, Indeterminate |
| ASAP / High-Grade PIN | Atypical small acinar proliferation (ASAP), High-grade prostatic intraepithelial neoplasia (PIN), Both, Neither |

## Major Salivary Gland Resection

`synoptic/schemas/salivary.js` · Head and neck

**WHO histologic type**

- Mucoepidermoid carcinoma
- Adenoid cystic carcinoma
- Acinic cell carcinoma
- Salivary duct carcinoma
- Carcinoma ex pleomorphic adenoma
- Secretory carcinoma
- Polymorphous adenocarcinoma
- Pleomorphic adenoma
- Warthin tumour

**Grading system**

- WHO salivary grading
- Modified grading for mucoepidermoid carcinoma
- Not applicable

**Grade**

- Low grade
- Intermediate grade
- High grade
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to gland
- Invades extraglandular soft tissue
- Invades nerve
- Invades bone or skin
- Invades adjacent structure

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Facial Nerve Involvement | Not identified, Present, Cannot be determined, Not applicable |
| Extraparenchymal Extension | Not identified, Present, Cannot be determined |
| Skin Involvement | Not identified, Present, Cannot be determined |
| Bone Invasion | Not identified, Present, Cannot be determined |

## Soft Tissue Sarcoma Resection

`synoptic/schemas/sarcoma.js` · Soft tissue and bone

**WHO histologic type**

- Undifferentiated pleomorphic sarcoma
- Liposarcoma, well differentiated
- Liposarcoma, dedifferentiated
- Leiomyosarcoma
- Synovial sarcoma
- Myxofibrosarcoma
- Malignant peripheral nerve sheath tumour
- Fibrosarcoma
- Rhabdomyosarcoma
- Epithelioid sarcoma
- Clear cell sarcoma

**Grading system**

- FNCLCC grading
- Not applicable

**Grade**

- Grade 1
- Grade 2
- Grade 3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to tissue of origin
- Invades adjacent soft tissue
- Invades bone
- Invades major vessel or nerve
- Invades adjacent organ

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Tumour Depth | Superficial (above fascia), Deep (below fascia), Cannot be determined |
| FNCLCC Differentiation Score | 1, 2, 3, Not applicable |
| FNCLCC Mitotic Score | 1, 2, 3, Not applicable |
| FNCLCC Necrosis Score | 0, 1, 2, Not applicable |
| Prior Radiotherapy Effect | Not identified, Present, Cannot be determined, Not applicable |

## Stomach Resection

`synoptic/schemas/stomach.js` · Gastrointestinal

**WHO histologic type**

- Adenocarcinoma, NOS
- Intestinal-type adenocarcinoma
- Diffuse-type adenocarcinoma
- Signet-ring cell carcinoma
- Mucinous adenocarcinoma
- Mixed adenocarcinoma
- Neuroendocrine tumour
- Neuroendocrine carcinoma
- Gastrointestinal stromal tumour

**Grading system**

- WHO gastric grading (G1-G3)
- PanNET grade (mitotic rate / Ki-67)
- Not applicable

**Grade**

- G1
- G2
- G3
- Low grade
- High grade
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Invades lamina propria or muscularis mucosae
- Invades submucosa
- Invades muscularis propria
- Invades subserosal connective tissue
- Invades serosa (visceral peritoneum)
- Invades adjacent structure

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Lauren Classification | Intestinal, Diffuse, Mixed, Indeterminate, Not applicable |
| Tumour Location within Stomach | Proximal third, Middle third, Distal third, Whole stomach, Overlapping, Not applicable |
| HER2 | Positive, Negative, Equivocal, Not performed, Cannot be assessed |
| Mismatch Repair / MSI Status | MMR proficient (pMMR), MMR deficient (dMMR), Not performed, Cannot be assessed |
| Helicobacter pylori | Not identified, Present, Cannot be determined |

## Testis Resection

`synoptic/schemas/testis.js` · Genitourinary

**WHO histologic type**

- Seminoma
- Non-seminomatous germ cell tumour
- Embryonal carcinoma
- Yolk sac tumour
- Choriocarcinoma
- Teratoma, postpubertal type
- Mixed germ cell tumour
- Leydig cell tumour
- Sertoli cell tumour
- Lymphoma

**Grading system**

- Not applicable

**Grade**

- Not applicable

**Extent of invasion** (maps to T)

- Confined to testis and epididymis
- Invades tunica albuginea or epididymis
- Invades spermatic cord
- Invades scrotal wall

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Lymphovascular Invasion | Not identified, Present, Indeterminate |
| Germ Cell Neoplasia In Situ | Not identified, Present, Cannot be determined |
| Rete Testis Involvement | Not identified, Present, Cannot be determined |
| Tunica Vaginalis Involvement | Not identified, Present, Cannot be determined |
| Spermatic Cord Margin | Uninvolved by invasive tumour, Involved by invasive tumour, Cannot be assessed, Not applicable |
| Separate Tumour Foci | Not identified, Present, Cannot be determined |

## Thyroid Resection

`synoptic/schemas/thyroid.js` · Endocrine

**WHO histologic type**

- Papillary thyroid carcinoma
- Follicular variant of papillary carcinoma
- Follicular thyroid carcinoma
- Oncocytic (Hurthle cell) carcinoma
- Medullary thyroid carcinoma
- Poorly differentiated thyroid carcinoma
- Anaplastic thyroid carcinoma
- Follicular adenoma
- Non-invasive follicular thyroid neoplasm with papillary-like nuclear features (NIFTP)

**Grading system**

- WHO thyroid grading
- Not applicable

**Grade**

- Well differentiated
- Moderately differentiated
- Poorly differentiated
- G1
- G2
- G3
- Cannot be assessed
- Not applicable

**Extent of invasion** (maps to T)

- Confined to thyroid
- Invades perithyroidal soft tissue
- Invades strap muscle
- Invades recurrent laryngeal nerve
- Invades trachea, oesophagus or larynx
- Invades carotid artery or mediastinal vessels

**Site-specific select fields**

| Field | Options |
| --- | --- |
| Extrathyroidal Extension | Not identified, Microscopic, Macroscopic, Cannot be determined |
| Tumour Focality | Single focus, Multifocal, Cannot be determined |
| Background Thyroid | Normal, Hashimoto thyroiditis, Multinodular goitre, Follicular adenoma, Cannot be assessed |
| Lymphocytic Thyroiditis | Not identified, Present, Cannot be determined |
