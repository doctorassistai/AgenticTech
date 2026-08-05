import React, { useState, useEffect } from "react";


/**
 * ADMIN LOGIN + RULE CONFIG
 */
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const AdminRuleConfig = () => {
    const ADMIN_USERNAME = "StrongPassword@123";
    const ADMIN_PASSWORD = "StrongPassword@123";

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [loginError, setLoginError] = useState("");

    const [loginForm, setLoginForm] = useState({
        username: "",
        password: "",
    });

    const [ruleForm, setRuleForm] = useState({
        category: "",
        subcategory: "",
        value: [], // ← now array for checkboxes,
        ruleText: "",
    });
    const [adminRules, setAdminRules] = useState([]);
    // ✅ TAB STATE
const [activeTab, setActiveTab] = useState("report");
// ✅ STRUCTURED NOTE RULE STATE
const [structuredNoteForm, setStructuredNoteForm] = useState({
    speciality: "",
    ruleText: ""
});

//HASNA NEW MODIFICATION MEDICAL CLINICAL CONTEXT 
const [medicalCurrentForm, setMedicalCurrentForm] = useState({
    speciality: "",
    medicalCategories: [],
    currentCategories: [],
    medicalRules: {},
    currentRules: {}
});

// ✅ CONTEXT RULE STATE
const [contextForm, setContextForm] = useState({
    speciality: "",
    medicalContextCategories: [],
    currentContextCategories: [],
    medicalContextRule: "",
    currentContextRule: ""
});

// ✅ Predefined categories
const medicalOutputCategories = [
   
];

const currentOutputCategories = [
    
];

// ✅ Input fields for adding new category
const [newMedicalCategory, setNewMedicalCategory] = useState("");
const [newCurrentCategory, setNewCurrentCategory] = useState("");

// ✅ Custom added categories
const [customMedicalCategories, setCustomMedicalCategories] = useState([]);
const [customCurrentCategories, setCustomCurrentCategories] = useState([]);
const [imageForm, setImageForm] = useState({
    category: "",
    subcategory: "",
    parameters: [],
    ruleText: ""
});

const [newImageValue, setNewImageValue] = useState("");
const [customImageValues, setCustomImageValues] = useState({});
    useEffect(() => {
        const fetchAdminRules = async () => {
            try {
                const res = await fetch(
                    `${API_BASE_URL}/hms/users/data/context/get_ReportAdminRules`
                );
                const data = await res.json();

                if (data.status === "success") {
                    setAdminRules(data.data);
                }
            } catch (err) {
                console.error("Failed to fetch admin rules", err);
            }
        };

        fetchAdminRules();
    }, []);

    const [customValues, setCustomValues] = useState({});
    const [newValueInput, setNewValueInput] = useState("");

    // ⬇️⬇️⬇️ PASTE LOGIN PAGE COMPONENT HERE ⬇️⬇️⬇️


    // ✅ PASTE saveRuleToBackend HERE ⬇️
    const saveRuleToBackend = async () => {
        try {
            if (
                !ruleForm.category ||
                !ruleForm.subcategory ||
                ruleForm.value.length === 0 ||
                !ruleForm.ruleText
            ) {
                alert("Please fill all fields");
                return;
            }

            const payload = {
                category: ruleForm.category,
                subcategory: ruleForm.subcategory,
                values: ruleForm.value, // ✅ ONLY SELECTED VALUES

                rule_text: ruleForm.ruleText,
            };

            const res = await fetch(
                `${API_BASE_URL}/hms/users/data/context/save_ReportAdminRule`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            );


            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.detail || "Failed to save rule");
            }

            alert("✅ Rule saved successfully");

            setRuleForm({
                category: "",
                subcategory: "",
                value: [],
                ruleText: "",
            });

        } catch (error) {
            console.error("Save rule error:", error);
            alert("❌ Failed to save rule");
        }
    };
const saveContextRule = async () => {
    try {
        if (
    !contextForm.speciality ||
    contextForm.medicalContextCategories.length === 0 ||
    contextForm.currentContextCategories.length === 0 ||
    !contextForm.medicalContextRule ||
    !contextForm.currentContextRule
) {
    alert("Please fill all fields");
    return;
}

const payload = {
    speciality: contextForm.speciality,
    medical_context_categories: contextForm.medicalContextCategories,
    medical_context_rule: contextForm.medicalContextRule,
    current_context_categories: contextForm.currentContextCategories,
    current_context_rule: contextForm.currentContextRule
};
        // ✅ CONSOLE THE DATA
        console.log("📦 Context Rule Payload:", payload);
        console.log("🌍 API URL:", `${API_BASE_URL}/hms/users/data/context/save_ContextAdminRule`);

        const res = await fetch(
           `${API_BASE_URL}/hms/users/data/context/save_ContextAdminRule`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }
        );

        console.log("📡 Response status:", res.status);

        const data = await res.json();
        console.log("📨 Response data:", data);

        if (!res.ok) {
            throw new Error(data.detail || "Failed to save context rule");
        }

        alert("✅ Context Rule saved successfully");

        setContextForm({
    speciality: "",
    medicalContextCategories: [],
    currentContextCategories: [],
    medicalContextRule: "",
    currentContextRule: ""
});

    } catch (error) {
        console.error("❌ Context save error:", error);
        alert("Failed to save context rule");
    }
};
const saveImageRuleToBackend = async () => {
    try {
        if (
            !imageForm.category ||
            !imageForm.subcategory ||
            imageForm.parameters.length === 0 ||
            !imageForm.ruleText
        ) {
            alert("Please fill all fields");
            return;
        }

        const payload = {
            category: imageForm.category,
            subcategory: imageForm.subcategory,
            parameters: imageForm.parameters,
            ruleText: imageForm.ruleText,
            is_active: true
        };

        console.log("📦 Image Rule Payload:", payload);

        const res = await fetch(
            `${API_BASE_URL}/hms/users/data/context/save_ImageAdminRule`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }
        );

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || "Failed to save image rule");
        }

        alert("✅ Image Rule saved successfully");

        setImageForm({
            category: "",
            subcategory: "",
            parameters: [],
            ruleText: ""
        });

    } catch (error) {
        console.error("❌ Save image rule error:", error);
        alert("Failed to save image rule");
    }
};

//HASNA NEW MODIFICATION MEDICAL CLINICAL CONTEXT 
const saveMedicalCurrentRules = async () => {
    try {
        if (!medicalCurrentForm.speciality) {
            alert("Please select speciality");
            return;
        }

        const medicalArray = Object.entries(medicalCurrentForm.medicalRules)
            .filter(([_, rule]) => rule && rule.trim() !== "")
            .map(([category, rule]) => ({
                medical_output_category: category,
                rule_text: rule
            }));

        const currentArray = Object.entries(medicalCurrentForm.currentRules)
            .filter(([_, rule]) => rule && rule.trim() !== "")
            .map(([category, rule]) => ({
                current_output_category: category,
                rule_text: rule
            }));

        const payload = {
            speciality: medicalCurrentForm.speciality,
            medical_context: medicalArray,
            current_context: currentArray
        };

        console.log("📦 Sending Payload:", payload);

        const res = await fetch(
            `${API_BASE_URL}/hms/users/data/context/save_MedicalCurrentAdminRule`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }
        );

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || "Failed to save");
        }

        alert("✅ Medical + Current Rule saved successfully");

        setMedicalCurrentForm({
            speciality: "",
            medicalCategories: [],
            currentCategories: [],
            medicalRules: {},
            currentRules: {}
        });

    } catch (error) {
        console.error("❌ Save error:", error);
        alert("Failed to save Medical + Current rule");
    }
};//HASNA NEW MODIFICATION MEDICAL CLINICAL CONTEXT 


// ✅ SAVE STRUCTURED NOTE RULE
const saveStructuredNoteRule = async () => {
    try {

        if (!structuredNoteForm.speciality || !structuredNoteForm.ruleText) {
            alert("Please fill all fields");
            return;
        }

        const payload = {
            speciality: structuredNoteForm.speciality,
            rule_text: structuredNoteForm.ruleText
        };

        console.log("📦 Structured Note Payload:", payload);

        const res = await fetch(
            `${API_BASE_URL}/hms/users/data/context/save_StructuredNoteAdminRule`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }
        );

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || "Failed to save rule");
        }

        alert("✅ Structured Note Rule saved successfully");

        setStructuredNoteForm({
            speciality: "",
            ruleText: ""
        });

    } catch (error) {
        console.error("❌ Save structured rule error:", error);
        alert("Failed to save structured note rule");
    }
};
    const getCheckboxValues = () => {
        if (!ruleForm.category || !ruleForm.subcategory) return [];

        // 1️⃣ predefined static values
        const staticValues =
            valueMap?.[ruleForm.category]?.[ruleForm.subcategory] || [];

        // 2️⃣ backend values
        const backendValues = adminRules
            .filter(
                (r) =>
                    r.category === ruleForm.category &&
                    r.subcategory === ruleForm.subcategory
            )
            .flatMap((r) => r.values || []);

        // 3️⃣ custom values (added via + button)
        const custom =
            customValues?.[ruleForm.category]?.[ruleForm.subcategory] || [];

        // 4️⃣ merge & remove duplicates
        return Array.from(
            new Set([...staticValues, ...backendValues, ...custom])
        );
    };


    const handleAddNewValue = () => {
        if (!newValueInput.trim()) return;

        setCustomValues((prev) => ({
            ...prev,
            [ruleForm.category]: {
                ...(prev[ruleForm.category] || {}),
                [ruleForm.subcategory]: [
                    ...(prev[ruleForm.category]?.[ruleForm.subcategory] || []),
                    newValueInput.trim(),
                ],
            },
        }));

        setRuleForm((prev) => ({
            ...prev,
            value: [...prev.value, newValueInput.trim()],
        }));

        setNewValueInput("");
    };

    // ⛔ DO NOT put functions after return
