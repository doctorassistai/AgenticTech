"""
Prompt builders and parsers for enhanced medical document analysis.
SAFE for FastAPI and Celery usage.
"""

from typing import List, Dict, Any

def get_enhanced_medical_prompt(document_type: str, text: str) -> str:
    """
    Generate enhanced medical prompts based on document type.
    Pure function (no DB, no async, no side effects).
    """

    # -------------------------
    # BASE SYSTEM PROMPTS
    # -------------------------
    if document_type == "lab_report":
        base_instruction = """ 
        [INST] <<SYS>>
        You are an expert medical AI assistant with deep knowledge of clinical medicine, diagnostic criteria, and WHO/ICD standards. 
        Analyze the following medical document and provide comprehensive structured output including:
        1. Structured data extraction (individual lab tests)
        2. Medical insights and clinical significance
        3. Condition identification with WHO/ICD codes where applicable
        4. Risk assessment and recommendations
        Flag Rules:

        - Always parse numeric values for test results and reference ranges.

        - Compare the test value numerically to the reference range.

        - Assign flags as follows:
            "high" → if value > upper limit of reference range
            "low" → if value < lower limit of reference range
            "normal" → if value is within reference range

        - Reference ranges may appear as min-max, ≤value, or ≥value. Handle all formats numerically.

        - Only output "high", "low", or "normal"; do not use any other terms.

        - Example: {"test_name": "Triglycerides", "value": "73", "unit": "mg/dL", "reference_range": "150-169", "flag": "low"}

        Only use "high", "low", or "normal" as flags

        Return ONLY a valid JSON object with the following structure:
        {
            "structured_data": [
                {"test_name": "test name", "value": "value", "unit": "unit", "reference_range": "reference range", "flag": "high/low/normal"}
            ],
            "medical_insights": {
                "summary": "comprehensive medical summary",
                "key_findings": ["finding1", "finding2"],
                "recommendations": ["recommendation1", "recommendation2"],
                "risk_factors": ["risk1", "risk2"],
                "follow_up_required": true/false,
                "urgency_level": "routine/urgent/critical"
            },
            "conditions": [
                {
                    "condition_name": "Condition Name",
                    "description": "Clinical description",
                    "severity": "low/medium/high/critical",
                    "confidence": 85,
                    "who_code": "WHO_CODE if applicable",
                    "icd_code": "ICD_CODE if applicable",
                    "indicators": ["indicator1", "indicator2"],
                    "values_supporting": ["value1", "value2"],
                    "recommendation": "specific recommendation",
                    "progression_notes": "notes about disease progression",
                    "requires_immediate_attention": true/false
                }
            ]
        }
        <</SYS>>
        """
    elif document_type == "bio_marker":
        base_instruction = """
        [INST] <<SYS>>
        You are an expert medical AI assistant with deep knowledge of clinical medicine, oncology, genetics, and diagnostic biomarkers. 
        Analyze the following biomarker document and provide comprehensive structured output including:
        1. Structured data extraction (individual biomarkers)
        2. Medical insights and clinical significance
        3. Condition identification with WHO/ICD codes where applicable
        4. Risk assessment and recommendations

        CRITICAL INSTRUCTIONS FOR STRUCTURED DATA:
        - Extract EACH biomarker as a separate object in the "structured_data" array
        - Each object MUST have EXACTLY these 5 fields with these exact field names:
          "test_name", "value", "unit", "reference_range", "flag"
        - Use the exact biomarker names as they appear in the document
        - If any field is missing from the document, use empty string "" (do NOT use null or undefined)
        - For "flag" field, use: "Normal", "High", "Low", "Critical", or "Abnormal" based on the value and reference range
        - Do NOT add any additional fields or change the field names
        - The structured_data array MUST contain at least one valid biomarker object

        COMMON BIOMARKER EXAMPLES:
        - Cancer: HER2, ER (Estrogen Receptor), PR (Progesterone Receptor), Ki-67, PSA (Prostate Specific Antigen)
        - Genetic: BRCA1, BRCA2, KRAS, EGFR, ALK
        - Cardiac: Troponin I, Troponin T, BNP (B-type Natriuretic Peptide), NT-proBNP
        - Inflammatory: CRP (C-reactive Protein), ESR (Erythrocyte Sedimentation Rate), IL-6 (Interleukin-6)
        - Metabolic: HbA1c (Glycated Hemoglobin), LDL, HDL, Triglycerides

        Return ONLY a valid JSON object with the following EXACT structure:
        {
             "structured_data": [
                {"test_name": "biomarker name", "value": "measured value", "unit": "measurement unit", "reference_range": "normal range", "flag": "Normal/High/Low/Critical/Abnormal"}
            ],
            "medical_insights": {
                "summary": "comprehensive medical summary",
                "key_findings": ["finding1", "finding2"],
                "recommendations": ["recommendation1", "recommendation2"],
                "risk_factors": ["risk1", "risk2"],
                "follow_up_required": true/false,
                "urgency_level": "routine/urgent/critical"
            },
            "conditions": [
                {
                    "condition_name": "Condition Name",
                    "description": "Clinical description",
                    "severity": "low/medium/high/critical",
                    "confidence": 85,
                    "who_code": "WHO_CODE if applicable",
                    "icd_code": "ICD_CODE if applicable",
                    "indicators": ["indicator1", "indicator2"],
                    "values_supporting": ["value1", "value2"],
                    "recommendation": "specific recommendation",
                    "progression_notes": "notes about disease progression",
                    "requires_immediate_attention": true/false
                }
            ]
        }

        IMPORTANT: Your response must be ONLY the JSON object, no additional text, no explanations, no code blocks.
        <</SYS>>
        """
    else:
        base_instruction = """
         [INST] <<SYS>>
        You are an expert medical AI assistant with deep knowledge of clinical medicine, diagnostic criteria, and WHO/ICD standards. 
        Analyze the following medical document and provide comprehensive structured output including:
        1. Structured data extraction
        2. Medical insights and clinical significance
        3. Condition identification with WHO/ICD codes where applicable
        4. Risk assessment and recommendations
        
        Return ONLY a valid JSON object with the following structure:
        {
            "structured_data": [
                {"field_name": "field_name", "field_label": "Field Label", "field_value": "value", "field_type": "text/textarea/number", "clinical_significance": "normal/abnormal/critical"}
            ],
            "medical_insights": {
                "summary": "comprehensive medical summary",
                "key_findings": ["finding1", "finding2"],
                "recommendations": ["recommendation1", "recommendation2"],
                "risk_factors": ["risk1", "risk2"],
                "follow_up_required": true/false,
                "urgency_level": "routine/urgent/critical"
            },
            "conditions": [
                {
                    "condition_name": "Condition Name",
                    "description": "Clinical description",
                    "severity": "low/medium/high/critical",
                    "confidence": 85,
                    "who_code": "WHO_CODE if applicable",
                    "icd_code": "ICD_CODE if applicable",
                    "indicators": ["indicator1", "indicator2"],
                    "values_supporting": ["value1", "value2"],
                    "recommendation": "specific recommendation",
                    "progression_notes": "notes about disease progression",
                    "requires_immediate_attention": true/false
                }
            ]
        }
        <</SYS>>
        """

    # -------------------------
    # DOCUMENT TYPE PROMPTS
    # -------------------------
    type_prompts = {
       "lab_report": """
        Analyze this laboratory report with focus on:
        - Extract ALL individual lab tests with their exact values, units, reference ranges, and flags
        - For each test, provide: test_name, value, unit, reference_range, flag (Normal/High/Low ONLY)
        - Identify abnormal values and their clinical significance
        - Determine potential conditions based on lab patterns
        - Assess for critical values requiring immediate attention
        - Provide evidence-based recommendations
        
        Flag Normalization Rules:

        1. Always parse numeric values for both the test result and reference range.
        2. Compare the test value numerically to the reference range:
        - "high" → value > upper limit of the reference range
        - "low" → value < lower limit of the reference range
        - "normal" → value within the reference range
        3. Reference ranges may appear as:
        - min-max (e.g., 150-169)
        - ≤value (e.g., ≤7.0)
        - ≥value (e.g., ≥4.0)
        Handle all formats numerically.
        4. Only "high", "low", or "normal" are allowed. Do not use other terms like "elevated", "decreased", or "within range".
        5. Example:
        {"test_name": "Triglycerides", "value": "73", "unit": "mg/dL", "reference_range": "150-169", "flag": "low"}


        IMPORTANT: In structured_data, extract each individual lab test as a separate object with the format:
        {"test_name": "Complete Blood Count - Hemoglobin", "value": "12.5", "unit": "g/dL", "reference_range": "12.0-15.5", "flag": "Normal"}
        
        For conditions, consider common diagnoses like:
        - Diabetes (HbA1c >6.5%, glucose patterns)
        - Kidney disease (creatinine, BUN, GFR)
        - Liver disease (ALT, AST, bilirubin patterns)
        - Anemia (hemoglobin, iron studies)
        - Thyroid disorders (TSH, T3, T4)
        - Cardiac markers (troponin, CK-MB, BNP)
        """,
        

        "bio_marker": """
        Analyze this biomarker report with focus on:
        - Extract ALL individual biomarkers with their exact values, units, reference ranges, and flags
        - For each biomarker, provide: test_name, value, unit, reference_range, flag (Normal/High/Low/Critical/Abnormal)
        - Identify abnormal biomarker patterns and their clinical significance
        - Determine potential conditions based on biomarker profiles
        - Assess for critical values requiring immediate attention
        - Provide evidence-based recommendations
        
        COMMON BIOMARKER CATEGORIES:
        - Cancer biomarkers: 
          * HER2: "Positive", "Negative", "Equivocal" with IHC scores (0, 1+, 2+, 3+)
          * ER/PR: "Positive", "Negative" with percentage scores
          * Ki-67: proliferation index as percentage
          * PSA: ng/mL values with age-specific ranges
          * CA-125: U/mL for ovarian cancer monitoring
          * CEA: ng/mL for colorectal cancer
          * AFP: ng/mL for liver cancer

        - Genetic mutations:
          * BRCA1/BRCA2: "Positive", "Negative", specific mutations
          * KRAS, NRAS: mutation status
          * EGFR: mutation status for lung cancer
          * ALK: rearrangement status
          *BRAF: mutation status

        - Inflammatory markers:
          * CRP: mg/L for inflammation
          * ESR: mm/hr for inflammation
          * IL-6: pg/mL for cytokine levels 
          *TNF-alpha: pg/mL for inflammation

        - Cardiac biomarkers:
          * Troponin I/T: ng/L for myocardial injury
          * BNP/NT-proBNP: pg/mL for heart failure
          * CK-MB: U/L for cardiac muscle damage

        - Metabolic markers:
          * HbA1c: for diabetes monitoring
          * LDL/HDL: mg/dL for cardiovascular risk
          * Triglycerides: mg/dL for metabolic health
          * Creatinine: mg/dL for kidney function

        - Hormonal markers: TSH, T3, T4, Cortisol, Testosterone, Estrogen
        
        STRUCTURED DATA FORMAT REQUIREMENTS:
        - Each biomarker must be a separate object in the structured_data array
        - Field names must be exactly: test_name, value, unit, reference_range, flag
        - Use empty string "" for missing values
        - Flag must be one of: Normal, High, Low, Critical, Abnormal
        - Include ALL biomarkers mentioned in the document, even if some fields are missing

        EXAMPLE STRUCTURED DATA OUTPUT:
        [
          {"test_name": "PSA", "value": "4.2", "unit": "ng/mL", "reference_range": "0-4.0", "flag": "High"},
          {"test_name": "HER2", "value": "Positive", "unit": "", "reference_range": "Negative", "flag": "Abnormal"},
          {"test_name": "Ki-67", "value": "25", "unit": "%", "reference_range": "0-15%", "flag": "High"},
          {"test_name": "CRP", "value": "8.5", "unit": "mg/L", "reference_range": "0-5.0", "flag": "High"}
        ]

        For conditions, focus on:
        - Cancer diagnoses based on biomarker profiles
        - Genetic predisposition syndromes
        - Cardiovascular risks
        - Inflammatory and autoimmune conditions
        - Metabolic disorders

        """,

        "ct_scan": """
        Analyze this CT scan report with focus on:
        - Extract anatomical findings and measurements
        - Identify pathological findings
        - Assess for masses, inflammation, or structural abnormalities
        - Determine clinical significance and urgency
        - Provide appropriate follow-up recommendations
        
        For conditions, consider findings like:
        - Tumors/masses with size and characteristics
        - Inflammatory conditions
        - Vascular abnormalities
        - Structural defects
        - Emergency findings requiring immediate attention
        """,
        
        "mri": """
        Analyze this MRI report with focus on:
        - Extract detailed anatomical findings
        - Identify signal changes and their significance
        - Assess for pathological processes
        - Determine staging if applicable
        - Provide clinical correlation recommendations
        
        Consider conditions like:
        - Neurological disorders (stroke, MS, tumors)
        - Musculoskeletal injuries
        - Inflammatory conditions
        - Degenerative changes
        """,
        
        "ultrasound": """
        Analyze this ultrasound report with focus on:
        - Extract measurements and dimensions
        - Identify structural abnormalities
        - Assess organ function and blood flow
        - Determine clinical significance
        
        Consider conditions based on organ system:
        - Cardiac: heart function, valve abnormalities
        - Abdominal: organ size, stones, masses
        - Obstetric: fetal development, complications
        - Vascular: blood flow, stenosis, thrombosis
        """,
        
        "biopsy": """
        Analyze this biopsy/histopathology report with focus on:
        - Extract cellular and tissue findings
        - Identify malignant vs benign characteristics
        - Determine grade and stage if applicable
        - Assess margins and invasion
        - Provide prognostic information
        
        Consider conditions like:
        - Malignancies with specific types and grades
        - Inflammatory conditions
        - Infectious processes
        - Benign growths
        """,
        
        "cardiology": """
        Analyze this cardiology report (ECG/Echo/Stress test) with focus on:
        - Extract cardiac parameters and measurements
        - Identify rhythm abnormalities
        - Assess cardiac function and structure
        - Determine risk stratification
        
        Consider conditions like:
        - Arrhythmias (atrial fibrillation, VT, etc.)
        - Heart failure
        - Coronary artery disease
        - Valvular heart disease
        - Cardiomyopathy
        """,
        
        "prescription": """
        Analyze this prescription with focus on:
        - Extract all medications with dosages
        - Identify drug interactions
        - Assess appropriateness of dosing
        - Determine treatment indication
        
        Consider therapeutic areas:
        - Chronic disease management
        - Acute treatment protocols
        - Drug safety concerns
        - Compliance factors
        """
    }

    specific_prompt = type_prompts.get(
        document_type,
        """
       Analyze this medical document comprehensively:
    - Extract all relevant medical information
    - Identify key clinical findings
    - Assess for any conditions or abnormalities
    - Provide appropriate clinical recommendations
    """
    )

    return f"""
{base_instruction}

{specific_prompt}

Medical Document:
{text}

[/INST]
"""
