import { useState } from 'react';
import {
  Settings, ChevronRight, Check, X,
  Database, Command, FileText, MessageSquare, Link, Brain,
  GitBranch, Zap, Mail, MessageCircle, Phone, Bell, Shield, Send,
  CheckCircle2, Edit2, Workflow, Layers, Menu
} from 'lucide-react';

// ============= INLINE STYLES =============
const colors = {
  background: '#fcfcfc',
  foreground: '#1f2937',
  card: '#ffffff',
  border: '#e5e7eb',
  secondary: '#f3f4f6',
  muted: '#6b7280',
  accent: '#e5e7eb',
  success: '#22c55e',
};

const styles = {
  container: {
    display: 'flex',
    height: '100vh',
    backgroundColor: colors.background,
    overflow: 'hidden',
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  navbar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '64px',
    backgroundColor: colors.card,
    borderBottom: `1px solid ${colors.border}`,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
  },
  navbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  menuButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logoIcon: {
    width: '36px',
    height: '36px',
    backgroundColor: colors.foreground,
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontSize: '20px',
    color: colors.foreground,
    letterSpacing: '-0.025em',
    margin: 0,
  },
  badge: {
    padding: '6px 12px',
    backgroundColor: colors.secondary,
    borderRadius: '9999px',
    fontSize: '14px',
    color: colors.muted,
    fontWeight: 500,
  },
  badgeCount: {
    color: colors.foreground,
    fontWeight: 600,
  },
  sidebar: (open) => ({
    width: open ? '320px' : '0px',
    backgroundColor: colors.card,
    borderRight: `1px solid ${colors.border}`,
    marginTop: '64px',
    overflow: 'hidden',
    transition: 'width 0.3s ease-out',
  }),
  sidebarInner: {
    width: '320px',
    height: '100%',
    overflowY: 'auto',
  },
  sidebarPadding: {
    padding: '16px',
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '24px',
    padding: '0 8px',
  },
  sidebarLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  categoryButton: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  chevron: (collapsed) => ({
    color: colors.muted,
    transition: 'transform 0.2s',
    transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
  }),
  categoryName: {
    fontSize: '14px',
    fontWeight: 500,
    color: colors.foreground,
    flex: 1,
    textAlign: 'left',
  },
  categoryBadge: {
    padding: '2px 8px',
    backgroundColor: colors.foreground,
    color: colors.background,
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '9999px',
  },
  featureList: (collapsed) => ({
    overflow: 'hidden',
    transition: 'all 0.3s ease-out',
    maxHeight: collapsed ? '0px' : '2000px',
    opacity: collapsed ? 0 : 1,
  }),
  featureListInner: {
    marginLeft: '16px',
    paddingLeft: '16px',
    borderLeft: `1px solid ${colors.border}`,
    paddingTop: '4px',
    paddingBottom: '4px',
  },
  featureItem: (enabled, active, disabled) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: '8px',
    transition: 'all 0.2s',
    userSelect: 'none',
    backgroundColor: enabled ? colors.secondary : 'transparent',
    outline: active ? `1px solid ${colors.foreground}` : 'none',
    opacity: disabled ? 0.4 : 1,
  }),
  featureName: (enabled) => ({
    fontSize: '12px',
    fontWeight: 500,
    color: enabled ? colors.foreground : colors.muted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  featureActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  editButton: {
    padding: '4px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  toggle: (enabled) => ({
    width: '32px',
    height: '18px',
    borderRadius: '9999px',
    backgroundColor: enabled ? colors.foreground : colors.border,
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    position: 'relative',
  }),
  toggleKnob: (enabled) => ({
    width: '14px',
    height: '14px',
    backgroundColor: colors.background,
    borderRadius: '9999px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s',
    position: 'absolute',
    top: '2px',
    left: enabled ? '16px' : '2px',
  }),
  main: {
    flex: 1,
    marginTop: '64px',
    overflowY: 'auto',
    backgroundColor: '#f9fafb',
  },
  emptyState: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateContent: {
    textAlign: 'center',
    maxWidth: '400px',
    padding: '0 32px',
  },
  emptyIcon: {
    width: '96px',
    height: '96px',
    margin: '0 auto',
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  emptyTitle: {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontSize: '30px',
    color: colors.foreground,
    marginTop: '24px',
    marginBottom: '12px',
  },
  emptyDesc: {
    color: colors.muted,
    lineHeight: 1.6,
    margin: 0,
  },
  waitingIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '24px',
    fontSize: '14px',
    color: colors.muted,
  },
  waitingDot: {
    width: '6px',
    height: '6px',
    backgroundColor: colors.muted,
    borderRadius: '9999px',
    animation: 'pulse 2s infinite',
  },
  configPanel: {
    padding: '32px',
  },
  configCard: {
    maxWidth: '672px',
    margin: '0 auto',
    backgroundColor: colors.card,
    borderRadius: '16px',
    border: `1px solid ${colors.border}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    overflow: 'hidden',
  },
  configHeader: {
    padding: '24px 32px',
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  configHeaderLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
  },
  configIcon: {
    width: '48px',
    height: '48px',
    backgroundColor: colors.foreground,
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  configTitle: {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontSize: '24px',
    color: colors.foreground,
    margin: 0,
  },
  configSubtitle: {
    fontSize: '14px',
    color: colors.muted,
    marginTop: '4px',
  },
  closeButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  configBody: {
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: colors.foreground,
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: colors.secondary,
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    color: colors.foreground,
    outline: 'none',
    transition: 'box-shadow 0.2s',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: colors.secondary,
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    color: colors.foreground,
    outline: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: colors.secondary,
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    color: colors.foreground,
    outline: 'none',
    resize: 'none',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
  },
  hint: {
    fontSize: '12px',
    color: colors.muted,
  },
  tagContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '12px',
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    backgroundColor: colors.secondary,
    color: colors.foreground,
    borderRadius: '9999px',
    fontSize: '14px',
    fontWeight: 500,
  },
  tagRemove: {
    padding: '2px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '9999px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiSection: {
    backgroundColor: colors.secondary,
    borderRadius: '12px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  aiHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  aiTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: colors.foreground,
    margin: 0,
  },
  aiDesc: {
    fontSize: '14px',
    color: colors.muted,
    margin: 0,
  },
  aiButton: {
    width: '100%',
    padding: '10px 16px',
    backgroundColor: colors.foreground,
    color: colors.background,
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  actionButtons: {
    display: 'flex',
    gap: '12px',
    paddingTop: '16px',
  },
  cancelButton: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: colors.secondary,
    color: colors.foreground,
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  saveButton: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: colors.foreground,
    color: colors.background,
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
};

// ============= DATA =============
const customizationNodes = {
  'Patient Data Nodes': [
    'Patient Profile Retriever', 'Historical Data Aggregator', 'Risk Score Calculator',
    'Allergy & Contraindication Checker', 'Medication Reconciliation Engine',
    'Lab Trend Analyzer', 'Imaging Result Parser'
  ],
  'Clinical Decision Nodes': [
    'Guideline Compliance Checker', 'Differential Diagnosis Suggester', 'Treatment Protocol Matcher',
    'Drug Interaction Validator', 'Dose Calculator (age/weight/renal adjusted)'
  ],
  'Order Management Nodes': [
    'Smart Lab Order Creator', 'Imaging Protocol Selector'
  ],
  'AI & Intelligence Nodes': [
    'Pattern Recognition Engine', 'Predictive Model Executor'
  ],
  'Communication Nodes': [
    'WhatsApp Business Message', 'Nurse Communication', 'SMS Gateway', 'Email with Templates',
    'Patient Portal Notification'
  ],
  'Documentation Nodes': [
    'Clinical Note Generator', 'Patient Summary Creator', 'Discharge Instruction Builder',
    'Consent Form Assembler', 'Voice-to-Text Transcriber'
  ],
};

const triggerOptions = [
  { value: 'on_reload', label: 'On Page Reload' },
  { value: 'by_button', label: 'By Button Click' },
];

const dataOptions = [
  'Vitals', 'Lab Report', 'Radiology', 'Biopsy', 'Medications', 'Treatment Plan',
];

// ============= COMPONENT =============
const WorkflowEngine = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState(() => {
    const initialCollapsed = {};
    Object.keys(customizationNodes).forEach(category => {
      initialCollapsed[category] = true;
    });
    return initialCollapsed;
  });
  const [activeFeature, setActiveFeature] = useState(null);
  const [featureStates, setFeatureStates] = useState(() => {
    const initialState = {};
    Object.entries(customizationNodes).forEach(([category, features]) => {
      features.forEach(feature => {
        initialState[feature] = {
          isEnabled: false,
          isConfigured: false,
          featureName: feature,
          trigger: 'by_button',
          buttonName: '',
          dataToBeTaken: [],
          messageTemplate: '',
          category: category,
          // ADD THESE:
          profileFields: [],
          profileDropdown: "",
          rulesForAnalysis: "",
          selectedLabTests: [],
          selectedVitals: [],
        };
      });
    });
    return initialState;
  });

  const toggleCategory = (category) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const handleEditClick = (feature, e) => {
    e.stopPropagation();
    setActiveFeature(feature);
  };

  const handleToggleFeature = (feature, e) => {
    e.stopPropagation();
    const currentState = featureStates[feature];

    if (!currentState.isEnabled) {
      setActiveFeature(feature);
    } else {
      setFeatureStates(prev => ({
        ...prev,
        [feature]: {
          ...prev[feature],
          isEnabled: false,
          isConfigured: false
        }
      }));
      if (activeFeature === feature) {
        setActiveFeature(null);
      }
    }
  };


  const profileFieldOptions = [
  "Patient Name",
  "Age",
  "Phone Number",
  "Address",
  "Gender",
  "Date of Birth",
  "Medical Record Number",
  "Blood Group"
];

const profileDropdownOptions = [
  "Show in Compact Mode",
  "Show in Detailed Mode",
  "High Priority",
  "Low Priority"
];  


const labTestOptions = [
  // Hematology
  "Hemoglobin",
  "Hematocrit",
  "RBC Count",
  "WBC Count",
  "Platelet Count",
  "MCV",
  "MCH",
  "MCHC",
  "RDW",
  "Differential Count (Neutrophils, Lymphocytes, Monocytes, Eosinophils, Basophils)",

  // Renal Function
  "Creatinine",
  "Urea",
  "BUN",
  "eGFR",
  "Uric Acid",

  // Electrolytes
  "Sodium",
  "Potassium",
  "Chloride",
  "Calcium",
  "Magnesium",
  "Phosphorus",

  // Liver Function
  "ALT (SGPT)",
  "AST (SGOT)",
  "Alkaline Phosphatase",
  "GGT",
  "Total Bilirubin",
  "Direct Bilirubin",
  "Indirect Bilirubin",
  "Albumin",
  "Globulin",
  "A/G Ratio",
  "Total Protein",

  // Diabetes
  "Fasting Glucose",
  "Postprandial Glucose",
  "Random Glucose",
  "HbA1c",
  "Insulin (Fasting)",
  "C-Peptide",

  // Lipid Profile
  "Total Cholesterol",
  "LDL Cholesterol",
  "HDL Cholesterol",
  "Triglycerides",
  "VLDL",
  "Non-HDL Cholesterol",

  // Inflammatory Markers
  "CRP",
  "hs-CRP",
  "ESR",
  "Procalcitonin",
  "Ferritin",
  "IL-6",

  // Cardiac Markers
  "Troponin I",
  "Troponin T",
  "CK-MB",
  "BNP / NT-proBNP",
  "D-Dimer",

  // Thyroid Profile
  "TSH",
  "Free T3",
  "Free T4",
  "Total T3",
  "Total T4",
  "Anti-TPO Antibody",
  "Anti-Thyroglobulin Antibody",

  // Coagulation Profile
  "PT",
  "INR",
  "aPTT",
  "Fibrinogen",

  // Infectious Markers
  "HIV",
  "HBsAg",
  "HCV",
  "Malaria Parasite",
  "Dengue NS1",
  "Dengue IgG/IgM",
  "Widal Test",

  // Urinalysis
  "Urine Protein",
  "Urine Glucose",
  "Urine Ketones",
  "Urine pH",
  "Urine Microscopy",

  // Others
  "Vitamin D (25-OH)",
  "Vitamin B12",
  "Iron",
  "TIBC",
  "Transferrin Saturation",
  "LDH"
];

const vitalFieldOptions = [
  // Basic Vitals
  "Temperature",
  "Heart Rate (Pulse)",
  "Respiratory Rate",
  "Blood Pressure (Systolic)",
  "Blood Pressure (Diastolic)",
  "Mean Arterial Pressure (MAP)",
  "SpO2 (Oxygen Saturation)",

  // Anthropometrics
  "Weight",
  "Height",
  "BMI",
  "Waist Circumference",
  "Hip Circumference",
  "Waist-Hip Ratio",

  // Advanced Respiratory
  "Oxygen Flow Rate",
  "PEEP (if ventilated)",
  "FiO2",
  "EtCO2 (End-Tidal CO2)",
  "Peak Inspiratory Pressure",

  // Neurological
  "GCS Score (Glasgow Coma Scale)",
  "Pupil Size",
  "Pupil Reaction",
  "Pain Score",

  // Cardiovascular
  "Peripheral Perfusion",
  "Capillary Refill Time",
  "Pulse Pressure",
  "Cardiac Output (If available)",
  "Stroke Volume",

  // Fluids & Intake/Output
  "IV Fluids Given",
  "Oral Intake",
  "Urine Output",
  "Drain Output",
  "Blood Loss",

  // Specialized
  "Blood Glucose (Bedside)",
  "Ketone Level (Bedside)",
  "Lactate (Point of Care)",
  "Pregnancy Test (Urine/HCG)",

  // Monitoring
  "ECG Rhythm",
  "Respiratory Pattern",
  "Skin Temperature",
  "Skin Turgor (Dehydration)",
  "Oedema Grade",

  // Device-related
  "Ventilator Mode",
  "CPAP/BiPAP Settings",
  "Pacemaker Settings"
];


  
  const handleSaveFeature = () => {
    if (!activeFeature) return;
    setFeatureStates(prev => ({
      ...prev,
      [activeFeature]: {
        ...prev[activeFeature],
        isEnabled: true,
        isConfigured: true
      }
    }));
    setActiveFeature(null);
  };

  const handleCancelConfiguration = () => {
    setActiveFeature(null);
  };

  const handleConfigChange = (field, value) => {
    if (!activeFeature) return;
    setFeatureStates(prev => ({
      ...prev,
      [activeFeature]: {
        ...prev[activeFeature],
        [field]: value
      }
    }));
  };

  const handleDataSelect = (e) => {
    const value = e.target.value;
    if (activeFeature && value && !featureStates[activeFeature].dataToBeTaken.includes(value)) {
      handleConfigChange('dataToBeTaken', [...featureStates[activeFeature].dataToBeTaken, value]);
    }
    e.target.value = '';
  };

  const handleDataRemove = (item) => {
    if (activeFeature) {
      handleConfigChange(
        'dataToBeTaken',
        featureStates[activeFeature].dataToBeTaken.filter(data => data !== item)
      );
    }
  };

  const getCategoryIcon = (categoryName) => {
    if (categoryName.includes('Patient Data')) return Database;
    if (categoryName.includes('Clinical Decision')) return Command;
    if (categoryName.includes('Order Management')) return FileText;
    if (categoryName.includes('Communication')) return MessageSquare;
    if (categoryName.includes('Documentation')) return FileText;
    if (categoryName.includes('Integration')) return Link;
    if (categoryName.includes('AI & Intelligence')) return Brain;
    if (categoryName.includes('Workflow Control')) return GitBranch;
    return Settings;
  };

  const getFeatureIcon = (feature) => {
    if (feature.includes('WhatsApp')) return MessageCircle;
    if (feature.includes('SMS')) return Phone;
    if (feature.includes('Email')) return Mail;
    if (feature.includes('Alert')) return Bell;
    if (feature.includes('Secure')) return Shield;
    return Send;
  };

  const enabledCount = Object.values(featureStates).filter(f => f.isEnabled).length;
  const isCommunicationNode = activeFeature && featureStates[activeFeature]?.category === 'Communication Nodes';

  return (
    <div style={styles.container}>
      {/* Navbar */}
      <header style={styles.navbar}>
        <div style={styles.navbarLeft}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={styles.menuButton}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = colors.secondary}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Menu size={20} color={colors.muted} />
          </button>
          
          <div style={styles.logoContainer}>
            <div style={styles.logoIcon}>
              <Workflow color={colors.background} size={18} />
            </div>
            <h1 style={styles.title}>Workflow Engine</h1>
          </div>
        </div>

        <div style={styles.badge}>
          <span style={styles.badgeCount}>{enabledCount}</span> active
        </div>
      </header>

      {/* Sidebar */}
      <aside style={styles.sidebar(sidebarOpen)}>
        <div style={styles.sidebarInner}>
          <div style={styles.sidebarPadding}>
            <div style={styles.sidebarHeader}>
              <Layers size={16} color={colors.muted} />
              <span style={styles.sidebarLabel}>Node Categories</span>
            </div>
            
            <div>
              {Object.entries(customizationNodes).map(([category, features]) => {
                const Icon = getCategoryIcon(category);
                const isCollapsed = collapsedCategories[category];
                const enabledInCategory = features.filter(f => featureStates[f].isEnabled).length;

                return (
                  <div key={category} style={{ marginBottom: '4px' }}>
                    <button
                      onClick={() => toggleCategory(category)}
                      style={styles.categoryButton}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = colors.secondary}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span style={styles.chevron(isCollapsed)}>
                        <ChevronRight size={14} />
                      </span>
                      <Icon size={16} color={colors.muted} />
                      <span style={styles.categoryName}>
                        {category.replace(' Nodes', '')}
                      </span>
                      {enabledInCategory > 0 && (
                        <span style={styles.categoryBadge}>
                          {enabledInCategory}
                        </span>
                      )}
                    </button>

                    <div style={styles.featureList(isCollapsed)}>
                      <div style={styles.featureListInner}>
                        {features.map((feature) => {
                          const state = featureStates[feature];
                          const FeatureIcon = getFeatureIcon(feature);
                          const isActive = activeFeature === feature;
                          const isDisabled = activeFeature && activeFeature !== feature;

                          return (
                            <div
                              key={feature}
                              style={styles.featureItem(state.isEnabled, isActive, isDisabled)}
                            >
                              <FeatureIcon
                                size={14}
                                color={state.isEnabled ? colors.foreground : colors.muted}
                              />

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={styles.featureName(state.isEnabled)}>
                                  {feature}
                                </p>
                              </div>

                              <div style={styles.featureActions}>
                                {state.isConfigured && (
                                  <CheckCircle2 size={12} color={colors.success} />
                                )}

                                {state.isEnabled && (
                                  <button
                                    onClick={(e) => handleEditClick(feature, e)}
                                    style={{
                                      ...styles.editButton,
                                      pointerEvents: isDisabled ? 'none' : 'auto',
                                    }}
                                    disabled={!!isDisabled}
                                  >
                                    <Edit2 size={12} color={colors.muted} />
                                  </button>
                                )}

                                <button
                                  onClick={(e) => handleToggleFeature(feature, e)}
                                  disabled={!!isDisabled && !state.isEnabled}
                                  style={{
                                    ...styles.toggle(state.isEnabled),
                                    cursor: isDisabled && !state.isEnabled ? 'not-allowed' : 'pointer',
                                    opacity: isDisabled && !state.isEnabled ? 0.5 : 1,
                                  }}
                                >
                                  <div style={styles.toggleKnob(state.isEnabled)} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main style={styles.main}>
        {!activeFeature ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyStateContent}>
              <div style={styles.emptyIcon}>
                <Settings size={32} color={colors.muted} />
              </div>
              <h2 style={styles.emptyTitle}>Select a Node</h2>
              <p style={styles.emptyDesc}>
                Enable a workflow node from the sidebar to configure its parameters and behavior.
              </p>
              <div style={styles.waitingIndicator}>
                <div style={styles.waitingDot} />
                <span>Waiting for selection</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={styles.configPanel}>
            <div style={styles.configCard}>
              {/* Header */}
              <div style={styles.configHeader}>
                <div style={styles.configHeaderLeft}>
                  <div style={styles.configIcon}>
                    {(() => {
                      const Icon = getFeatureIcon(activeFeature);
                      return <Icon size={20} color={colors.background} />;
                    })()}
                  </div>
                  <div>
                    <h2 style={styles.configTitle}>{activeFeature}</h2>
                    <p style={styles.configSubtitle}>
                      {featureStates[activeFeature].category}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleCancelConfiguration}
                  style={styles.closeButton}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = colors.secondary}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <X size={18} color={colors.muted} />
                </button>
              </div>

              {/* Form */}
<div style={styles.configBody}>

  {/* SPECIAL FORM ONLY FOR PATIENT PROFILE RETRIEVER */}
  {activeFeature === "Patient Profile Retriever" ? (
    <>
      {/* FIELD CHECKBOXES */}
      <div
        style={{
          padding: "20px",
          border: `1px solid ${colors.border}`,
          borderRadius: "12px",
          background: colors.secondary,
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}
      >
        <h3 style={{ fontSize: "16px", fontWeight: 600, color: colors.foreground }}>
          Select Patient Fields
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {profileFieldOptions.map((field) => (
            <label key={field} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="checkbox"
                checked={featureStates[activeFeature].profileFields.includes(field)}
                onChange={(e) => {
                  const oldFields = featureStates[activeFeature].profileFields;

                  if (e.target.checked) {
                    handleConfigChange("profileFields", [...oldFields, field]);
                  } else {
                    handleConfigChange(
                      "profileFields",
                      oldFields.filter((f) => f !== field)
                    );
                  }
                }}
              />
              {field}
            </label>
          ))}
        </div>

        {/* DROPDOWN */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Profile Display Mode</label>

          <select
            value={featureStates[activeFeature].profileDropdown}
            onChange={(e) => handleConfigChange("profileDropdown", e.target.value)}
            style={styles.select}
          >
            <option value="">Select option...</option>
            {profileDropdownOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ACTION BUTTONS for Patient Profile Retriever */}
      <div style={styles.actionButtons}>
        <button
          type="button"
          onClick={handleCancelConfiguration}
          style={styles.cancelButton}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveFeature}
          style={styles.saveButton}
        >
          <Check size={16} />
          Save Configuration
        </button>
      </div>
    </>
  ) : (
    <>
      {/* ORIGINAL FORM FOR ALL OTHER FEATURES */}

      <div style={styles.formGroup}>
        <label style={styles.label}>Display Name</label>
        <input
          type="text"
          value={featureStates[activeFeature].featureName}
          onChange={(e) => handleConfigChange("featureName", e.target.value)}
          style={styles.input}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Trigger Method</label>
        <select
          value={featureStates[activeFeature].trigger}
          onChange={(e) => handleConfigChange("trigger", e.target.value)}
          style={styles.select}
        >
          <option value="">Select trigger...</option>
          {triggerOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {featureStates[activeFeature].trigger === 'by_button' && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Button Label</label>
          <input
            type="text"
            value={featureStates[activeFeature].buttonName}
            onChange={(e) => handleConfigChange("buttonName", e.target.value)}
            style={styles.input}
          />
        </div>
      )}

      {isCommunicationNode && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Message Template</label>
          <textarea
            value={featureStates[activeFeature].messageTemplate}
            onChange={(e) => handleConfigChange("messageTemplate", e.target.value)}
            style={styles.textarea}
            rows={4}
          />
        </div>
      )}

      <div style={styles.formGroup}>
        <label style={styles.label}>Data Sources</label>
        <select
          onChange={handleDataSelect}
          value=""
          style={styles.select}
        >
          <option value="">Add data source...</option>
          {dataOptions.filter(opt => !featureStates[activeFeature].dataToBeTaken.includes(opt)).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>

        <div style={styles.tagContainer}>
          {featureStates[activeFeature].dataToBeTaken.map(data => (
            <span key={data} style={styles.tag}>
              {data}
              <button
                type="button"
                onClick={() => handleDataRemove(data)}
                style={styles.tagRemove}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>
{/* CONDITIONAL — LAB REPORT SUBFORM */}
{featureStates[activeFeature].dataToBeTaken.includes("Lab Report") && (
  <div
    style={{
      padding: "20px",
      border: `1px solid ${colors.border}`,
      borderRadius: "12px",
      background: colors.secondary,
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    }}
  >
    <h3 style={{ fontSize: "16px", fontWeight: 600, color: colors.foreground }}>
      Select Lab Test Fields
    </h3>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px" }}>
      {labTestOptions.map((test) => (
        <label key={test} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={featureStates[activeFeature].selectedLabTests.includes(test)}
            onChange={(e) => {
              const selected = featureStates[activeFeature].selectedLabTests;
              if (e.target.checked) {
                handleConfigChange("selectedLabTests", [...selected, test]);
              } else {
                handleConfigChange(
                  "selectedLabTests",
                  selected.filter((t) => t !== test)
                );
              }
            }}
          />
          {test}
        </label>
      ))}
    </div>
  </div>
)}

{/* CONDITIONAL — VITALS SUBFORM */}
{featureStates[activeFeature].dataToBeTaken.includes("Vitals") && (
  <div
    style={{
      padding: "20px",
      border: `1px solid ${colors.border}`,
      borderRadius: "12px",
      background: colors.secondary,
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    }}
  >
    <h3 style={{ fontSize: "16px", fontWeight: 600, color: colors.foreground }}>
      Select Vital Parameters
    </h3>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
      {vitalFieldOptions.map((vital) => (
        <label key={vital} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={featureStates[activeFeature].selectedVitals.includes(vital)}
            onChange={(e) => {
              const selected = featureStates[activeFeature].selectedVitals;
              if (e.target.checked) {
                handleConfigChange("selectedVitals", [...selected, vital]);
              } else {
                handleConfigChange(
                  "selectedVitals",
                  selected.filter((v) => v !== vital)
                );
              }
            }}
          />
          {vital}
        </label>
      ))}
    </div>
  </div>
)}

      <div style={styles.formGroup}>
  <label style={styles.label}>Rules for Analysis</label>

  <textarea
    value={featureStates[activeFeature].rulesForAnalysis}
    onChange={(e) => handleConfigChange("rulesForAnalysis", e.target.value)}
    rows={4}
    style={styles.textarea}
    placeholder="Define rules for how the engine should analyze and process this node..."
  />

  <p style={styles.hint}>
    Example: “If lab values exceed threshold, trigger warning. Validate patient age before dosage calculation.”
  </p>
</div>


      {/* ACTION BUTTONS for all other features */}
      <div style={styles.actionButtons}>
        <button
          type="button"
          onClick={handleCancelConfiguration}
          style={styles.cancelButton}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveFeature}
          style={styles.saveButton}
        >
          <Check size={16} />
          Save Configuration
        </button>
      </div>
    </>
  )}

</div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default WorkflowEngine;