const specialityList = ["General Medicine",
    "Oncology",
   "Emergency",
    "Cardiology",
    "Pulmonology",
    "Endocrinology",
    "Gastroenterology",
    "Nephrology"
];
    const categoryMap = {
        laboratory: [
            "blood_test",
            "urine_test",
            "core_laboratory_panels_routine",
            "cardiac_markers","tumor_markers","diabetes_markers","hematology_specialized","vitamins_minerals","gi_markers",
            "sepsis_inflammation","microbiology","infectious_disease",
            "hormones_thyroid","hormones_adrenal","hormones_reproductive",
            "hormones_other","immunology","pathology_histology","arterial_blood_gas"
        ],

        radiology: [
           "xray",
            "ct_scan",
            "Mammography",
            "MRI",
            "mri_specialized",
            "cardiac_imaging",
            "Ultrasound",
            "obstetric_ultrasound",
            "doppler",
            "nuclear_medicine","interventional_radiology",
            "PET-CT","ct_angiography","dexa_scan"
            
        ],

        Speciality_Documents: [
            "Histopathology",
            "Cytology",
            "obstetrics",
            "Gastroenterology",
            "Cardiology","gynecology","pediatrics","oncology","dialysis","rehabilitation","psychiatry"
          
        ],functional: [
    "pulmonary","cardiac_tests","neurophysiology","endoscopy_gi","endoscopy_respiratory","endoscopy_urological","endoscopy_gynecological","endoscopy_joint","gi_manometry","urodynamics","sleep_studies","audiology","ophthalmology","cognitive_assessment","rehabilitation"
        ]
,
Discharge_Summary: [
    "General Medicine Discharge Summary",
            "Onco Discharge Summary","Gastroenterology Discharge Summary" ,"Cardiology Discharge Summary"  ,"clinical_summary"
        ],clinical: [
    "admission","progress_notes"
        ],referral: [
    "referrals"
        ],
 surgical: [
    "preoperative","operative","postoperative","interventional"
        ], pharmacy: [
    "prescriptions","medication_admin","pharmacy_review"
        ], emergency: [
    "emergency_records","critical_care"
        ],administrative: [
    "consent_forms","administrative_forms","medical_legal"
        ]

    
    };

    const valueMap = {
        laboratory: {
            blood_test: [
                "Hemoglobin",
                "HbA1c",
                "Total WBC Count",
                "Platelet Count",
                "Fasting Blood Sugar",
                "Postprandial Blood Sugar"
            ],

            urine_test: [
                "Creatinine",
                "RBS", "Urobilinogen - urine"
            ],

            core_laboratory_panels_routine: [
               "Complete Blood Count",
                    "Hemoglobin & Hematocrit",
                    "Differential Count",
                    "Peripheral Blood Smear",
                    "Blood Urea Nitrogen (BUN)",
                    "Serum Creatinine",
                    "Estimated Glomerular Filtration Rate (eGFR)",
                    "Serum Uric Acid",
                    "Serum Electrolytes Panel (Na, K, Cl, HCO3)",
                    "Serum Sodium",
                    "Serum Potassium",
                    "Serum Chloride",
                    "Serum Bicarbonate",
                    "Serum Calcium (Total)",
                    "Ionized Calcium",
                    "Serum Magnesium",
                    "Serum Phosphorus",
                    "Liver Function Test (LFT) - Complete",
                    "Total Protein",
                    "Serum Albumin",
                    "Globulin",
                    "Albumin/Globulin Ratio",
                    "Aspartate Aminotransferase (AST/SGOT)",
                    "Alanine Aminotransferase (ALT/SGPT)",
                    "Alkaline Phosphatase (ALP)",
                    "Gamma-Glutamyl Transferase (GGT)",
                    "Total Bilirubin",
                    "Direct Bilirubin",
                    "Indirect Bilirubin",
                    "Fasting Plasma Glucose",
                    "Postprandial Glucose",
                    "Random Blood Glucose",
                    "Hemoglobin A1c (HbA1c)",
                    "Lipid Profile - Complete",
                    "Total Cholesterol",
                    "LDL Cholesterol",
                    "HDL Cholesterol",
                    "Triglycerides",
                    "Urine Routine Examination",
                    "Urine Microscopy",
                    "Urine Protein",
                    "Urine Albumin-Creatinine Ratio (UACR)"
            ],
            cardiac_markers: [
                "Troponin I",
                    "Troponin T",
                    "High-Sensitivity Troponin",
                    "Creatine Kinase-MB (CK-MB)",
                    "B-Type Natriuretic Peptide (BNP)",
                    "NT-proBNP",
                    "High-Sensitivity C-Reactive Protein (hs-CRP)",
                    "D-Dimer",
                    "Homocysteine",
                    "Lipoprotein(a)"
            ],
               tumor_markers: [
                 "Prostate-Specific Antigen (PSA)",
                    "Free PSA",
                    "PSA Free/Total Ratio",
                    "Alpha-Fetoprotein (AFP)",
                    "Carcinoembryonic Antigen (CEA)",
                    "Cancer Antigen 125 (CA-125)",
                    "Cancer Antigen 19-9 (CA 19-9)",
                    "Cancer Antigen 15-3 (CA 15-3)",
                    "Beta-human Chorionic Gonadotropin (β-hCG)",
                    "Lactate Dehydrogenase (LDH)"
            ],
             diabetes_markers: [
                  "Glycated Albumin",
                    "C-Peptide",
                    "Insulin (Fasting)",
                    "Insulin (Postprandial)",
                    "Islet Cell Antibody",
                    "Glutamic Acid Decarboxylase Antibody (GAD)",
                    "Oral Glucose Tolerance Test (OGTT)"
            ],hematology_specialized: [
                   "Ferritin",
                    "Serum Iron",
                    "Total Iron Binding Capacity (TIBC)",
                    "Transferrin Saturation",
                    "Vitamin B12",
                    "Serum Folate",
                    "Reticulocyte Count",
                    "Coagulation Profile (PT/INR, APTT)",
                    "Prothrombin Time (PT)",
                    "International Normalized Ratio (INR)",
                    "Activated Partial Thromboplastin Time (APTT)",
                    "Bleeding Time",
                    "Clotting Time",
                    "Fibrinogen",
                    "D-Dimer",
                    "Coagulation Factor Assays",
                    "Platelet Function Tests",
                    "Thromboelastography (TEG)",
                    "Flow Cytometry (Hematologic Malignancy)"
            ],
           vitamins_minerals: [
                 "25-Hydroxy Vitamin D",
                    "Vitamin D3",
                    "Vitamin B12",
                    "Serum Folate",
                    "Iron Studies",
                    "Calcium",
                    "Magnesium",
                    "Phosphorus",
                    "Zinc",
                    "Copper"
            ],
            gi_markers: [
               "Amylase",
                    "Lipase",
                    "Fecal Calprotectin",
                    "Fecal Occult Blood Test (FOBT)",
                    "Fecal Fat Quantification",
                    "Gastric Emptying Study",
                    "Hydrogen Breath Test (Lactose)",
                    "Hydrogen Breath Test (Fructose)",
                    "Urea Breath Test (Helicobacter pylori)"
            ],
            sepsis_inflammation: [
                 "Procalcitonin",
                    "Serum Lactate",
                    "Interleukin-6 (IL-6)",
                    "C-Reactive Protein (CRP)",
                    "Erythrocyte Sedimentation Rate (ESR)"
            ],
            microbiology: [
                 "Blood Culture",
                    "Urine Culture",
                    "Sputum Culture",
                    "Stool Culture",
                    "Wound Swab Culture",
                    "Pus Culture",
                    "Cerebrospinal Fluid Culture",
                    "Gram Stain",
                    "Acid-Fast Bacilli (AFB) Smear",
                    "Mycobacterium tuberculosis Culture",
                    "CBNAAT (GeneXpert)",
                    "Line Probe Assay (LPA)",
                    "Antibiotic Sensitivity Testing",
                    "Fungal Culture",
                    "KOH Mount"
            ],
            infectious_disease: [
                "Malaria Peripheral Smear",
                    "Rapid Malaria Antigen Test",
                    "Widal Test",
                    "Weil-Felix Test",
                    "Dengue NS1 Antigen",
                    "Dengue IgM Antibody",
                    "Dengue IgG Antibody",
                    "Chikungunya IgM Antibody",
                    "Zika Virus PCR",
                    "COVID-19 RT-PCR",
                    "Influenza A/B PCR",
                    "Hepatitis B Surface Antigen (HBsAg)",
                    "Hepatitis B e Antigen (HBeAg)",
                    "Hepatitis C Antibody",
                    "HIV 1/2 Antibody",
                    "HIV Viral Load",
                    "CD4 Count",
                    "CD8 Count",
                    "Syphilis VDRL",
                    "TPHA (Treponema pallidum)"
            ],
            hormones_thyroid: [
                "Thyroid Stimulating Hormone (TSH)",
                    "Free T4",
                    "Free T3",
                    "Total T4",
                    "Total T3",
                    "Anti-Thyroid Peroxidase Antibody (Anti-TPO)",
                    "Anti-Thyroglobulin Antibody",
                    "Thyroglobulin"
            ],
            hormones_adrenal: [
                 "Serum Cortisol (Morning)",
                    "Serum Cortisol (Evening)",
                    "Adrenocorticotropic Hormone (ACTH)",
                    "Aldosterone",
                    "Plasma Renin Activity",
                    "24-Hour Urinary Cortisol",
                    "Metanephrines"
            ],
            hormones_reproductive: [
                 "Luteinizing Hormone (LH)",
                    "Follicle Stimulating Hormone (FSH)",
                    "Estradiol (E2)",
                    "Progesterone",
                    "Testosterone (Total)",
                    "Free Testosterone",
                    "Dehydroepiandrosterone Sulfate (DHEAS)",
                    "Prolactin",
                    "Anti-Mullerian Hormone (AMH)",
                    "Sex Hormone Binding Globulin (SHBG)",
                    "Beta-hCG (Quantitative)"
            ],
            hormones_other: [
                 "Parathyroid Hormone (PTH)",
                    "Insulin-like Growth Factor 1 (IGF-1)",
                    "Growth Hormone",
                    "Calcitonin",
                    "Vitamin D (1,25-Dihydroxy)"
            ],immunology: [
                "Antinuclear Antibody (ANA)",
                    "Anti-dsDNA Antibody",
                    "Anti-Smith Antibody",
                    "Rheumatoid Factor (RF)",
                    "Anti-Cyclic Citrullinated Peptide (Anti-CCP)",
                    "Complement C3",
                    "Complement C4",
                    "Anti-Neutrophil Cytoplasmic Antibody (ANCA)",
                    "p-ANCA",
                    "c-ANCA",
                    "Anti-Cardiolipin Antibody (IgG, IgM)",
                    "Lupus Anticoagulant",
                    "Beta-2 Glycoprotein I Antibody",
                    "Immunoglobulin G (IgG)",
                    "Immunoglobulin A (IgA)",
                    "Immunoglobulin M (IgM)",
                    "Immunoglobulin E (Total IgE)",
                    "Serum Protein Electrophoresis",
                    "Immunofixation Electrophoresis"
            ],
            pathology_histology: [
                "Histopathological Examination (HPE)",
                    "Fine Needle Aspiration Cytology (FNAC)",
                    "Core Needle Biopsy",
                    "Excisional Biopsy",
                    "Incisional Biopsy",
                    "Tru-Cut Biopsy",
                    "Endoscopic Biopsy",
                    "Image-Guided Biopsy Report",
                    "Frozen Section Analysis",
                    "Immunohistochemistry (IHC)",
                    "Special Stains (PAS, Ziehl-Neelsen)",
                    "Molecular Pathology Report",
                    "FISH Analysis",
                    "PCR Tissue Analysis",
                    "Tumor Grading Report",
                    "Tumor Staging (TNM) Report",
                    "Mitotic Index Assessment",
                    "Ki-67 Proliferation Index",
                    "Molecular Tumor Profiling",
                    "Bone Marrow Aspiration Report",
                    "Bone Marrow Biopsy Report"
            ],
            arterial_blood_gas: [
                "Arterial Blood Gas (ABG)",
                    "Venous Blood Gas (VBG)",
                    "pH",
                    "pCO2",
                    "pO2",
                    "HCO3",
                    "Base Excess",
                    "Lactate"
            ]
        },

        radiology: {
        xray: [
                "Chest X-ray (PA View)",
                    "Chest X-ray (AP View)",
                    "Chest X-ray (Lateral View)",
                    "Abdomen X-ray (Erect)",
                    "Abdomen X-ray (Supine)",
                    "X-ray KUB (Kidney-Ureter-Bladder)",
                    "X-ray Skull (AP/Lateral)",
                    "X-ray Cervical Spine",
                    "X-ray Thoracic Spine",
                    "X-ray Lumbar Spine",
                    "X-ray Pelvis",
                    "X-ray Hip Joint",
                    "X-ray Knee Joint (AP/Lateral)",
                    "X-ray Shoulder Joint",
                    "X-ray Elbow Joint",
                    "X-ray Wrist Joint",
                    "X-ray Hand",
                    "X-ray Foot",
                    "X-ray Ankle Joint",
                    "X-ray Femur",
                    "X-ray Tibia/Fibula",
                    "X-ray Humerus",
                    "X-ray Radius/Ulna",
                    "X-ray Paranasal Sinuses (Waters View)",
                    "X-ray Nasal Bone",
                    "X-ray IVU (Intravenous Urography)"
            ],

           ct_scan: [
                                "Liver",
                "Extrahepatic Bile Ducts",
                "Pancreas",
                "Ureters",
                "Bowel",
                "Appendix",
                "Lymph Nodes",
                "Vertebrae",
                "Lungs (Basal sections)",
                "Abdominal aorta",
                "Peritoneal Cavity",
                "Diverticula",
                "Urinary Bladder",
                "Spleen",
                "Gall Bladder",
                "Right Kidney",
                "Left Kidney",
"CT Brain (Plain)",
                    "CT Brain (Contrast)",
                    "CT Chest (Plain)",
                    "CT Chest (Contrast)",
                    "CT Chest HRCT",
                    "CT Abdomen (Plain)",
                    "CT Abdomen (Contrast)",
                    "CT Abdomen and Pelvis",
                    "CT KUB (Non-Contrast)",
                    "CT Spine (Cervical)",
                    "CT Spine (Thoracic)",
                    "CT Spine (Lumbar)",
                    "CT Paranasal Sinuses",
                    "CT Temporal Bone",
                    "CT Neck (Plain/Contrast)",
                    "CT Enterography",
                    "CT Colonography",
                    "CT Urography",
                    "CT Guided Biopsy"
            ],
            ct_angiography:["CT Angiography Brain",
                    "CT Angiography Coronary (CTCA)",
                    "CT Pulmonary Angiography (CTPA)",
                    "CT Aortography",
                    "CT Peripheral Angiography",
                    "CT Renal Angiography"],

             Mammography: [
                 "Mammography (Bilateral)",
                    "Digital Mammography",
                    "Tomosynthesis (3D Mammography)","Breast Density Right",
                "Breast Density Left",
                "Right Breast Findings",
                "Right Axilla",
                "Right Breast USG",
                "Right Breast Size",
                "Right Breast Position",
                "Right Breast Depth",
                "Left Breast Findings",
                "Left Breast USG",
                "Left Axilla",
                "Additional Mammographic Observations",
                "Impression",
                "Right Breast Location",
                "USG Correlation – Right Breast",
                "USG – Left Breast",
                "Breast Parenchyma",
                "Bilateral Breast Composition",
                "Axillary Lymph Node (Right)"
            ], dexa_scan: [
                "DEXA Scan (Bone Densitometry)",
                    "DEXA Spine",
                    "DEXA Hip"
            ],

            cardiac_imaging: [
                 "Echocardiography (2D Echo)",
                    "Doppler Echocardiography",
                    "Stress Echocardiography",
                    "Transesophageal Echocardiography (TEE)",
                    "Fetal Echocardiography",
                    "Cardiac CT",
                    "Cardiac MRI",
                    "Coronary Angiography"
            ],
             MRI:[                 "Clinical Background",
                "Dorsal Spine",
                "Posterior Longitudinal Ligament",
                "Spinal Cord",
                "Intraosseous Lesions",
                "Vertebral Body",
                "Degenerative Changes",
                "C2–C3",
                "C3–C4",
                "C4–C5",
                "C5–C6",
                "C6–C7",
                "C7–T1",
                "L1–L2",
                "L4–L5",
                "L5–S1",
                "Cervical Spine",
                "Lumbar Spine",
                "L2–L3",
                "L3–L4",
                "General Lumbar Changes",
                "Sacroiliac Joints",
                "Axial",
                "Sagittal",
                "Coronal",
                "Breast composition",
                "Background parenchymal enhancement",
                "Right Breast Findings",
                "Right Breast Location",
                "Left Breast Findings",
                "Impression",
                "Acute Findings",
                "Chronic Changes",
                "Basal ganglia & thalami",
                "Brainstem",
                "Ventricles & cisterns",
                "ACA",
                "MCA",
                "Vertebral arteries",
                "Basilar artery",
                "PCA",
                "Internal Carotid Arteries (ICA)",
                "Carotid Arteries",
                "Other Brain Structures",
                "Internal carotid arteries",
                "Intracranial circulation",
                "Compression Fractures",
                "Multiple Compression Fractures",
                "Bone Marrow Signal",
                "Additional Vertebral Findings",
                "Prostate dimensions",
                "Prostate volume",
                "PSA density",
                "Suspicious Lesion (Peripheral Zone) Location",
                "Suspicious Lesion (Peripheral Zone) Size",
                "PI-RADS Score",
                "Transitional Zone",
                "Lymph Nodes & Spread"
,"MRI Brain (Plain)",
                    "MRI Brain (Contrast)",
                    "MRI Brain with MR Angiography",
                    "MRI Brain with MR Venography",
                    "MRI Epilepsy Protocol",
                    "MRI Pituitary",
                    "MRI Internal Auditory Canal (IAC)",
                    "MRI Spine (Cervical)",
                    "MRI Spine (Thoracic)",
                    "MRI Spine (Lumbar)",
                    "MRI Whole Spine",
                    "MRI Knee Joint",
                    "MRI Shoulder Joint",
                    "MRI Hip Joint",
                    "MRI Ankle Joint",
                    "MRI Wrist Joint",
                    "MRI Elbow Joint",
                    "MRI Brachial Plexus",
                    "MRI Abdomen",
                    "MRI Pelvis",
                    "MRI Liver (Contrast)",
                    "MR Cholangiopancreatography (MRCP)",
                    "MR Enterography",
                    "MR Urography"],
                   mri_specialized:["MRI Prostate (Multiparametric)",
                    "MRI Breast (Bilateral)",
                    "MRI Placenta (Accreta Protocol)",
                    "MRI Fetal",
                    "Cardiac MRI",
                    "MR Angiography Brain",
                    "MR Angiography Neck",
                    "MR Angiography Peripheral",
                    "MRI Tumor Protocol"],
                    interventional_radiology:[ "Fluoroscopy Barium Swallow",
                    "Barium Meal Study",
                    "Barium Follow Through",
                    "Barium Enema",
                    "Hysterosalpingography (HSG)",
                    "Micturating Cystourethrogram (MCU)",
                    "Voiding Cystourethrogram (VCUG)",
                    "Sinogram",
                    "Fistulogram",
                    "Sialography",
                    "Digital Subtraction Angiography (DSA)",
                    "Coronary Angiography",
                    "Peripheral Angiography",
                    "Cerebral Angiography"],
                     nuclear_medicine:["PET CT (Whole Body)",
                    "PET MRI",
                    "Myocardial Perfusion Imaging (SPECT)",
                    "Bone Scan (Tc-99m)",
                    "Thyroid Scan (Technetium)",
                    "Renal Nuclear Scan (DTPA)",
                    "Renal Nuclear Scan (MAG3)",
                    "Gallium Scan",
                    "Nuclear Renal Split Function Test"],
            PET_CT:[],
            Ultrasound:[ "Ultrasound Abdomen (Whole)",
                    "Ultrasound Abdomen (Upper)",
                    "Ultrasound Pelvis (Male)",
                    "Ultrasound Pelvis (Female)",
                    "Ultrasound KUB",
                    "Ultrasound Hepatobiliary System",
                    "Ultrasound Pancreas",
                    "Ultrasound Spleen",
                    "Ultrasound Thyroid",
                    "Ultrasound Breast",
                    "Ultrasound Scrotum",
                    "Ultrasound Prostate (Transabdominal)",
                    "Transrectal Ultrasound Prostate (TRUS)",
                    "Ultrasound Soft Tissue/Neck",
                    "Ultrasound Guided Biopsy",
                    "FAST Scan (Trauma)","Impression",
                "Both CCA and IJV",
                "Neck musculature",
                "Lymph Nodes",
                "Isthmus / Junction size",
                "Isthmus / Junction Location",
                "Isthmus / Junction",
                "Additional Finding",
                "Left Lobe Main Nodule",
                "Right Lobe",
                "Bilateral carotid arteries",
                "Submandibular glands",
                "Parotid glands",
                "Lymph Nodes Left level III",
                "Lymph Nodes Right level III",
                "Isthmus",
                "Isthmus Thickness",
                "Left Lobe Size",
                "Left Lobe",
                "Right Lobe Size",
                "Internal jugular veins",
                "Carotid arteries",
                "Nodule 1",
                "Nodule 2",
                "Parenchyma",
                "Neck Vessels",
                "Cervical Lymph Nodes",
                "Free Fluid",
                "Ovaries",
                "Uterus Size",
                "Uterus Location",
                "Uterus",
                "Urinary Bladder",
                "Left Kidney",
                "Right Kidney",
                "Advice",
                "Post-Procedure",
                "Pre-Procedure",
                "Right Testis & Epididymis",
                "Left Testis & Epididymis",
                "Spermatic Cord Right",
                "Spermatic Cord Left",
                "Varicocele",
                "Tunica Vaginalis Right side",
                "Tunica Vaginalis Left side",
                "Right Epididymis",
                "Left Epididymis",
                "Right Testis",
                "Left Testis",
                "Axillary Findings",
                "Pectoralis Muscle",
                "Cystic Lesion",
                "Left Axilla",
                "Left Breast Findings",
                "Right Axilla",
                "Right Breast Findings",
                "Lesion Characteristics",
                "Right lobe size",
                "Liver",
                "Gall Bladder",
                "Pancreas",
                "Spleen",
                "Pelvic Organs",
                "Ascites",
                "Anterior Abdominal Wall",
                "Pouch of Douglas",
                "Portal Vein & CBD",
                "Pre & Para-aortic Area",
                "Pre & Para-aortic Area",
                "Prostate",
                "Upper Retroperitoneum",
                "Thyroid gland",
                "Cystic nodule",
                "Soft Tissue Findings",
                "Both parotid glands",
                "Submandibular glands"
],
             obstetric_ultrasound:["Ultrasound Early Pregnancy/Dating Scan",
                    "Ultrasound NT Scan (Nuchal Translucency)",
                    "Ultrasound Anomaly Scan (Level II)",
                    "Ultrasound Growth Scan (Third Trimester)",
                    "Ultrasound Follicular Study",
                    "Obstetric Doppler Study",
                    "Ultrasound Biophysical Profile (BPP)"],


                doppler:["Color Doppler Lower Limb Arteries",
                    "Color Doppler Lower Limb Veins",
                    "Color Doppler Upper Limb Arteries",
                    "Color Doppler Upper Limb Veins",
                    "Renal Doppler",
                    "Carotid Doppler",
                    "Portal Vein Doppler",
                    "Penile Doppler",
                    "Transcranial Doppler (TCD)"]


           
        },

        Speciality_Documents: {
            Histopathology: [
                
            ],
             obstetrics:["Antenatal Care Record",
                    "Prenatal Visit Note",
                    "Labor and Delivery Note",
                    "Partogram",
                    "Non-Stress Test (NST) Report",
                    "Cardiotocography (CTG) Report",
                    "Biophysical Profile (BPP)",
                    "Postpartum Note",
                    "Lactation Consultation"],
            Cytology: [
                
            ],

            Gastroenterology: [
                
            ],

           Cardiology: [
              
            ],
gynecology: [
               "Gynecological Examination Note",
                    "Pap Smear Report",
                    "Cervical Biopsy Report",
                    "Endometrial Biopsy Report",
                    "Menstrual History",
                    "Contraception Counseling Note"
            ],pediatrics:["Well Child Visit Note",
                    "Growth Chart",
                    "Developmental Milestone Assessment",
                    "Immunization Record",
                    "Pediatric Physical Examination",
                    "Newborn Screening Results"],oncology:["Oncology Consultation Note",
                    "Chemotherapy Protocol",
                    "Chemotherapy Administration Record",
                    "Radiation Oncology Plan",
                    "Tumor Board Discussion Note",
                    "Cancer Staging Documentation",
                    "Minimal Residual Disease (MRD) Report",
                    "Molecular Tumor Profiling Report"],dialysis:[ "Hemodialysis Session Record",
                    "Peritoneal Dialysis Record",
                    "Vascular Access Monitoring",
                    "Dialysis Adequacy (Kt/V) Report",
                    "Renal Biopsy Report"],rehabilitation:[  "Physical Therapy Evaluation",
                    "Physical Therapy Progress Note",
                    "Occupational Therapy Evaluation",
                    "Speech Therapy Evaluation",
                    "Rehabilitation Plan of Care"],psychiatry:[  "Psychiatric Evaluation",
                    "Mental Status Examination",
                    "Psychiatric Progress Note",
                    "Psychotherapy Note",
                    "Suicide Risk Assessment",
                    "Involuntary Commitment Documentation"]
          
        },

        functional: {  pulmonary: [
                    "Spirometry (Complete)",
                    "Forced Vital Capacity (FVC)",
                    "Forced Expiratory Volume (FEV1)",
                    "FEV1/FVC Ratio",
                    "Peak Expiratory Flow Rate (PEFR)",
                    "Forced Expiratory Flow 25-75% (FEF25-75)",
                    "Bronchodilator Reversibility Test",
                    "Lung Volumes (TLC, RV, FRC)",
                    "Diffusing Capacity (DLCO)",
                    "Airway Resistance Measurement",
                    "Six Minute Walk Test (6MWT)",
                    "Cardiopulmonary Exercise Testing (CPET)",
                    "Methacholine Challenge Test",
                    "Exercise-Induced Bronchoconstriction Test"
                ]
            ,
            cardiac_tests:  [
                    "Electrocardiogram (ECG) - Resting",
                    "Stress ECG (Treadmill Test - TMT)",
                    "Holter Monitoring (24 Hour ECG)",
                    "Ambulatory Blood Pressure Monitoring (ABPM)",
                    "Tilt Table Test",
                    "Signal-Averaged ECG",
                    "Heart Rate Variability Analysis",
                    "Pacemaker Interrogation",
                    "ICD Interrogation",
                    "Fractional Flow Reserve (FFR)",
                    "Intravascular Ultrasound (IVUS)",
                    "Optical Coherence Tomography (Coronary OCT)",
                    "Cardiac Autonomic Reflex Tests"
                ]
            ,
            neurophysiology: [
                    "Electroencephalogram (EEG)",
                    "Video EEG Monitoring",
                    "Long-Term Video EEG Monitoring",
                    "Sleep EEG",
                    "Quantitative EEG (qEEG)",
                    "Visual Evoked Potential (VEP)",
                    "Brainstem Auditory Evoked Response (BAER/ABR)",
                    "Somatosensory Evoked Potential (SSEP)",
                    "Electromyography (EMG)",
                    "Nerve Conduction Study (NCS)",
                    "Repetitive Nerve Stimulation Test",
                    "Autonomic Function Tests",
                    "Intraoperative Neurophysiological Monitoring (IONM)"
                ]
            ,
            endoscopy_gi:  [
                    "Upper GI Endoscopy (EGD)",
                    "Colonoscopy",
                    "Sigmoidoscopy",
                    "Proctoscopy",
                    "Enteroscopy",
                    "Capsule Endoscopy",
                    "Endoscopic Retrograde Cholangiopancreatography (ERCP)",
                    "Endoscopic Ultrasound (EUS)",
                    "Esophageal Varices Grading",
                    "Barrett's Esophagus Assessment",
                    "Colonic Polyp Detection Report"
                ]
            ,
            endoscopy_respiratory:  [
                    "Bronchoscopy",
                    "Flexible Bronchoscopy",
                    "Rigid Bronchoscopy",
                    "Bronchoalveolar Lavage (BAL)",
                    "Endobronchial Biopsy",
                    "CT Virtual Bronchoscopy"
                ]
            ,
            endoscopy_urological:[
                    "Cystoscopy",
                    "Ureteroscopy",
                    "Bladder Lesion Evaluation"
                ]
            ,
            endoscopy_gynecological:  [
                    "Hysteroscopy",
                    "Colposcopy",
                    "Laparoscopy (Diagnostic)"
                ]
            ,
            endoscopy_joint:  [
                    "Arthroscopy (Diagnostic) - Knee",
                    "Arthroscopy (Diagnostic) - Shoulder",
                    "Arthroscopy (Diagnostic) - Hip",
                    "Arthroscopy (Diagnostic) - Ankle"
                ]
            ,
            gi_manometry: [
                    "Anorectal Manometry",
                    "Esophageal Manometry",
                    "24 Hour pH Monitoring",
                    "Impedance pH Study",
                    "Small Bowel Manometry"
                ]
            ,
            urodynamics:  [
                    "Urodynamic Study (Complete)",
                    "Cystometrogram",
                    "Uroflowmetry",
                    "Pressure Flow Study",
                    "Post-Void Residual Volume",
                    "Ambulatory Urodynamic Study"
                ]
            ,
            sleep_studies:  [
                    "Polysomnography (Level I)",
                    "Polysomnography (Level II)",
                    "Polysomnography (Level III)",
                    "Polysomnography (Level IV)",
                    "CPAP Titration Study",
                    "BiPAP Titration Study",
                    "Overnight Pulse Oximetry",
                    "Multiple Sleep Latency Test (MSLT)"
                ]
            ,
            audiology:  [
                    "Pure Tone Audiometry (PTA)",
                    "Speech Audiometry",
                    "Tympanometry",
                    "Impedance Audiometry",
                    "Auditory Brainstem Response (ABR)",
                    "Otoacoustic Emissions (OAE)",
                    "Vestibular Function Tests"
                ]
            ,
            ophthalmology:  [
                    "Visual Acuity Test",
                    "Visual Field Analysis (Perimetry)",
                    "Optical Coherence Tomography (OCT) - Eye",
                    "Fundus Photography",
                    "Fluorescein Angiography",
                    "Tonometry (IOP Measurement)",
                    "Corneal Topography",
                    "A-Scan Biometry",
                    "B-Scan Ultrasound (Eye)"
                ]
            ,
            cognitive_assessment:  [
                    "Mini-Mental State Examination (MMSE)",
                    "Montreal Cognitive Assessment (MoCA)",
                    "Glasgow Coma Scale (GCS)",
                    "Neuropsychological Testing"
                ],
            
            rehabilitation:  [
                    "Gait Analysis",
                    "Range of Motion Assessment",
                    "Functional Independence Measure (FIM)",
                    "Diagnostic Nerve Block Test"
                ]},
        Discharge_Summary: {
            Onco_Discharge_Summary: [
                
            ],General_Medicine_Discharge_Summary: [
                
            ],Gastroenterology_Discharge_Summary:[],Cardiology_Discharge_Summary:[],clinical_summary:["Episode of Care Summary",
                    "Continuity of Care Document",
                    "Treatment Summary Report",
                    "Hospital Course Summary"]
          
        },
clinical: {
         admission: 
                 [
                    "Admission Note",
                    "History & Physical Examination",
                    "Chief Complaint Documentation",
                    "Presenting Illness Documentation",
                    "Past Medical History",
                    "Family History",
                    "Social History",
                    "Medication History",
                    "Allergy Documentation"
                ]
            ,
            progress_notes:  [
                    "Daily Progress Note",
                    "SOAP Note",
                    "Consultant Note",
                    "Specialty Consultation Report",
                    "Follow-up Note",
                    "Telephone Encounter Note",
                    "Clinical Note"
                ]
            }, referral: {
         referrals: 
                 [
                    "Specialist Referral Letter",
                    "Primary Care Referral",
                    "Inter-Hospital Transfer Note",
                    "Emergency Transfer Documentation",
                    "Referral Response Letter"
                ]
            
            },  administrative: {
         consent_forms: 
                 [
                   "Informed Consent for Procedure",
                    "Informed Consent for Surgery",
                    "Anesthesia Consent",
                    "Blood Transfusion Consent",
                    "Research Study Consent",
                    "Photography/Video Consent",
                    "Release of Medical Records Authorization"
                ],administrative_forms: 
                 [
                   "Patient Registration Form",
                    "Advance Directive",
                    "Living Will",
                    "Healthcare Power of Attorney",
                    "DNR (Do Not Resuscitate) Order",
                    "POLST (Physician Orders for Life-Sustaining Treatment)",
                    "Patient Rights & Responsibilities",
                    "Privacy Policy Acknowledgment (HIPAA)",
                    "Financial Agreement"
                ],medical_legal: 
                 [ "Fitness for Work Certificate",
                    "Medical Leave Certificate",
                    "Disability Certificate",
                    "Medico-Legal Case (MLC) Documentation",
                    "Autopsy Report",
                    "Death Certificate",
                    "Birth Certificate"
                ]
            
            }, surgical: { preoperative:  [
                    "Pre-Operative Assessment",
                    "Pre-Anesthetic Evaluation",
                    "Surgical Consent Form",
                    "Pre-Operative Checklist",
                    "Surgical Safety Checklist (WHO)",
                    "Risk Assessment & Stratification"
                ]
            ,
            operative: [
                    "Operative Note",
                    "Procedure Note",
                    "Surgeon's Report",
                    "Anesthesia Record",
                    "Intra-Operative Nursing Note",
                    "Implant Documentation",
                    "Surgical Specimen Documentation"
                ]
            ,
            postoperative: [
                    "Post-Operative Note",
                    "Post-Anesthesia Care Unit (PACU) Note",
                    "Recovery Room Record",
                    "Post-Operative Orders",
                    "Post-Operative Complications Note"
                ]
            ,
            interventional: [
                    "Cardiac Catheterization Report",
                    "Coronary Angioplasty Report",
                    "Stent Placement Record",
                    "Pacemaker Implantation Record",
                    "ICD Implantation Record",
                    "Percutaneous Biopsy Report",
                    "Therapeutic Endoscopy Report",
                    "Dialysis Access Procedure",
                    "Central Line Placement Note",
                    "Lumbar Puncture Note",
                    "Thoracentesis Note",
                    "Paracentesis Note",
                    "Joint Aspiration Note",
                    "Bone Marrow Biopsy Procedure Note"
                ]
            }, pharmacy: { prescriptions:  [
                    "Outpatient Prescription",
                    "Discharge Prescription",
                    "Controlled Substance Prescription",
                    "Chronic Disease Prescription",
                    "Electronic Prescription (e-Rx)"
                ]
            ,
            medication_admin:  [
                    "Medication Administration Record (MAR)",
                    "IV Medication Record",
                    "Controlled Drug Administration Record",
                    "PRN (As Needed) Medication Log",
                    "Medication Reconciliation Form"
                ]
            ,
            pharmacy_review: 
                 [
                    "Pharmacist Consultation Note",
                    "Drug Interaction Check",
                    "Therapeutic Drug Monitoring Report",
                    "Adverse Drug Reaction Report",
                    "Medication Therapy Management (MTM)"
                ]
            },  emergency: {emergency_records:  [
                    "Emergency Department Triage Note",
                    "ED Physician Note",
                    "Trauma Documentation",
                    "FAST Scan Report",
                    "Emergency Procedure Note",
                    "ED Discharge Instructions",
                    "Against Medical Advice (AMA) Form"
                ]
            ,
            critical_care: [
                    "ICU Admission Note",
                    "Daily ICU Progress Note",
                    "Ventilator Settings Record",
                    "Arterial Line Record",
                    "Central Line Documentation",
                    "Vasopressor/Inotrope Titration Record",
                    "Sedation Assessment",
                    "Delirium Screening (CAM-ICU)",
                    "Code Blue Documentation",
                    "Rapid Response Team Note"
                ]
            }
    };
const imageCategoryMap = {

  /* ======================= 1. X-RAY ======================= */
  "X-RAY": {

    "Chest X-Ray": [
      "View Type (PA / AP / Lateral)",
      "Lung Fields (Clear / Opacity / Consolidation)",
      "Cardiothoracic Ratio",
      "Heart Size (Normal / Enlarged)",
      "Costophrenic Angle (Clear / Blunted)",
      "Pleural Effusion (Present / Absent)",
      "Pneumothorax (Yes / No)",
      "Rib Fracture (Yes / No)",
      "Mediastinal Shift",
      "Impression"
    ],

    "Shoulder X-Ray": [
      "Side",
      "View Type",
      "Glenohumeral Alignment",
      "Clavicle Fracture",
      "Dislocation",
      "Joint Space",
      "Calcification",
      "Impression"
    ],

    "Abdomen X-Ray": [
      "View (Erect / Supine)",
      "Bowel Gas Pattern",
      "Air-Fluid Levels",
      "Calcification / Stone",
      "Organ Shadow",
      "Free Air Under Diaphragm",
      "Impression"
    ],

    "Hand X-Ray": [
      "Side (Left / Right)",
      "View (AP / Lateral / Oblique)",
      "Bone Alignment",
      "Fracture (Present / Absent)",
      "Dislocation",
      "Joint Space Narrowing",
      "Soft Tissue Swelling",
      "Bone Density",
      "Foreign Body",
      "Impression"
    ],

    "Knee X-Ray": [
      "Side (Left / Right)",
      "View (AP / Lateral / Skyline)",
      "Joint Space Width",
      "Osteophytes",
      "Fracture",
      "Patella Position",
      "Alignment",
      "Effusion",
      "Bone Lesion",
      "Impression"
    ],

    "Spine X-Ray": [
      "Region (Cervical / Thoracic / Lumbar)",
      "Alignment",
      "Vertebral Body Height",
      "Disc Space Narrowing",
      "Osteophytes",
      "Scoliosis",
      "Spondylolisthesis",
      "Fracture",
      "Impression"
    ],

    "Skull X-Ray": [
      "View (AP / Lateral / Waters)",
      "Skull Fracture",
      "Sinus Opacity",
      "Bone Lesion",
      "Calcification",
      "Intracranial Air",
      "Impression"
    ]
  },

  /* ======================= 2. ULTRASOUND ======================= */
  "ULTRASOUND (USG)": {

    "Abdomen Ultrasound": [
      "Liver Size (cm)",
      "Liver Echotexture",
      "Gallbladder Stone (Yes/No)",
      "Gallbladder Wall Thickness",
      "Common Bile Duct Diameter",
      "Pancreas Appearance",
      "Spleen Size",
      "Right Kidney Size",
      "Left Kidney Size",
      "Hydronephrosis (Yes/No)",
      "Free Fluid",
      "Impression"
    ],

    "Thyroid Ultrasound": [
      "Thyroid Size",
      "Nodule Size",
      "Nodule Type (Solid / Cystic)",
      "Vascularity (Doppler)",
      "Calcification",
      "Lymph Nodes",
      "TI-RADS Category",
      "Impression"
    ],

    "Breast Ultrasound": [
      "Mass Size",
      "Shape (Regular / Irregular)",
      "Margins",
      "Cyst / Solid",
      "Vascularity",
      "Axillary Lymph Nodes",
      "BI-RADS",
      "Impression"
    ],

    "Scrotal Ultrasound": [
      "Testis Size",
      "Echotexture",
      "Torsion",
      "Varicocele",
      "Hydrocele",
      "Epididymis Appearance",
      "Doppler Flow",
      "Impression"
    ],

    "Pelvic Ultrasound": [
      "Uterus Size",
      "Endometrial Thickness",
      "Right Ovary Size",
      "Left Ovary Size",
      "Ovarian Cyst (Yes/No)",
      "Fibroid (Yes/No)",
      "Free Fluid in Pouch of Douglas",
      "Impression"
    ],

    "Obstetric Ultrasound": [
      "Gestational Age (weeks)",
      "Fetal Heart Rate (bpm)",
      "Crown Rump Length (CRL)",
      "Biparietal Diameter (BPD)",
      "Femur Length (FL)",
      "Placenta Position",
      "Amniotic Fluid Index (AFI)",
      "Fetal Movement",
      "Impression"
    ]
  },

  /* ======================= 3. CT SCAN ======================= */
  "CT SCAN": {

    "Brain CT": [
      "Hemorrhage (Yes/No)",
      "Infarct Area",
      "Midline Shift",
      "Ventricular Size",
      "Mass Lesion",
      "Skull Fracture",
      "Contrast Used",
      "Impression"
    ],

    "Chest CT": [
      "Lung Nodules (Size mm)",
      "Consolidation",
      "Pleural Effusion",
      "Fibrosis",
      "Lymph Node Enlargement",
      "Mass Lesion",
      "Impression"
    ],

    "Abdomen & Pelvis CT": [
      "Liver Lesion",
      "Pancreatic Mass",
      "Kidney Stone (Size mm)",
      "Bowel Obstruction",
      "Lymphadenopathy",
      "Free Fluid",
      "Contrast Used",
      "Impression"
    ],

    "CT Angiography (CTA)": [
      "Vessel Patency",
      "Stenosis (%)",
      "Thrombosis",
      "Aneurysm",
      "Plaque",
      "Contrast Used",
      "Impression"
    ],

    "CT Spine": [
      "Vertebral Fracture",
      "Alignment",
      "Disc Space",
      "Canal Stenosis",
      "Bone Fragment",
      "Impression"
    ]
  },

  /* ======================= 4. MRI ======================= */
  "MRI": {

    "Brain MRI": [
      "Sequence (T1/T2/FLAIR/DWI)",
      "Tumor Size",
      "Edema",
      "Demyelination",
      "Infarct",
      "Contrast Enhancement",
      "Impression"
    ],

    "Spine MRI": [
      "Disc Bulge",
      "Disc Herniation",
      "Spinal Canal Stenosis",
      "Cord Compression",
      "Vertebral Height",
      "Alignment",
      "Impression"
    ],

    "Knee MRI": [
      "ACL Tear",
      "PCL Tear",
      "Meniscus Tear",
      "Joint Effusion",
      "Cartilage Damage",
      "Bone Marrow Edema",
      "Impression"
    ],

    "Shoulder MRI": [
      "Rotator Cuff Tear",
      "Labral Tear",
      "Joint Effusion",
      "Tendon Degeneration",
      "Bone Edema",
      "Impingement",
      "Impression"
    ],

    "Pelvis MRI": [
      "Uterus / Prostate Size",
      "Mass Lesion",
      "Lymph Nodes",
      "Organ Invasion",
      "Contrast Enhancement",
      "Fluid Collection",
      "Impression"
    ],

    "Cardiac MRI": [
      "Ejection Fraction",
      "Chamber Size",
      "Wall Motion Abnormality",
      "Myocardial Scar",
      "Pericardial Effusion",
      "Valve Function",
      "Impression"
    ]
  },

  /* ======================= 5. MAMMOGRAPHY ======================= */
  "MAMMOGRAPHY": {
    "Screening Mammogram": [
      "Breast Density",
      "Mass",
      "Calcification",
      "Architectural Distortion",
      "BI-RADS Category",
      "Impression"
    ]
  },

  /* ======================= 6. ECG ======================= */
  "ECG": {
    "Resting ECG": [
      "Heart Rate (bpm)",
      "Rhythm",
      "PR Interval",
      "QRS Duration",
      "QT Interval",
      "ST Elevation/Depression",
      "T Wave Changes",
      "Interpretation"
    ],

    "Stress Test ECG (TMT)": [
      "Resting Heart Rate",
      "Peak Heart Rate",
      "ST Changes",
      "Exercise Duration",
      "Blood Pressure Response",
      "Arrhythmia",
      "Result (Positive / Negative)"
    ],

    "Holter Monitoring": [
      "Average Heart Rate",
      "Maximum Heart Rate",
      "Minimum Heart Rate",
      "Arrhythmia Episodes",
      "Pause Duration",
      "PVC Count",
      "Interpretation"
    ]
  },

  /* ======================= 7. NUCLEAR MEDICINE ======================= */
  "NUCLEAR MEDICINE": {

    "PET-CT Scan": [
      "Radiotracer Used",
      "Uptake Value (SUV max)",
      "Hypermetabolic Lesion",
      "Lesion Size (cm)",
      "Lymph Node Involvement",
      "Metastasis (Yes/No)",
      "Organ Involvement",
      "Impression"
    ],

    "Bone Scan": [
      "Radiotracer Used",
      "Increased Uptake Areas",
      "Symmetry",
      "Fracture Evidence",
      "Metastasis Suspicion",
      "Joint Involvement",
      "Impression"
    ],

    "Thyroid Scan": [
      "Radioisotope Used",
      "Uptake Percentage",
      "Hot Nodule",
      "Cold Nodule",
      "Gland Enlargement",
      "Functional Activity",
      "Impression"
    ]
  },

  /* ======================= 8. ECHOCARDIOGRAPHY ======================= */
  "ECHOCARDIOGRAPHY": {

    "2D Echo": [
      "Ejection Fraction (%)",
      "LV Size",
      "RV Size",
      "Wall Motion Abnormality",
      "Valve Function",
      "Pericardial Effusion",
      "Septal Defect",
      "Impression"
    ],

    "Doppler Echo": [
      "Valve Regurgitation",
      "Valve Stenosis",
      "Flow Velocity",
      "Pressure Gradient",
      "Pulmonary Pressure",
      "Shunt Detection",
      "Impression"
    ]
  },

  /* ======================= 9. FLUOROSCOPY ======================= */
  "FLUOROSCOPY": {

    "Barium Swallow": [
      "Esophageal Motility",
      "Stricture",
      "Reflux",
      "Ulcer",
      "Filling Defect",
      "Obstruction",
      "Impression"
    ],

    "HSG": [
      "Uterine Cavity Shape",
      "Tubal Patency",
      "Tubal Block",
      "Contrast Spill",
      "Filling Defect",
      "Impression"
    ]
  },

  /* ======================= 10. DEXA SCAN ======================= */
  "DEXA SCAN": {
    "Bone Mineral Density (BMD)": [
      "T-Score",
      "Z-Score",
      "Lumbar Spine BMD",
      "Hip BMD",
      "Osteopenia (Yes/No)",
      "Osteoporosis (Yes/No)",
      "Fracture Risk",
      "Impression"
    ]
  },

  /* ======================= 11. ANGIOGRAPHY ======================= */
  "ANGIOGRAPHY": {
    "Coronary Angiography": [
      "Vessel Involved",
      "% Stenosis",
      "Thrombus",
      "Collateral Circulation",
      "TIMI Flow Grade",
      "Intervention Done (Yes/No)",
      "Impression"
    ]
  }

};

    const handleLoginChange = (e) => {
        setLoginForm({ ...loginForm, [e.target.name]: e.target.value });
        setLoginError("");
    };

    const handleLoginSubmit = (e) => {
        e.preventDefault();
        if (
            loginForm.username === ADMIN_USERNAME &&
            loginForm.password === ADMIN_PASSWORD
        ) {
            setIsLoggedIn(true);
        } else {
            setLoginError("Invalid admin credentials");
        }
    };

    const handleRuleChange = (e) => {
        const { name, value } = e.target;

        setRuleForm((prev) => ({
            ...prev,
            [name]: value,
            ...(name === "subcategory" ? { value: [] } : {}),
        }));
    };

    const handleContextChange = (e) => {
        const { name, value } = e.target;
        setContextForm((prev) => ({
            ...prev,
            [name]: value
        }));
    };


if (!isLoggedIn) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black px-4">
            <div className="w-full max-w-md rounded-3xl bg-gradient-to-br from-gray-900 via-black to-gray-900 border border-white/10 shadow-2xl p-10 text-white">

                <h1 className="text-3xl font-bold text-center mb-6">
                    Admin Login
                </h1>

                <form onSubmit={handleLoginSubmit} className="space-y-5">

                    {/* USERNAME */}
                    <div>
                        <label className="block text-sm text-white/70 mb-1">
                            Username
                        </label>
                        <input
                            type="text"
                            name="username"
                            value={loginForm.username}
                            onChange={handleLoginChange}
                            className="w-full rounded-xl bg-white text-black px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            required
                        />
                    </div>

                    {/* PASSWORD */}
                    <div>
                        <label className="block text-sm text-white/70 mb-1">
                            Password
                        </label>
                        <input
                            type="password"
                            name="password"
                            value={loginForm.password}
                            onChange={handleLoginChange}
                            className="w-full rounded-xl bg-white text-black px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            required
                        />
                    </div>

                    {loginError && (
                        <p className="text-red-500 text-sm text-center">
                            {loginError}
                        </p>
                    )}

                    <button
                        type="submit"
                        className="w-full rounded-xl py-3 font-semibold text-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 transition"
                    >
                        Login
                    </button>

                </form>
            </div>
        </div>
    );
}
const fetchMedicalCurrentRule = async (speciality) => {
    try {
        const res = await fetch(
            `${API_BASE_URL}/hms/users/data/context/get_MedicalCurrentAdminRules`
        );

        const data = await res.json();

        if (!res.ok) {
            throw new Error("Failed to fetch rules");
        }

        const rule = data.data.find(r => r.speciality === speciality);

        if (!rule) return;

        const medicalRulesObj = {};
        const medicalCategories = [];

        rule.medical_context.forEach(item => {
            medicalCategories.push(item.medical_output_category);
            medicalRulesObj[item.medical_output_category] = item.rule_text;
        });

        const currentRulesObj = {};
        const currentCategories = [];

        rule.current_context.forEach(item => {
            currentCategories.push(item.current_output_category);
            currentRulesObj[item.current_output_category] = item.rule_text;
        });

        setMedicalCurrentForm({
            speciality: rule.speciality,
            medicalCategories,
            currentCategories,
            medicalRules: medicalRulesObj,
            currentRules: currentRulesObj
        });

    } catch (error) {
        console.error("Failed to load Medical+Current rule", error);
    }
};
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black px-4">
            {/* CARD */}
            <div className="w-full max-w-5xl rounded-3xl bg-gradient-to-br from-gray-900 via-black to-gray-900 border border-white/10 shadow-2xl p-10 text-white">

                {/* HEADER */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold tracking-tight">
                        Rule Admin Panel
                    </h1>
                    <p className="text-sm text-white/60 mt-2">
                        Secure Rule Configuration Console for Reports
                    </p>
                </div>
                {/* TABS */}
                <div className="flex mb-6 bg-white/10 rounded-xl p-1">
                    <button
                        onClick={() => setActiveTab("report")}
                        className={`flex-1 py-2 rounded-lg font-semibold ${
                            activeTab === "report"
                                ? "bg-emerald-500 text-black"
                                : "text-white/70"
                        }`}
                    >
                        Report Rule Admin
                    </button>

                    <button
                        onClick={() => setActiveTab("context")}
                        className={`flex-1 py-2 rounded-lg font-semibold ${
                            activeTab === "context"
                                ? "bg-emerald-500 text-black"
                                : "text-white/70"
                        }`}
                    >
                        Context Rule Admin
                    </button>
                    <button
    onClick={() => setActiveTab("image")}
    className={`flex-1 py-2 rounded-lg font-semibold ${
        activeTab === "image"
            ? "bg-emerald-500 text-black"
            : "text-white/70"
    }`}
>
    Image Rule Admin
</button>
<button
    onClick={() => setActiveTab("medicalCurrent")}
    className={`flex-1 py-2 rounded-lg font-semibold ${
        activeTab === "medicalCurrent"
            ? "bg-emerald-500 text-black"
            : "text-white/70"
    }`}
>
    Medical + Current Rule Admin
</button>
<button
    onClick={() => setActiveTab("structuredNote")}
    className={`flex-1 py-2 rounded-lg font-semibold ${
        activeTab === "structuredNote"
            ? "bg-emerald-500 text-black"
            : "text-white/70"
    }`}
>
    Structured Note Rule Admin
</button>
                </div>

                {/* REPORT RULE ADMIN TAB */}
                {activeTab === "report" && (
                    <>
                        {/* FORM TITLE */}
                        <h2 className="text-xl font-semibold text-center mb-8">
                            Report Rule Configuration
                        </h2>

                        {/* CATEGORY + SUBCATEGORY ROW */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">

                            {/* CATEGORY */}
                            <div>
                                <label className="block text-sm text-white/70 mb-1">
                                    Category
                                </label>
                                <select
                                    value={ruleForm.category}
                                    onChange={(e) =>
                                        setRuleForm({
                                            category: e.target.value,
                                            subcategory: "",
                                            value: [],
                                            ruleText: ruleForm.ruleText,
                                        })
                                    }
                                    className="w-full rounded-xl bg-white text-black px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                    <option value="" disabled hidden className="text-gray-400">
                                        Select Category
                                    </option>

                                    {Object.keys(categoryMap).map((cat) => (
                                        <option key={cat} value={cat}>
                                            {cat}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* SUBCATEGORY */}
                            <div>
                                <label className="block text-sm text-white/70 mb-1">
                                    Subcategory
                                </label>
                                <select
                                    name="subcategory"
                                    value={ruleForm.subcategory}
                                    onChange={handleRuleChange}
                                    disabled={!ruleForm.category}
                                    className="w-full rounded-xl bg-white text-black px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                >
                                    <option value="" disabled hidden className="text-gray-400">
                                        Select Subcategory
                                    </option>

                                    {ruleForm.category &&
                                        categoryMap[ruleForm.category].map((sub) => (
                                            <option key={sub} value={sub}>
                                                {sub}
                                            </option>
                                        ))}
                                </select>
                            </div>

                        </div>

                        {/* VALUE CHECKBOXES */}
                        {ruleForm.category && ruleForm.subcategory && (


                            <div className="mb-5">
                                <label className="block text-sm text-white/70 mb-2">
                                    
                                </label>

                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    {getCheckboxValues().map((val) => (
                                        <label
                                            key={val}
                                            className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={ruleForm.value.includes(val)}
                                                onChange={(e) => {
                                                    setRuleForm((prev) => ({
                                                        ...prev,
                                                        value: e.target.checked
                                                            ? [...prev.value, val]
                                                            : prev.value.filter((v) => v !== val),
                                                    }));
                                                }}
                                                className="accent-emerald-500"
                                            />
                                            <span className="text-sm">{val}</span>
                                        </label>
                                    ))}
                                </div>

                                {/* ADD NEW VALUE */}
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={newValueInput}
                                        onChange={(e) => setNewValueInput(e.target.value)}
                                        placeholder="Add new test name"
                                        className="flex-1 rounded-lg px-3 py-2 bg-white text-black"
                                    />

                                    <button
                                        type="button"
                                        onClick={handleAddNewValue}
                                        className="px-4 rounded-lg bg-emerald-500 text-black font-bold text-xl hover:opacity-90"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        )}


                        {/* RULE TEXT */}
                        <div className="mb-8">
                            <label className="block text-sm text-white/70 mb-1">
                                Rule Definition
                            </label>
                            <textarea
                                name="ruleText"
                                value={ruleForm.ruleText}
                                onChange={handleRuleChange}
                                rows={7}
                                placeholder="Define extraction fields, abnormality detection, summarization rules..."
                                className="w-full rounded-xl bg-black/70 border border-white/20 px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>

                        {/* SAVE BUTTON */}
                        <button
                            onClick={saveRuleToBackend}
                            className="w-full rounded-xl py-3 font-semibold text-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 transition"
                        >
                            Save Rule
                        </button>
                    </>
                )}

                {/* CONTEXT RULE ADMIN TAB */}
                {activeTab === "context" && (
                    <>
                        {/* FORM TITLE */}
                        <h2 className="text-xl font-semibold text-center mb-8">
                            Context Rule Configuration
                        </h2>

                        {/* SPECIALITY DROPDOWN */}
                        <div className="mb-5">
                            <label className="block text-sm text-white/70 mb-1">
                                Speciality
                            </label>
                            <select
                                name="speciality"
                                value={contextForm.speciality}
                                onChange={handleContextChange}
                                className="w-full rounded-xl bg-white text-black px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                               <option value="" disabled hidden className="text-gray-400">
                                         Select Speciality
                                    </option>

                                {specialityList.map((speciality) => (
                                    <option key={speciality} value={speciality}>
                                        {speciality}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* MEDICAL CONTEXT RULE TEXTAREA */}
{/* MEDICAL OUTPUT CATEGORIES */}
<div className="mb-6">
    <label className="block text-sm text-white/70 mb-2">
        Medical Output Categories
    </label>

    <div className="grid grid-cols-2 gap-3 mb-4">
        {[...medicalOutputCategories, ...customMedicalCategories].map((category) => (
            <label
                key={category}
                className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 cursor-pointer"
            >
                <input
                    type="checkbox"
                    checked={contextForm.medicalContextCategories.includes(category)}
                    onChange={(e) => {
                        setContextForm(prev => ({
                            ...prev,
                            medicalContextCategories: e.target.checked
                                ? [...prev.medicalContextCategories, category]
                                : prev.medicalContextCategories.filter(c => c !== category)
                        }));
                    }}
                    className="accent-emerald-500"
                />
                <span className="text-sm">{category}</span>
            </label>
        ))}
    </div>

    <div className="flex gap-2">
        <input
            type="text"
            value={newMedicalCategory}
            onChange={(e) => setNewMedicalCategory(e.target.value)}
            placeholder="Add new medical category"
            className="flex-1 rounded-lg px-3 py-2 bg-white text-black"
        />
        <button
            type="button"
            onClick={() => {
                if (!newMedicalCategory.trim()) return;
                setCustomMedicalCategories(prev => [...prev, newMedicalCategory.trim()]);
                setContextForm(prev => ({
                    ...prev,
                    medicalContextCategories: [...prev.medicalContextCategories, newMedicalCategory.trim()]
                }));
                setNewMedicalCategory("");
            }}
            className="px-4 rounded-lg bg-emerald-500 text-black font-bold text-xl"
        >
            +
        </button>
    </div>{/* MEDICAL CONTEXT RULE TEXTAREA */}
<div className="mb-8 mt-4">
    <label className="block text-sm text-white/70 mb-1">
        Medical Context Rule Definition
    </label>
    <textarea
        name="medicalContextRule"
        value={contextForm.medicalContextRule}
        onChange={handleContextChange}
        rows={6}
        placeholder="Define how selected medical output categories should be structured..."
        className="w-full rounded-xl bg-black/70 border border-white/20 px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
    />
</div>
</div>

                        {/* CURRENT CONTEXT RULE TEXTAREA */}
{/* CURRENT OUTPUT CATEGORIES */}
<div className="mb-6">
    <label className="block text-sm text-white/70 mb-2">
        Current Output Categories
    </label>

    <div className="grid grid-cols-2 gap-3 mb-4">
        {[...currentOutputCategories, ...customCurrentCategories].map((category) => (
            <label
                key={category}
                className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 cursor-pointer"
            >
                <input
                    type="checkbox"
                    checked={contextForm.currentContextCategories.includes(category)}
                    onChange={(e) => {
                        setContextForm(prev => ({
                            ...prev,
                            currentContextCategories: e.target.checked
                                ? [...prev.currentContextCategories, category]
                                : prev.currentContextCategories.filter(c => c !== category)
                        }));
                    }}
                    className="accent-emerald-500"
                />
                <span className="text-sm">{category}</span>
            </label>
        ))}
    </div>

    <div className="flex gap-2">
        <input
            type="text"
            value={newCurrentCategory}
            onChange={(e) => setNewCurrentCategory(e.target.value)}
            placeholder="Add new current category"
            className="flex-1 rounded-lg px-3 py-2 bg-white text-black"
        />
        <button
            type="button"
            onClick={() => {
                if (!newCurrentCategory.trim()) return;
                setCustomCurrentCategories(prev => [...prev, newCurrentCategory.trim()]);
                setContextForm(prev => ({
                    ...prev,
                    currentContextCategories: [...prev.currentContextCategories, newCurrentCategory.trim()]
                }));
                setNewCurrentCategory("");
            }}
            className="px-4 rounded-lg bg-emerald-500 text-black font-bold text-xl"
        >
            +
        </button>
    </div>{/* CURRENT CONTEXT RULE TEXTAREA */}
<div className="mb-8 mt-4">
    <label className="block text-sm text-white/70 mb-1">
        Current Context Rule Definition
    </label>
    <textarea
        name="currentContextRule"
        value={contextForm.currentContextRule}
        onChange={handleContextChange}
        rows={6}
        placeholder="Define how selected current output categories should be structured..."
        className="w-full rounded-xl bg-black/70 border border-white/20 px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
    />
</div>
</div>

                        {/* SAVE CONTEXT RULE BUTTON */}
                        <button
                            onClick={saveContextRule}
                            className="w-full rounded-xl py-3 font-semibold text-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 transition"
                        >
                            Save Context Rule
                        </button>
                    </>
                )}
{activeTab === "image" && (
<>
    <h2 className="text-xl font-semibold text-center mb-8">
        Image Rule Configuration
    </h2>

    {/* CATEGORY */}
    <div className="mb-5">
        <label className="block text-sm text-white/70 mb-1">
            Category
        </label>
        <select
            value={imageForm.category}
            onChange={(e) =>
                setImageForm({
                    category: e.target.value,
                    subcategory: "",
                    parameters: [],
                    ruleText: ""
                })
            }
            className="w-full rounded-xl bg-white text-black px-4 py-3"
        >
            <option value="" disabled>Select Category</option>
            {Object.keys(imageCategoryMap).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
            ))}
        </select>
    </div>

    {/* SUBCATEGORY */}
    {imageForm.category && (
    <div className="mb-5">
        <label className="block text-sm text-white/70 mb-1">
            Subcategory
        </label>
        <select
            value={imageForm.subcategory}
            onChange={(e) =>
                setImageForm(prev => ({
                    ...prev,
                    subcategory: e.target.value,
                    parameters: []
                }))
            }
            className="w-full rounded-xl bg-white text-black px-4 py-3"
        >
            <option value="" disabled>Select Subcategory</option>
            {Object.keys(imageCategoryMap[imageForm.category]).map(sub => (
                <option key={sub} value={sub}>{sub}</option>
            ))}
        </select>
    </div>
    )}

    {/* PARAMETERS CHECKBOX */}
    {imageForm.subcategory && (
    <div className="mb-5">
        <div className="grid grid-cols-2 gap-3 mb-4">
            {[
    ...imageCategoryMap[imageForm.category][imageForm.subcategory],
    ...(customImageValues?.[imageForm.category]?.[imageForm.subcategory] || [])
].map(param => (
                <label key={param} className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                    <input
                        type="checkbox"
                        checked={imageForm.parameters.includes(param)}
                        onChange={(e) => {
                            setImageForm(prev => ({
                                ...prev,
                                parameters: e.target.checked
                                    ? [...prev.parameters, param]
                                    : prev.parameters.filter(p => p !== param)
                            }));
                        }}
                        className="accent-emerald-500"
                    />
                    <span className="text-sm">{param}</span>
                </label>
            ))}
        </div>

        {/* ADD CUSTOM PARAMETER */}
        <div className="flex gap-2">
            <input
                type="text"
                value={newImageValue}
                onChange={(e) => setNewImageValue(e.target.value)}
                placeholder="Add new parameter"
                className="flex-1 rounded-lg px-3 py-2 bg-white text-black"
            />
            <button
                type="button"
                onClick={() => {
                    if (!newImageValue.trim()) return;
                    setCustomImageValues(prev => ({
                        ...prev,
                        [imageForm.category]: {
                            ...(prev[imageForm.category] || {}),
                            [imageForm.subcategory]: [
                                ...(prev?.[imageForm.category]?.[imageForm.subcategory] || []),
                                newImageValue.trim()
                            ]
                        }
                    }));

                    setImageForm(prev => ({
                        ...prev,
                        parameters: [...prev.parameters, newImageValue.trim()]
                    }));

                    setNewImageValue("");
                }}
                className="px-4 rounded-lg bg-emerald-500 text-black font-bold text-xl"
            >
                +
            </button>
        </div>
    </div>
    )}

    {/* RULE TEXT */}
    <div className="mb-8">
        <label className="block text-sm text-white/70 mb-1">
            Image Rule Definition
        </label>
        <textarea
            value={imageForm.ruleText}
            onChange={(e) =>
                setImageForm(prev => ({ ...prev, ruleText: e.target.value }))
            }
            rows={6}
            className="w-full rounded-xl bg-black/70 border border-white/20 px-4 py-3 text-white"
        />
    </div>

    <button
    className="w-full rounded-xl py-3 font-semibold text-lg bg-gradient-to-r from-emerald-500 to-green-600"
    onClick={saveImageRuleToBackend}
>
    Save Image Rule
</button>
</>
)}



{activeTab === "medicalCurrent" && (
<>
    <h2 className="text-xl font-semibold text-center mb-8">
        Medical + Current Rule Admin
    </h2>

    {/* SPECIALITY */}
    <div className="mb-6">
        <label className="block text-sm text-white/70 mb-1">
            Speciality
        </label>
<select
    value={medicalCurrentForm.speciality}
    onChange={(e) => {
        const selected = e.target.value;

        // Reset form first
        setMedicalCurrentForm({
            speciality: selected,
            medicalCategories: [],
            currentCategories: [],
            medicalRules: {},
            currentRules: {}
        });

        // 🔥 Fetch saved rule for this speciality
        fetchMedicalCurrentRule(selected);
    }}
            className="w-full rounded-xl bg-white text-black px-4 py-3"
        >
            <option value="">Select Speciality</option>
            {specialityList.map(spec => (
                <option key={spec} value={spec}>{spec}</option>
            ))}
        </select>
    </div>

    {/* SHOW AFTER SPECIALITY SELECTED */}
    {medicalCurrentForm.speciality && (
    <>
        <div className="grid grid-cols-2 gap-10">

            {/* ================= MEDICAL SIDE ================= */}
            <div>
                <h3 className="text-lg font-semibold mb-4">
                    Medical Output Categories
                </h3>

                {/* INPUT + ADD BUTTON */}
                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        value={newMedicalCategory}
                        onChange={(e) => setNewMedicalCategory(e.target.value)}
                        placeholder="Add Medical Output Category"
                        className="flex-1 rounded-lg px-3 py-2 bg-white text-black"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            if (!newMedicalCategory.trim()) return;

                            setMedicalCurrentForm(prev => ({
                                ...prev,
                                medicalCategories: [
                                    ...prev.medicalCategories,
                                    newMedicalCategory.trim()
                                ]
                            }));

                            setNewMedicalCategory("");
                        }}
                        className="px-4 rounded-lg bg-emerald-500 text-black font-bold text-xl"
                    >
                        +
                    </button>
                </div>

                {/* SHOW RULE TEXTAREA IMMEDIATELY */}
{medicalCurrentForm.medicalCategories.map((category, index) => (
    <div key={index} className="mb-6 bg-white/10 p-4 rounded-xl">

        {/* Editable Category Name */}
        <input
            type="text"
            value={category}
            onChange={(e) => {
                const newName = e.target.value;

                setMedicalCurrentForm(prev => {
                    const updatedCategories = [...prev.medicalCategories];
                    updatedCategories[index] = newName;

                    const updatedRules = { ...prev.medicalRules };
                    updatedRules[newName] = updatedRules[category];
                    delete updatedRules[category];

                    return {
                        ...prev,
                        medicalCategories: updatedCategories,
                        medicalRules: updatedRules
                    };
                });
            }}
            className="w-full mb-2 rounded-lg px-3 py-2 bg-white text-black"
        />

        {/* Delete Button */}
        <button
            type="button"
            onClick={() => {
                setMedicalCurrentForm(prev => ({
                    ...prev,
                    medicalCategories: prev.medicalCategories.filter((_, i) => i !== index),
                    medicalRules: Object.fromEntries(
                        Object.entries(prev.medicalRules).filter(([key]) => key !== category)
                    )
                }));
            }}
            className="text-red-400 text-sm mb-2"
        >
            Delete
        </button>

        <textarea
            rows={4}
            placeholder="Enter medical rule..."
            className="w-full rounded-lg bg-black text-white px-3 py-2"
            value={medicalCurrentForm.medicalRules[category] || ""}
            onChange={(e) =>
                setMedicalCurrentForm(prev => ({
                    ...prev,
                    medicalRules: {
                        ...prev.medicalRules,
                        [category]: e.target.value
                    }
                }))
            }
        />
    </div>
))}
            </div>

            {/* ================= CURRENT SIDE ================= */}
            <div>
                <h3 className="text-lg font-semibold mb-4">
                    Current Output Categories
                </h3>

                {/* INPUT + ADD BUTTON */}
                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        value={newCurrentCategory}
                        onChange={(e) => setNewCurrentCategory(e.target.value)}
                        placeholder="Add Current Output Category"
                        className="flex-1 rounded-lg px-3 py-2 bg-white text-black"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            if (!newCurrentCategory.trim()) return;

                            setMedicalCurrentForm(prev => ({
                                ...prev,
                                currentCategories: [
                                    ...prev.currentCategories,
                                    newCurrentCategory.trim()
                                ]
                            }));

                            setNewCurrentCategory("");
                        }}
                        className="px-4 rounded-lg bg-emerald-500 text-black font-bold text-xl"
                    >
                        +
                    </button>
                </div>

                {/* SHOW RULE TEXTAREA IMMEDIATELY */}
{medicalCurrentForm.currentCategories.map((category, index) => (
    <div key={index} className="mb-6 bg-white/10 p-4 rounded-xl">

        <input
            type="text"
            value={category}
            onChange={(e) => {
                const newName = e.target.value;

                setMedicalCurrentForm(prev => {
                    const updatedCategories = [...prev.currentCategories];
                    updatedCategories[index] = newName;

                    const updatedRules = { ...prev.currentRules };
                    updatedRules[newName] = updatedRules[category];
                    delete updatedRules[category];

                    return {
                        ...prev,
                        currentCategories: updatedCategories,
                        currentRules: updatedRules
                    };
                });
            }}
            className="w-full mb-2 rounded-lg px-3 py-2 bg-white text-black"
        />

        <button
            type="button"
            onClick={() => {
                setMedicalCurrentForm(prev => ({
                    ...prev,
                    currentCategories: prev.currentCategories.filter((_, i) => i !== index),
                    currentRules: Object.fromEntries(
                        Object.entries(prev.currentRules).filter(([key]) => key !== category)
                    )
                }));
            }}
            className="text-red-400 text-sm mb-2"
        >
            Delete
        </button>

        <textarea
            rows={4}
            placeholder="Enter current rule..."
            className="w-full rounded-lg bg-black text-white px-3 py-2"
            value={medicalCurrentForm.currentRules[category] || ""}
            onChange={(e) =>
                setMedicalCurrentForm(prev => ({
                    ...prev,
                    currentRules: {
                        ...prev.currentRules,
                        [category]: e.target.value
                    }
                }))
            }
        />
    </div>
))}
            </div>

        </div>

        {/* SAVE BUTTON AT BOTTOM */}
        <button
            onClick={saveMedicalCurrentRules}
            className="w-full mt-10 rounded-xl py-3 bg-emerald-500 text-black font-semibold text-lg"
        >
            Save Rules
        </button>
    </>
    )}
</>
)}
{activeTab === "structuredNote" && (
<>
    <h2 className="text-xl font-semibold text-center mb-8">
        Structured Note Rule Admin
    </h2>

    {/* SPECIALITY */}
    <div className="mb-6">
        <label className="block text-sm text-white/70 mb-1">
            Speciality
        </label>

        <select
            value={structuredNoteForm.speciality}
            onChange={(e) =>
                setStructuredNoteForm(prev => ({
                    ...prev,
                    speciality: e.target.value
                }))
            }
            className="w-full rounded-xl bg-white text-black px-4 py-3"
        >
            <option value="">Select Speciality</option>
            {specialityList.map(spec => (
                <option key={spec} value={spec}>
                    {spec}
                </option>
            ))}
        </select>
    </div>

    {/* RULE TEXT */}
    <div className="mb-8">
        <label className="block text-sm text-white/70 mb-1">
            Rule Definition
        </label>

        <textarea
            rows={8}
            placeholder="Enter structured note rule..."
            value={structuredNoteForm.ruleText}
            onChange={(e) =>
                setStructuredNoteForm(prev => ({
                    ...prev,
                    ruleText: e.target.value
                }))
            }
            className="w-full rounded-xl bg-black text-white px-4 py-3"
        />
    </div>

    {/* SAVE BUTTON */}
    <button
        onClick={saveStructuredNoteRule}
        className="w-full rounded-xl py-3 font-semibold text-lg bg-gradient-to-r from-emerald-500 to-green-600"
    >
        Save Structured Note Rule
    </button>
</>
)}
            </div>

        </div>
    );
};

export default AdminRuleConfig;