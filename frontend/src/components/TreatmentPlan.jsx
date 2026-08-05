import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from "react";
import { 
  Box, 
  Typography, 
  Button, 
  IconButton,
  CircularProgress,
  Alert,
  Chip,
  Divider,
  Paper,
  Grid,
  Card,
  CardContent,
  Tooltip,
  Collapse,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  ToggleButton,
  ToggleButtonGroup
} from "@mui/material";
import { 
  RefreshRounded, 
  ExpandMore, 
  ExpandLess,
  LocalHospitalRounded,
  MedicationRounded,
  ScienceRounded,
  AssignmentRounded,
  TimelineRounded,
  CheckCircleRounded,
  InfoRounded,
  EditRounded,
  DeleteRounded,
  PlayArrowRounded,
  SaveRounded,
  CloseRounded,
  WarningRounded,
  HistoryRounded,
  AddRounded,
  RemoveRounded,
  MicRounded,
  HearingRounded,
  RecordVoiceOverRounded,
  CheckRounded,
  HealingRounded,
  FavoriteRounded,
  PsychologyRounded,
  BiotechRounded,
  ErrorRounded,
  GppBadRounded,
  DoNotDisturbRounded,
  AssessmentRounded,
  ThumbUpRounded,
  BuildRounded,
  LoopRounded,
  PictureAsPdfRounded,
  DownloadRounded
} from "@mui/icons-material";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// API Base URL from environment
const API_BASE_URL = "https://doctorassist.ai/api/"

// Status constants
const PLAN_STATUS = {
  CURRENT: 'current',
  DRAFT: 'draft',
  ARCHIVED: 'archived',
  MODIFIED: 'modified',
  CONTINUE: 'continue',
  DELETED: 'deleted'
};
import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
// ─── COMPANY THEME ───
// Matches: Open Sans, black/white/grey palette, sharp borders, editorial minimalism
const T = {
  // Backgrounds
  bg: theme.bg,
  bgSecondary: theme.bgAlt,
  bgTertiary: theme.bgTert,

  // Text
  textPrimary: theme.text,
  textSecondary: theme.textSec,
  textMuted: theme.textMuted,

  // Borders
  border: theme.border,
  borderStrong: theme.borderStr,

  // Accent
  accent: theme.accent,
  accentHover: theme.accentHover ?? theme.accent,
  accentFg: theme.bg,

  // Status colors
  success: theme.success,
  warning: theme.warning,
  danger: theme.danger,
  info: theme.info,

  // Typography
  fontFamily: theme.font,
};

// Unified Minimalistic Toggle Component
const MinimalToggle = ({ checked, onChange, label = '', color = '#000000' }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClick = () => {
    setIsAnimating(true);
    onChange(!checked);
    setTimeout(() => setIsAnimating(false), 300);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: label ? '120px' : 'auto' }}>
      {label && (
        <Typography variant="caption" sx={{
          fontSize: '0.65rem',
          mb: 0.75,
          color: checked ? theme.textPrimary : theme.textMuted,
          fontWeight: checked ? 600 : 400,
          fontFamily: theme.fontFamily,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          transition: 'all 0.2s ease',
          textAlign: 'center',
        }}>
          {label}
        </Typography>
      )}
      <Box
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        sx={{
          position: 'relative',
          width: 44,
          height: 22,
          borderRadius: 0,
          cursor: 'pointer',
          backgroundColor: checked ? theme.accent : 'transparent',
          border: `1px solid ${checked ? theme.borderStrong : theme.border}`,
          transform: isHovered ? 'scale(1.03)' : 'scale(1)',
          transition: 'all 0.2s ease',
        }}
      >
        <Box sx={{
          position: 'absolute',
          top: 2,
          width: 16,
          height: 16,
          backgroundColor: checked ? theme.accentFg : theme.textMuted,
          transform: checked ? 'translateX(22px)' : 'translateX(2px)',
          transition: 'transform 0.25s ease, background-color 0.2s ease',
        }} />
      </Box>
    </Box>
  );
};

// Evaluation Section Component
const EvaluationSection = ({ evaluation }) => {
  if (!evaluation) return null;

  const evaluationItems = [
    {
      key: 'standard_of_care_alignment',
      label: 'Standard of Care',
      icon: <ThumbUpRounded sx={{ fontSize: '0.9rem' }} />,
      value: evaluation.standard_of_care_alignment || evaluation.appropriateness
    },
    {
      key: 'practical_feasibility',
      label: 'Feasibility',
      icon: <BuildRounded sx={{ fontSize: '0.9rem' }} />,
      value: evaluation.practical_feasibility || evaluation.safety
    },
    {
      key: 'doability_and_sustainability',
      label: 'Sustainability',
      icon: <LoopRounded sx={{ fontSize: '0.9rem' }} />,
      value: evaluation.doability_and_sustainability || evaluation.completeness
    }
  ].filter(item => item.value && item.value.trim() !== "");

  if (evaluationItems.length === 0) return null;

  return (
    <Card sx={styles.evaluationCard} elevation={0}>
      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
        <Box sx={styles.evaluationHeader}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={styles.sectionIconBox}><AssessmentRounded sx={{ fontSize: '0.85rem' }} /></Box>
            <Typography variant="subtitle2" sx={styles.sectionLabelText}>Clinical Evaluation</Typography>
          </Box>
        </Box>
        <Box sx={{ p: 2 }}>
          <Grid container spacing={1.5}>
            {evaluationItems.map((item) => (
              <Grid item xs={12} md={4} key={item.key}>
                <Paper elevation={0} sx={styles.evaluationItemPaper}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                    {item.icon}
                    <Typography variant="caption" sx={{ color: theme.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.62rem' }}>
                      {item.label}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ color: theme.textSecondary, fontSize: '0.8rem', lineHeight: 1.6 }}>
                    {item.value}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Box>
      </CardContent>
    </Card>
  );
};

// Editable Treatment Protocol Section Component
const EditableTreatmentProtocolSection = ({ sectionData, styles, onDataChange, isSectionsFormat = false }) => {
  const handleFieldChange = (fieldPath, value) => {
    if (onDataChange) onDataChange(fieldPath, value);
  };

  const renderTextField = (value, fieldPath, label, multiline = false) => (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={value || ''}
      onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
      variant="outlined"
      multiline={multiline}
      minRows={multiline ? 2 : 1}
      sx={{
        mt: 1, mb: 1,
        '& .MuiOutlinedInput-root': {
          borderRadius: 0,
          fontFamily: theme.fontFamily,
          fontSize: '0.82rem',
          '& fieldset': { borderColor: theme.border },
          '&:hover fieldset': { borderColor: theme.textSecondary },
          '&.Mui-focused fieldset': { borderColor: theme.borderStrong, borderWidth: '1px' },
        },
        '& .MuiInputLabel-root': { fontFamily: theme.fontFamily, fontSize: '0.78rem', color: theme.textMuted },
        '& .MuiInputLabel-root.Mui-focused': { color: theme.textPrimary },
      }}
    />
  );

  const renderSelectField = (value, fieldPath, label, options) => (
    <FormControl fullWidth size="small" sx={{ mt: 1, mb: 1 }}>
      <InputLabel sx={{ fontFamily: theme.fontFamily, fontSize: '0.78rem', color: theme.textMuted }}>{label}</InputLabel>
      <Select
        value={value || ''}
        label={label}
        onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
        sx={{ borderRadius: 0, fontFamily: theme.fontFamily, fontSize: '0.82rem', '& fieldset': { borderColor: theme.border } }}
      >
        {options.map((opt) => (
          <MenuItem key={opt.value} value={opt.value} sx={{ fontFamily: theme.fontFamily, fontSize: '0.82rem' }}>{opt.label}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const sectionBoxStyle = {
    mb: 2,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg,
  };
  const sectionHeaderStyle = {
    px: 2, py: 1.25,
    borderBottom: `1px solid ${theme.border}`,
    backgroundColor: theme.bgSecondary,
    display: 'flex', alignItems: 'center', gap: 1,
  };

  if (isSectionsFormat) {
    return (
      <Box>
        {sectionData.medications && sectionData.medications.length > 0 && (
          <Box sx={sectionBoxStyle}>
            <Box sx={sectionHeaderStyle}>
              <Box sx={styles.sectionIconBox}><MedicationRounded sx={{ fontSize: '0.8rem' }} /></Box>
              <Typography sx={styles.sectionLabelText}>Medications ({sectionData.medications.length})</Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              {sectionData.medications.map((med, idx) => (
                <TextField key={idx} fullWidth multiline rows={4} label={`Medication ${idx + 1}`} value={med?.name || ''}
                  onChange={(e) => handleFieldChange(`medications[${idx}].name`, e.target.value)} variant="outlined"
                  sx={{ mb: idx < sectionData.medications.length - 1 ? 1.5 : 0, '& .MuiOutlinedInput-root': { borderRadius: 0 } }} />
              ))}
            </Box>
          </Box>
        )}
        {sectionData.investigations && sectionData.investigations.length > 0 && (
          <Box sx={sectionBoxStyle}>
            <Box sx={sectionHeaderStyle}>
              <Box sx={styles.sectionIconBox}><ScienceRounded sx={{ fontSize: '0.8rem' }} /></Box>
              <Typography sx={styles.sectionLabelText}>Investigations ({sectionData.investigations.length})</Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              {sectionData.investigations.map((inv, idx) => (
                <TextField key={idx} fullWidth multiline rows={4} label={`Investigation ${idx + 1}`} value={inv?.name || ''}
                  onChange={(e) => handleFieldChange(`investigations[${idx}].name`, e.target.value)} variant="outlined"
                  sx={{ mb: idx < sectionData.investigations.length - 1 ? 1.5 : 0, '& .MuiOutlinedInput-root': { borderRadius: 0 } }} />
              ))}
            </Box>
          </Box>
        )}
        {sectionData.lifestyleModifications && sectionData.lifestyleModifications.length > 0 && (
          <Box sx={sectionBoxStyle}>
            <Box sx={sectionHeaderStyle}>
              <Box sx={styles.sectionIconBox}><InfoRounded sx={{ fontSize: '0.8rem' }} /></Box>
              <Typography sx={styles.sectionLabelText}>Procedural Plan ({sectionData.lifestyleModifications.length})</Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              {sectionData.lifestyleModifications.map((mod, idx) => (
                <TextField key={idx} fullWidth multiline rows={4} label={`Procedure ${idx + 1}`} value={mod?.recommendation || ''}
                  onChange={(e) => handleFieldChange(`lifestyleModifications[${idx}].recommendation`, e.target.value)} variant="outlined"
                  sx={{ mb: idx < sectionData.lifestyleModifications.length - 1 ? 1.5 : 0, '& .MuiOutlinedInput-root': { borderRadius: 0 } }} />
              ))}
            </Box>
          </Box>
        )}
        {sectionData.followUpPlan && (
          <Box sx={sectionBoxStyle}>
            <Box sx={sectionHeaderStyle}>
              <Box sx={styles.sectionIconBox}><TimelineRounded sx={{ fontSize: '0.8rem' }} /></Box>
              <Typography sx={styles.sectionLabelText}>Follow-up Plan</Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              <TextField fullWidth multiline rows={3} label="Follow-up Plan" value={sectionData.followUpPlan.nextVisit || ''}
                onChange={(e) => handleFieldChange('followUpPlan.nextVisit', e.target.value)} variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 0 } }} />
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box>
      {sectionData.primaryGoals && sectionData.primaryGoals.length > 0 && (
        <Box sx={sectionBoxStyle}>
          <Box sx={sectionHeaderStyle}>
            <Box sx={styles.sectionIconBox}><AssessmentRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Primary Goals</Typography>
            <IconButton size="small" onClick={() => handleFieldChange('primaryGoals._add', true)} sx={{ ml: 'auto', borderRadius: 0, p: 0.5 }}><AddRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
          </Box>
          <Box sx={{ p: 2 }}>
            {sectionData.primaryGoals.map((goal, index) => (
              <Box key={index} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                <Box sx={{ width: 6, height: 6, backgroundColor: theme.accent, mt: 1.5, flexShrink: 0 }} />
                <Box sx={{ flex: 1 }}>{renderTextField(goal, `primaryGoals[${index}]`, `Goal ${index + 1}`, true)}</Box>
                <IconButton size="small" onClick={() => handleFieldChange(`primaryGoals[${index}]._delete`, true)} sx={{ borderRadius: 0, p: 0.5, mt: 1 }}><RemoveRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {sectionData.medications && sectionData.medications.length > 0 && (
        <Box sx={sectionBoxStyle}>
          <Box sx={sectionHeaderStyle}>
            <Box sx={styles.sectionIconBox}><MedicationRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Medications</Typography>
            <IconButton size="small" onClick={() => handleFieldChange('medications._add', true)} sx={{ ml: 'auto', borderRadius: 0, p: 0.5 }}><AddRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {sectionData.medications.map((med, index) => (
                <Grid item xs={12} key={index}>
                  <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted }}>Medication {index + 1}</Typography>
                      <IconButton size="small" onClick={() => handleFieldChange(`medications[${index}]._delete`, true)} sx={{ borderRadius: 0, p: 0.5 }}><RemoveRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
                    </Box>
                    {renderTextField(med.name, `medications[${index}].name`, 'Name')}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Box sx={{ flex: 1 }}>{renderTextField(med.dose, `medications[${index}].dose`, 'Dose')}</Box>
                      <Box sx={{ flex: 1 }}>{renderTextField(med.frequency, `medications[${index}].frequency`, 'Frequency')}</Box>
                    </Box>
                    {renderTextField(med.indication, `medications[${index}].indication`, 'Indication', true)}
                    {renderTextField(med.guideline, `medications[${index}].guideline`, 'Guideline', true)}
                    {renderTextField(med.patientSpecific, `medications[${index}].patientSpecific`, 'Patient Specific', true)}
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      )}

      {sectionData.investigations && sectionData.investigations.length > 0 && (
        <Box sx={sectionBoxStyle}>
          <Box sx={sectionHeaderStyle}>
            <Box sx={styles.sectionIconBox}><ScienceRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Investigations</Typography>
            <IconButton size="small" onClick={() => handleFieldChange('investigations._add', true)} sx={{ ml: 'auto', borderRadius: 0, p: 0.5 }}><AddRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {sectionData.investigations.map((inv, index) => (
                <Grid item xs={12} key={index}>
                  <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted }}>Investigation {index + 1}</Typography>
                      <IconButton size="small" onClick={() => handleFieldChange(`investigations[${index}]._delete`, true)} sx={{ borderRadius: 0, p: 0.5 }}><RemoveRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
                    </Box>
                    {renderTextField(inv.name, `investigations[${index}].name`, 'Name')}
                    {renderSelectField(inv.urgency, `investigations[${index}].urgency`, 'Urgency', [
                      { value: 'routine', label: 'Routine' },
                      { value: 'urgent', label: 'Urgent' },
                      { value: 'stat', label: 'STAT' }
                    ])}
                    {renderTextField(inv.indication, `investigations[${index}].indication`, 'Indication', true)}
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      )}

      {sectionData.lifestyleModifications && sectionData.lifestyleModifications.length > 0 && (
        <Box sx={sectionBoxStyle}>
          <Box sx={sectionHeaderStyle}>
            <Box sx={styles.sectionIconBox}><InfoRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Lifestyle Modifications</Typography>
            <IconButton size="small" onClick={() => handleFieldChange('lifestyleModifications._add', true)} sx={{ ml: 'auto', borderRadius: 0, p: 0.5 }}><AddRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {sectionData.lifestyleModifications.map((mod, index) => (
                <Grid item xs={12} key={index}>
                  <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted }}>Modification {index + 1}</Typography>
                      <IconButton size="small" onClick={() => handleFieldChange(`lifestyleModifications[${index}]._delete`, true)} sx={{ borderRadius: 0, p: 0.5 }}><RemoveRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
                    </Box>
                    {renderTextField(mod.recommendation, `lifestyleModifications[${index}].recommendation`, 'Recommendation', true)}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Box sx={{ flex: 1 }}>{renderTextField(mod.evidence, `lifestyleModifications[${index}].evidence`, 'Evidence')}</Box>
                      <Box sx={{ flex: 1 }}>{renderTextField(mod.difficulty, `lifestyleModifications[${index}].difficulty`, 'Difficulty')}</Box>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      )}

      {sectionData.followUpPlan && (
        <Box sx={sectionBoxStyle}>
          <Box sx={sectionHeaderStyle}>
            <Box sx={styles.sectionIconBox}><TimelineRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Follow-up Plan</Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            {renderTextField(sectionData.followUpPlan.nextVisit, 'followUpPlan.nextVisit', 'Next Visit')}
            {sectionData.followUpPlan.monitoringParameters && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted }}>Monitoring Parameters</Typography>
                  <IconButton size="small" onClick={() => handleFieldChange('followUpPlan.monitoringParameters._add', true)} sx={{ borderRadius: 0, p: 0.5 }}><AddRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
                </Box>
                {sectionData.followUpPlan.monitoringParameters.map((param, index) => (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                    <Box sx={{ flex: 1 }}>{renderTextField(param, `followUpPlan.monitoringParameters[${index}]`, `Parameter ${index + 1}`)}</Box>
                    <IconButton size="small" onClick={() => handleFieldChange(`followUpPlan.monitoringParameters[${index}]._delete`, true)} sx={{ borderRadius: 0, p: 0.5 }}><RemoveRounded sx={{ fontSize: '0.9rem' }} /></IconButton>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

// Splits a procedures block into individual procedures. Instead of relying on a literal
// '•' character (fragile — bullet style can vary or be missing in older saved data),
// it detects a new procedure by the fact that its title line is always immediately
// followed by "- Indication:" (guaranteed by how these blocks are generated).
const splitProcedureBlocks = (text) => {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let current = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || '';
    const looksLikeTitle = line.trim() !== '' && !/^\s*[-·]/.test(line) && /-\s*Indication:/i.test(nextLine);
    if (looksLikeTitle && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks
    .map(b => b.replace(/^\s*[•\-*·]\s*/, '').trim())
    .filter(b => b);
};

// Standalone helper: finds a "RECOMMENDED PROCEDURES" block anywhere in a body of text
// and parses it, independent of whether the surrounding data is in 'protocol' or 'sections' format.
const extractAndParseProcedures = (text) => {
  if (!text || typeof text !== 'string') return [];
  const LABELS = ['TREATMENT INTENT', 'PRIMARY GOALS', 'FIRST-LINE MEDICATIONS', 'ADJUNCTIVE MEDICATIONS', 'MEDICATIONS', 'RECOMMENDED PROCEDURES', 'REQUIRED INVESTIGATIONS', 'INVESTIGATIONS', 'LIFESTYLE MODIFICATIONS', 'FOLLOW-UP PLAN'];
  const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const boundary = LABELS.filter(l => l !== 'RECOMMENDED PROCEDURES').map(esc).join('|');
  const re = new RegExp(`RECOMMENDED PROCEDURES\\s*([^]*?)(?=${boundary}|$)`, 'i');
  const m = text.match(re);
  if (!m || !m[1] || !m[1].trim()) return [];
  return splitProcedureBlocks(m[1]).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    if (!lines.length) return null;
    const proc = {
      name: lines[0], indication: '', timing: '', reasonNeeded: '', guideline: '', patientSpecific: '',
      supportingTrial: '', cardiacRisk: '', duration: '', anesthesia: '', hospitalStay: '', recoveryTime: '',
      expectedBenefit: '', expectedOutcome: '', alternative: '', comments: '', scopeCompliant: '', scopeReason: '',
      steps: [], prerequisites: [], contraindications: [], complications: [], postCare: []
    };
    lines.forEach(line => {
      const ll = line.toLowerCase();
      if (ll.startsWith('· step:')) proc.steps.push(line.replace(/·\s*Step:/i, '').trim());
      else if (ll.startsWith('· prerequisite:')) proc.prerequisites.push(line.replace(/·\s*Prerequisite:/i, '').trim());
      else if (ll.startsWith('· contraindication:')) proc.contraindications.push(line.replace(/·\s*Contraindication:/i, '').trim());
      else if (ll.startsWith('· possible complication:')) proc.complications.push(line.replace(/·\s*Possible Complication:/i, '').trim());
      else if (ll.startsWith('· post-procedure care:')) proc.postCare.push(line.replace(/·\s*Post-Procedure Care:/i, '').trim());
      else if (ll.includes('- indication:')) proc.indication = line.replace(/-\s*Indication:/i, '').trim();
      else if (ll.includes('- timing:')) proc.timing = line.replace(/-\s*Timing:/i, '').trim();
      else if (ll.includes('- reason needed:')) proc.reasonNeeded = line.replace(/-\s*Reason Needed:/i, '').trim();
      else if (ll.includes('- guideline:')) proc.guideline = line.replace(/-\s*Guideline:/i, '').trim();
      else if (ll.includes('- patient specific:')) proc.patientSpecific = line.replace(/-\s*Patient Specific:/i, '').trim();
      else if (ll.includes('- supporting trial:')) proc.supportingTrial = line.replace(/-\s*Supporting Trial:/i, '').trim();
      else if (ll.includes('- cardiac risk:')) proc.cardiacRisk = line.replace(/-\s*Cardiac Risk:/i, '').trim();
      else if (ll.includes('- estimated duration:')) proc.duration = line.replace(/-\s*Estimated Duration:/i, '').trim();
      else if (ll.includes('- anesthesia:')) proc.anesthesia = line.replace(/-\s*Anesthesia:/i, '').trim();
      else if (ll.includes('- hospital stay:')) proc.hospitalStay = line.replace(/-\s*Hospital Stay:/i, '').trim();
      else if (ll.includes('- recovery time:')) proc.recoveryTime = line.replace(/-\s*Recovery Time:/i, '').trim();
      else if (ll.includes('- expected benefit:')) proc.expectedBenefit = line.replace(/-\s*Expected Benefit:/i, '').trim();
      else if (ll.includes('- expected outcome:')) proc.expectedOutcome = line.replace(/-\s*Expected Outcome:/i, '').trim();
      else if (ll.includes('- alternative:')) proc.alternative = line.replace(/-\s*Alternative:/i, '').trim();
      else if (ll.includes('- comments:')) proc.comments = line.replace(/-\s*Comments:/i, '').trim();
      else if (ll.includes('- specialty scope compliant:')) proc.scopeCompliant = line.replace(/-\s*Specialty Scope Compliant:/i, '').trim();
      else if (ll.includes('- scope reason:')) proc.scopeReason = line.replace(/-\s*Scope Reason:/i, '').trim();
    });
    return proc;
  }).filter(p => p !== null);
};

// ─── Lightweight structured parser used only for PDF export ───
const parseProtocolTextForPdf = (text) => {
  const out = { primaryGoals: [], medications: [], investigations: [], lifestyleModifications: [], followUpPlan: { nextVisit: '', monitoringParameters: [] } };
  if (!text) return out;

  const LABELS = ['TREATMENT INTENT', 'PRIMARY GOALS', 'FIRST-LINE MEDICATIONS', 'ADJUNCTIVE MEDICATIONS', 'MEDICATIONS', 'RECOMMENDED PROCEDURES', 'REQUIRED INVESTIGATIONS', 'INVESTIGATIONS', 'LIFESTYLE MODIFICATIONS', 'FOLLOW-UP PLAN'];
  const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const grab = (label) => {
    const boundary = LABELS.filter(l => l !== label).map(esc).join('|');
    const re = new RegExp(`${esc(label)}\\s*([^]*?)(?=${boundary}|$)`, 'i');
    const m = text.match(re);
    return m ? m[1] : '';
  };

  const goalsText = grab('PRIMARY GOALS');
  if (goalsText) out.primaryGoals = goalsText.split('•').map(s => s.trim()).filter(Boolean);

  const parseDrugBlock = (blockText) => {
    if (!blockText) return [];
    return blockText.split('•').filter(s => s.trim()).map(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const med = { name: lines[0], dose: '', frequency: '', indication: '', guideline: '' };
      lines.forEach(line => {
        const ll = line.toLowerCase();
        if (ll.includes('dose:')) med.dose = line.replace(/-\s*Dose:/i, '').trim();
        else if (ll.includes('frequency:')) med.frequency = line.replace(/-\s*Frequency:/i, '').trim();
        else if (ll.includes('indication:')) med.indication = line.replace(/-\s*Indication:/i, '').trim();
        else if (ll.includes('guideline:')) med.guideline = line.replace(/-\s*Guideline:/i, '').trim();
      });
      return med;
    }).filter(Boolean);
  };
  out.medications = [...parseDrugBlock(grab('FIRST-LINE MEDICATIONS')), ...parseDrugBlock(grab('ADJUNCTIVE MEDICATIONS')), ...parseDrugBlock(grab('MEDICATIONS'))];

  const invText = grab('REQUIRED INVESTIGATIONS') || grab('INVESTIGATIONS');
  if (invText) {
    out.investigations = invText.split('•').filter(s => s.trim()).map(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const inv = { name: lines[0], indication: '', urgency: '', timing: '' };
      lines.forEach(line => {
        const ll = line.toLowerCase();
        if (ll.includes('indication:')) inv.indication = line.replace(/-\s*Indication:/i, '').trim();
        else if (ll.includes('urgency:')) inv.urgency = line.replace(/-\s*Urgency:/i, '').trim();
        else if (ll.includes('timing:')) inv.timing = line.replace(/-\s*Timing:/i, '').trim();
      });
      return inv;
    }).filter(Boolean);
  }

  const lifestyleText = grab('LIFESTYLE MODIFICATIONS');
  if (lifestyleText) {
    out.lifestyleModifications = lifestyleText.split('•').filter(s => s.trim()).map(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const mod = { recommendation: lines[0], evidence: '', difficulty: '' };
      lines.forEach(line => {
        const ll = line.toLowerCase();
        if (ll.includes('evidence:')) mod.evidence = line.replace(/-\s*Evidence:/i, '').trim();
        else if (ll.includes('difficulty:')) mod.difficulty = line.replace(/-\s*Difficulty:/i, '').trim();
      });
      return mod;
    }).filter(Boolean);
  }

  const followupText = grab('FOLLOW-UP PLAN');
  if (followupText) {
    followupText.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      const ll = line.toLowerCase();
      if (ll.includes('next visit:')) out.followUpPlan.nextVisit = line.replace(/[•\-]\s*Next Visit:/i, '').trim();
      else if (ll.startsWith('•') || ll.startsWith('-')) out.followUpPlan.monitoringParameters.push(line.replace(/^[•\-]\s*/, '').trim());
    });
  }

  return out;
};

// Builds one unified data shape for PDF export, regardless of whether the
// treatment plan is stored in 'protocol' (free text) or 'sections' format.
const buildUnifiedPlanData = (treatmentData) => {
  const result = {
    diagnosis: '', primaryGoals: [], medications: [], procedures: [], investigations: [],
    lifestyleModifications: [], followUpPlan: {}, evaluation: null, intentAlignment: null
  };
  if (!treatmentData) return result;

  result.evaluation = treatmentData?.evaluation || treatmentData?.clinical_evaluation || null;
  result.intentAlignment = treatmentData?.intent_alignment || null;

  const hasSections = treatmentData?.sections && Object.keys(treatmentData.sections).length > 0;

  if (hasSections) {
    const s = treatmentData.sections;
    result.diagnosis = s.diagnosis?.doctor_content || '';
    const allText = Object.values(s).map(sec => sec?.doctor_content).filter(Boolean).join('\n\n');
    const parsed = parseProtocolTextForPdf(allText);
    result.primaryGoals = parsed.primaryGoals;
    result.medications = parsed.medications.length ? parsed.medications : (s.pharmacological_plan?.doctor_content ? [{ name: s.pharmacological_plan.doctor_content }] : []);
    result.investigations = parsed.investigations.length ? parsed.investigations : (s.investigations?.doctor_content ? [{ name: s.investigations.doctor_content }] : []);
    result.procedures = extractAndParseProcedures(allText);
    result.lifestyleModifications = parsed.lifestyleModifications.length ? parsed.lifestyleModifications : (s.procedural_plan?.doctor_content ? [{ recommendation: s.procedural_plan.doctor_content }] : []);
    result.followUpPlan = (parsed.followUpPlan.nextVisit || parsed.followUpPlan.monitoringParameters.length) ? parsed.followUpPlan : (s.monitoring_follow_up?.doctor_content ? { nextVisit: s.monitoring_follow_up.doctor_content, monitoringParameters: [] } : {});
  } else {
    const protocolContent = treatmentData?.processed_treatment_plan?.doctor_content || '';
    const parsed = parseProtocolTextForPdf(protocolContent);
    result.primaryGoals = parsed.primaryGoals;
    result.medications = parsed.medications;
    result.procedures = extractAndParseProcedures(protocolContent);
    result.investigations = parsed.investigations;
    result.lifestyleModifications = parsed.lifestyleModifications;
    result.followUpPlan = parsed.followUpPlan;
  }
  return result;
};

// ─── Generates a hospital-style, black & white, table-driven PDF ───
const generateTreatmentPlanPDF = ({ treatmentData, patientId, doctorId, planStatus, version, selectedIntent }) => {
  const data = buildUnifiedPlanData(treatmentData);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const BLACK = [0, 0, 0], DARK = [68, 68, 68], MUTED = [136, 136, 136], LIGHT = [245, 245, 245], LINE = [224, 224, 224];

  const checkPageBreak = (needed) => {
    if (y + needed > pageHeight - 60) { doc.addPage(); y = margin; }
  };

  const sectionHeader = (title) => {
    checkPageBreak(30);
    doc.setFillColor(...BLACK);
    doc.rect(margin, y, 3, 14, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BLACK);
    doc.text(title.toUpperCase(), margin + 10, y + 11);
    y += 22;
  };

  const tableStyles = {
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, textColor: BLACK, lineColor: LINE, lineWidth: 0.5, cellPadding: 5, valign: 'top' },
    headStyles: { fillColor: BLACK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: LIGHT },
    margin: { left: margin, right: margin },
  };

  // ── Masthead ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...BLACK);
  doc.text('TREATMENT PLAN', margin, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text('CLINICAL PROTOCOL DOCUMENT', margin, y + 20);
  doc.setDrawColor(...BLACK); doc.setLineWidth(1.2);
  doc.line(margin, y + 32, pageWidth - margin, y + 32);
  y += 46;

  // ── Meta info box ──
  const metaRows = [
    ['Patient ID', patientId || '—', 'Doctor ID', doctorId || '—'],
    ['Status', (planStatus || 'draft').toUpperCase(), 'Version', `v${version || 1}`],
    ['Treatment Intent', (selectedIntent && selectedIntent !== 'no_intent') ? String(selectedIntent).toUpperCase() : '—', 'Generated', new Date().toLocaleString()],
  ];
  const rowH = 20, boxTop = y, boxH = rowH * metaRows.length, half = contentWidth / 2;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.75);
  doc.rect(margin, boxTop, contentWidth, boxH);
  metaRows.forEach((row, i) => {
    const ry = boxTop + i * rowH;
    if (i > 0) doc.line(margin, ry, pageWidth - margin, ry);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(row[0].toUpperCase(), margin + 10, ry + 13);
    doc.text(row[2].toUpperCase(), margin + half + 10, ry + 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...BLACK);
    doc.text(String(row[1]), margin + 105, ry + 13);
    doc.text(String(row[3]), margin + half + 105, ry + 13);
  });
  y = boxTop + boxH + 24;

  // ── Diagnosis ──
  if (data.diagnosis?.trim()) {
    sectionHeader('Diagnosis');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...DARK);
    const lines = doc.splitTextToSize(data.diagnosis, contentWidth - 12);
    checkPageBreak(lines.length * 12 + 10);
    doc.text(lines, margin + 12, y);
    y += lines.length * 12 + 16;
  }

  // ── Intent misalignment alert ──
  if (data.intentAlignment?.misalignment_flag?.trim()) {
    sectionHeader('Intent Misalignment Alert');
    const lines = doc.splitTextToSize(data.intentAlignment.misalignment_flag, contentWidth - 20);
    const boxH2 = lines.length * 12 + 16;
    checkPageBreak(boxH2 + 10);
    doc.setDrawColor(...BLACK); doc.setLineWidth(1);
    doc.rect(margin, y, contentWidth, boxH2);
    doc.setFillColor(...BLACK); doc.rect(margin, y, 3, boxH2, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...BLACK);
    doc.text(lines, margin + 14, y + 14);
    y += boxH2 + 16;
  }

  // ── Primary goals ──
  if (data.primaryGoals?.length) {
    sectionHeader('Primary Goals');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    data.primaryGoals.forEach((goal) => {
      const lines = doc.splitTextToSize(`•  ${goal}`, contentWidth - 12);
      checkPageBreak(lines.length * 12 + 4);
      doc.setTextColor(...DARK);
      doc.text(lines, margin + 12, y);
      y += lines.length * 12 + 4;
    });
    y += 10;
  }

  // ── Medications ──
  if (data.medications?.length) {
    checkPageBreak(60);
    sectionHeader('Medications');
    autoTable(doc, {
      startY: y,
      head: [['Medication', 'Dose', 'Frequency', 'Indication']],
      body: data.medications.map(m => [m.name || '—', m.dose || '—', m.frequency || '—', m.indication || m.guideline || '—']),
      ...tableStyles,
    });
    y = doc.lastAutoTable.finalY + 20;
  }

  // ── Investigations ──
  if (data.investigations?.length) {
    checkPageBreak(60);
    sectionHeader('Investigations');
    autoTable(doc, {
      startY: y,
      head: [['Investigation', 'Urgency', 'Indication', 'Timing']],
      body: data.investigations.map(iv => [iv.name || '—', (iv.urgency || 'routine').toUpperCase(), iv.indication || '—', iv.timing || '—']),
      ...tableStyles,
    });
    y = doc.lastAutoTable.finalY + 20;
  }

  // ── Procedures (detailed blocks) ──
  if (data.procedures?.length) {
    checkPageBreak(60);
    sectionHeader('Recommended Procedures');
    data.procedures.forEach((proc, idx) => {
      const detailLines = [];
      if (proc.indication) detailLines.push(`Indication: ${proc.indication}`);
      if (proc.timing) detailLines.push(`Timing: ${proc.timing}`);
      if (proc.reasonNeeded) detailLines.push(`Why Needed: ${proc.reasonNeeded}`);
      if (proc.guideline) detailLines.push(`Guideline: ${proc.guideline}`);
      if (proc.duration) detailLines.push(`Duration: ${proc.duration}`);
      if (proc.anesthesia) detailLines.push(`Anesthesia: ${proc.anesthesia}`);
      if (proc.hospitalStay) detailLines.push(`Hospital Stay: ${proc.hospitalStay}`);
      if (proc.recoveryTime) detailLines.push(`Recovery: ${proc.recoveryTime}`);
      (proc.steps || []).forEach(s => detailLines.push(`Step: ${s}`));
      (proc.prerequisites || []).forEach(s => detailLines.push(`Prerequisite: ${s}`));
      (proc.contraindications || []).forEach(s => detailLines.push(`Contraindication: ${s}`));
      (proc.complications || []).forEach(s => detailLines.push(`Possible Complication: ${s}`));
      (proc.postCare || []).forEach(s => detailLines.push(`Post-Care: ${s}`));

      const wrapped = detailLines.flatMap(l => doc.splitTextToSize(l, contentWidth - 20));
      const blockH = 22 + wrapped.length * 11 + 10;
      checkPageBreak(blockH);

      doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
      doc.rect(margin, y, contentWidth, blockH);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...BLACK);
      doc.text(`${idx + 1}. ${proc.name || 'Procedure'}`, margin + 10, y + 15);
      if (proc.scopeCompliant) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED);
        doc.text(/yes/i.test(proc.scopeCompliant) ? 'IN-SCOPE' : 'OUT-OF-SCOPE', pageWidth - margin - 70, y + 15);
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...DARK);
      doc.text(wrapped, margin + 10, y + 30);
      y += blockH + 12;
    });
  }

  // ── Lifestyle modifications ──
  if (data.lifestyleModifications?.length) {
    checkPageBreak(60);
    sectionHeader('Lifestyle Modifications');
    autoTable(doc, {
      startY: y,
      head: [['Recommendation', 'Evidence', 'Difficulty']],
      body: data.lifestyleModifications.map(m => [m.recommendation || '—', m.evidence || '—', m.difficulty || '—']),
      ...tableStyles,
    });
    y = doc.lastAutoTable.finalY + 20;
  }

  // ── Follow-up plan ──
  if (data.followUpPlan?.nextVisit || data.followUpPlan?.monitoringParameters?.length) {
    checkPageBreak(60);
    sectionHeader('Follow-up Plan');
    if (data.followUpPlan.nextVisit) {
      doc.setFillColor(...BLACK); doc.rect(margin, y, 140, 20, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
      doc.text('NEXT VISIT', margin + 8, y + 13);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...BLACK);
      doc.text(String(data.followUpPlan.nextVisit), margin + 150, y + 13);
      y += 30;
    }
    if (data.followUpPlan.monitoringParameters?.length) {
      autoTable(doc, {
        startY: y,
        head: [['Monitoring Parameters']],
        body: data.followUpPlan.monitoringParameters.map(p => [p]),
        ...tableStyles,
      });
      y = doc.lastAutoTable.finalY + 20;
    }
  }

  // ── Clinical evaluation ──
  if (data.evaluation && Object.values(data.evaluation).some(v => v && String(v).trim())) {
    checkPageBreak(60);
    sectionHeader('Clinical Evaluation');
    const rows = [
      ['Standard of Care', data.evaluation.standard_of_care_alignment || data.evaluation.appropriateness || ''],
      ['Feasibility', data.evaluation.practical_feasibility || data.evaluation.safety || ''],
      ['Sustainability', data.evaluation.doability_and_sustainability || data.evaluation.completeness || ''],
    ].filter(r => r[1] && r[1].trim());
    if (rows.length) {
      autoTable(doc, { startY: y, head: [['Aspect', 'Assessment']], body: rows, ...tableStyles });
      y = doc.lastAutoTable.finalY + 20;
    }
  }

  // ── Footer (page numbers on every page) ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(margin, pageHeight - 40, pageWidth - margin, pageHeight - 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text('Computer-generated clinical document. For internal medical use only.', margin, pageHeight - 26);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 60, pageHeight - 26);
  }

  return doc;
};

// Read-only Treatment Protocol Section Component
const ReadOnlyTreatmentProtocolSection = ({ protocolData, styles }) => {
  if (!protocolData || typeof protocolData !== 'string') return null;

  const parseProtocolSection = (text) => {
    try {
      const sections = { primaryGoals: [], medications: [], procedures: [], investigations: [], lifestyleModifications: [], followUpPlan: {} };
      if (!text) return sections;

      // All real section headers used by the dictation formatter, in the order they appear.
      const LABELS = ['TREATMENT INTENT', 'PRIMARY GOALS', 'FIRST-LINE MEDICATIONS', 'ADJUNCTIVE MEDICATIONS', 'RECOMMENDED PROCEDURES', 'REQUIRED INVESTIGATIONS', 'LIFESTYLE MODIFICATIONS', 'FOLLOW-UP PLAN'];
      const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

      const grab = (label) => {
        const boundary = LABELS.filter(l => l !== label).map(esc).join('|');
        const re = new RegExp(`${esc(label)}\\s*([^]*?)(?=${boundary}|$)`, 'i');
        const m = text.match(re);
        return m ? m[1] : '';
      };

      const goalsText = grab('PRIMARY GOALS');
      if (goalsText) {
        sections.primaryGoals = goalsText.split('•').map(item => item.trim()).filter(item => item.length > 0);
      }

      const parseDrugBlock = (blockText) => {
        if (!blockText) return [];
        return blockText.split('•').filter(item => item.trim()).map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (!lines.length) return null;
          const med = { name: lines[0], dose: '', frequency: '', indication: '', guideline: '', patientSpecific: '' };
          lines.forEach(line => {
            const ll = line.toLowerCase();
            if (ll.includes('dose:')) med.dose = line.replace(/-\s*Dose:/i, '').trim();
            else if (ll.includes('frequency:')) med.frequency = line.replace(/-\s*Frequency:/i, '').trim();
            else if (ll.includes('indication:')) med.indication = line.replace(/-\s*Indication:/i, '').trim();
            else if (ll.includes('guideline:')) med.guideline = line.replace(/-\s*Guideline:/i, '').trim();
            else if (ll.includes('patient specific:')) med.patientSpecific = line.replace(/-\s*Patient Specific:/i, '').trim();
          });
          return med;
        }).filter(m => m !== null);
      };
      sections.medications = [...parseDrugBlock(grab('FIRST-LINE MEDICATIONS')), ...parseDrugBlock(grab('ADJUNCTIVE MEDICATIONS'))];

      const proceduresText = grab('RECOMMENDED PROCEDURES');
      if (proceduresText) {
        sections.procedures = splitProcedureBlocks(proceduresText).map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (!lines.length) return null;
          const proc = {
            name: lines[0], indication: '', timing: '', reasonNeeded: '', guideline: '', patientSpecific: '',
            supportingTrial: '', cardiacRisk: '', duration: '', anesthesia: '', hospitalStay: '', recoveryTime: '',
            expectedBenefit: '', expectedOutcome: '', alternative: '', comments: '', scopeCompliant: '', scopeReason: '',
            steps: [], prerequisites: [], contraindications: [], complications: [], postCare: []
          };
          lines.forEach(line => {
            const ll = line.toLowerCase();
            if (ll.startsWith('· step:')) proc.steps.push(line.replace(/·\s*Step:/i, '').trim());
            else if (ll.startsWith('· prerequisite:')) proc.prerequisites.push(line.replace(/·\s*Prerequisite:/i, '').trim());
            else if (ll.startsWith('· contraindication:')) proc.contraindications.push(line.replace(/·\s*Contraindication:/i, '').trim());
            else if (ll.startsWith('· possible complication:')) proc.complications.push(line.replace(/·\s*Possible Complication:/i, '').trim());
            else if (ll.startsWith('· post-procedure care:')) proc.postCare.push(line.replace(/·\s*Post-Procedure Care:/i, '').trim());
            else if (ll.includes('- indication:')) proc.indication = line.replace(/-\s*Indication:/i, '').trim();
            else if (ll.includes('- timing:')) proc.timing = line.replace(/-\s*Timing:/i, '').trim();
            else if (ll.includes('- reason needed:')) proc.reasonNeeded = line.replace(/-\s*Reason Needed:/i, '').trim();
            else if (ll.includes('- guideline:')) proc.guideline = line.replace(/-\s*Guideline:/i, '').trim();
            else if (ll.includes('- patient specific:')) proc.patientSpecific = line.replace(/-\s*Patient Specific:/i, '').trim();
            else if (ll.includes('- supporting trial:')) proc.supportingTrial = line.replace(/-\s*Supporting Trial:/i, '').trim();
            else if (ll.includes('- cardiac risk:')) proc.cardiacRisk = line.replace(/-\s*Cardiac Risk:/i, '').trim();
            else if (ll.includes('- estimated duration:')) proc.duration = line.replace(/-\s*Estimated Duration:/i, '').trim();
            else if (ll.includes('- anesthesia:')) proc.anesthesia = line.replace(/-\s*Anesthesia:/i, '').trim();
            else if (ll.includes('- hospital stay:')) proc.hospitalStay = line.replace(/-\s*Hospital Stay:/i, '').trim();
            else if (ll.includes('- recovery time:')) proc.recoveryTime = line.replace(/-\s*Recovery Time:/i, '').trim();
            else if (ll.includes('- expected benefit:')) proc.expectedBenefit = line.replace(/-\s*Expected Benefit:/i, '').trim();
            else if (ll.includes('- expected outcome:')) proc.expectedOutcome = line.replace(/-\s*Expected Outcome:/i, '').trim();
            else if (ll.includes('- alternative:')) proc.alternative = line.replace(/-\s*Alternative:/i, '').trim();
            else if (ll.includes('- comments:')) proc.comments = line.replace(/-\s*Comments:/i, '').trim();
            else if (ll.includes('- specialty scope compliant:')) proc.scopeCompliant = line.replace(/-\s*Specialty Scope Compliant:/i, '').trim();
            else if (ll.includes('- scope reason:')) proc.scopeReason = line.replace(/-\s*Scope Reason:/i, '').trim();
          });
          return proc;
        }).filter(p => p !== null);
      }

      const investigationsText = grab('REQUIRED INVESTIGATIONS');
      if (investigationsText) {
        sections.investigations = investigationsText.split('•').filter(item => item.trim()).map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (!lines.length) return null;
          const inv = { name: lines[0], indication: '', urgency: '', timing: '', guideline: '', patientSpecific: '' };
          lines.forEach(line => {
            const ll = line.toLowerCase();
            if (ll.includes('indication:')) inv.indication = line.replace(/-\s*Indication:/i, '').trim();
            else if (ll.includes('urgency:')) inv.urgency = line.replace(/-\s*Urgency:/i, '').trim();
            else if (ll.includes('timing:')) inv.timing = line.replace(/-\s*Timing:/i, '').trim();
            else if (ll.includes('guideline:')) inv.guideline = line.replace(/-\s*Guideline:/i, '').trim();
            else if (ll.includes('patient specific:')) inv.patientSpecific = line.replace(/-\s*Patient Specific:/i, '').trim();
          });
          return inv;
        }).filter(i => i !== null);
      }

      const lifestyleText = grab('LIFESTYLE MODIFICATIONS');
      if (lifestyleText) {
        sections.lifestyleModifications = lifestyleText.split('•').filter(item => item.trim()).map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (!lines.length) return null;
          const mod = { recommendation: lines[0], evidence: '', difficulty: '', duration: '', guideline: '', patientSpecific: '' };
          lines.forEach(line => {
            const ll = line.toLowerCase();
            if (ll.includes('evidence:')) mod.evidence = line.replace(/-\s*Evidence:/i, '').trim();
            else if (ll.includes('difficulty:')) mod.difficulty = line.replace(/-\s*Difficulty:/i, '').trim();
            else if (ll.includes('duration:')) mod.duration = line.replace(/-\s*Duration:/i, '').trim();
            else if (ll.includes('guideline:')) mod.guideline = line.replace(/-\s*Guideline:/i, '').trim();
            else if (ll.includes('patient specific:')) mod.patientSpecific = line.replace(/-\s*Patient Specific:/i, '').trim();
          });
          return mod;
        }).filter(m => m !== null);
      }

      const followupText = grab('FOLLOW-UP PLAN');
      if (followupText) {
        const lines = followupText.split('\n').map(l => l.trim()).filter(l => l);
        sections.followUpPlan = { nextVisit: '', frequency: '', duration: '', guideline: '', monitoringParameters: [] };
        lines.forEach(line => {
          const ll = line.toLowerCase();
          if (ll.startsWith('•') && ll.includes('next visit:')) sections.followUpPlan.nextVisit = line.replace(/[•\-]\s*Next Visit:/i, '').trim();
          else if (ll.startsWith('•') && ll.includes('frequency:')) sections.followUpPlan.frequency = line.replace(/[•\-]\s*Frequency:/i, '').trim();
          else if (ll.startsWith('•') && ll.includes('duration:')) sections.followUpPlan.duration = line.replace(/[•\-]\s*Duration:/i, '').trim();
          else if (ll.startsWith('•') && ll.includes('guideline:')) sections.followUpPlan.guideline = line.replace(/[•\-]\s*Guideline:/i, '').trim();
          else if (ll.startsWith('•') && ll.includes('monitor:')) sections.followUpPlan.monitoringParameters.push(line.replace(/[•\-]\s*Monitor:/i, '').trim());
          else if (ll.startsWith('•') && ll.includes('success:')) sections.followUpPlan.monitoringParameters.push(`Success: ${line.replace(/[•\-]\s*Success:/i, '').trim()}`);
          else if (ll.startsWith('•') && ll.includes('escalate:')) sections.followUpPlan.monitoringParameters.push(`Escalate: ${line.replace(/[•\-]\s*Escalate:/i, '').trim()}`);
        });
      }
      return sections;
    } catch (error) {
      console.error("Error parsing protocol section:", error);
      return { primaryGoals: [], medications: [], procedures: [], investigations: [], lifestyleModifications: [], followUpPlan: {} };
    }
  };

  const parsedData = parseProtocolSection(protocolData);
  const hasPrimaryGoals = parsedData?.primaryGoals?.length > 0;
  const hasMedications = parsedData?.medications?.length > 0;
  const hasInvestigations = parsedData?.investigations?.length > 0;
  const hasProcedures = parsedData?.procedures?.length > 0;
  const hasLifestyleModifications = parsedData?.lifestyleModifications?.length > 0;
  const hasFollowUpPlan = parsedData?.followUpPlan && (parsedData.followUpPlan.nextVisit || parsedData.followUpPlan.frequency || parsedData.followUpPlan.duration || parsedData.followUpPlan.monitoringParameters?.length > 0);

  if (!hasPrimaryGoals && !hasMedications && !hasProcedures && !hasInvestigations && !hasLifestyleModifications && !hasFollowUpPlan) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" sx={{ color: theme.textMuted, fontFamily: theme.fontFamily }}>No treatment protocol data available.</Typography>
      </Box>
    );
  }

  const getUrgencyVariant = (urgency) => {
    const u = (urgency || '').toLowerCase();
    if (u === 'stat') return { bg: theme.accent, color: theme.accentFg };
    if (u === 'urgent') return { bg: theme.bgTertiary, color: theme.textSecondary };
    return { bg: theme.bgSecondary, color: theme.textMuted };
  };

  const sectionWrap = { mb: 2, border: `1px solid ${theme.border}`, backgroundColor: theme.bg };
  const sectionHead = { px: 2, py: 1.25, borderBottom: `1px solid ${theme.border}`, backgroundColor: theme.bgSecondary, display: 'flex', alignItems: 'center', gap: 1.5 };
  const dataRow = { display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.5 };

  return (
    <Box>
      {hasPrimaryGoals && (
        <Box sx={sectionWrap}>
          <Box sx={sectionHead}>
            <Box sx={styles.sectionIconBox}><AssessmentRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Primary Goals</Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            {parsedData.primaryGoals.map((goal, index) => (
              <Box key={index} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1 }}>
                <Box sx={{ width: 6, height: 6, backgroundColor: theme.accent, mt: 0.75, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ color: theme.textSecondary, fontSize: '0.83rem', lineHeight: 1.6 }}>{goal}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {hasMedications && (
        <Box sx={sectionWrap}>
          <Box sx={sectionHead}>
            <Box sx={styles.sectionIconBox}><MedicationRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Medications</Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {parsedData.medications.map((med, index) => (
                <Grid item xs={12} key={index}>
                  <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5, transition: 'border-color 0.15s', '&:hover': { borderColor: theme.borderStrong } }}>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary, mb: 0.75, fontFamily: theme.fontFamily }}>{med?.name || `Medication ${index + 1}`}</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
                      {med?.dose && <Box sx={{ px: 1, py: 0.25, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textSecondary, fontFamily: theme.fontFamily }}>Dose: {med.dose}</Box>}
                      {med?.frequency && <Box sx={{ px: 1, py: 0.25, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textSecondary, fontFamily: theme.fontFamily }}>Freq: {med.frequency}</Box>}
                    </Box>
                    {med?.indication && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Indication</Typography><Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{med.indication}</Typography></Box>}
                    {med?.guideline && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Guideline</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{med.guideline}</Typography></Box>}
                    {med?.patientSpecific && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Patient</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{med.patientSpecific}</Typography></Box>}
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      )}

      {hasProcedures && (
        <Box sx={sectionWrap}>
          <Box sx={sectionHead}>
            <Box sx={styles.sectionIconBox}><AssignmentRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Recommended Procedures</Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {parsedData.procedures.map((proc, index) => (
                <Grid item xs={12} key={index}>
                  <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5, transition: 'border-color 0.15s', '&:hover': { borderColor: theme.borderStrong } }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75 }}>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary, fontFamily: theme.fontFamily }}>{proc?.name || `Procedure ${index + 1}`}</Typography>
                      {proc?.timing && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.65rem', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{proc.timing}</Box>}
                    </Box>
                    {proc?.indication && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Indication</Typography><Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{proc.indication}</Typography></Box>}
                    {proc?.reasonNeeded && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Why Needed</Typography><Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{proc.reasonNeeded}</Typography></Box>}
                    {proc?.guideline && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Guideline</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{proc.guideline}</Typography></Box>}
                    {proc?.patientSpecific && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Patient</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{proc.patientSpecific}</Typography></Box>}
                    {proc?.supportingTrial && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Trial</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{proc.supportingTrial}</Typography></Box>}

                    {proc?.steps?.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Procedure Steps</Typography>
                        {proc.steps.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                      </Box>
                    )}
                    {proc?.prerequisites?.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Prerequisites</Typography>
                        {proc.prerequisites.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                      </Box>
                    )}
                    {proc?.contraindications?.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Contraindications</Typography>
                        {proc.contraindications.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                      </Box>
                    )}
                    {proc?.complications?.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Expected Complications</Typography>
                        {proc.complications.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                      </Box>
                    )}
                    {proc?.postCare?.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Post-Procedure Care</Typography>
                        {proc.postCare.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                      </Box>
                    )}

                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                      {proc?.cardiacRisk && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Cardiac risk: {proc.cardiacRisk}</Box>}
                      {proc?.duration && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Duration: {proc.duration}</Box>}
                      {proc?.anesthesia && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Anesthesia: {proc.anesthesia}</Box>}
                      {proc?.hospitalStay && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Stay: {proc.hospitalStay}</Box>}
                      {proc?.recoveryTime && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Recovery: {proc.recoveryTime}</Box>}
                    </Box>
                    {proc?.scopeCompliant && (
                      <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.borderStrong}`, backgroundColor: /yes/i.test(proc.scopeCompliant) ? theme.accent : 'transparent', color: /yes/i.test(proc.scopeCompliant) ? theme.accentFg : theme.textMuted, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {/yes/i.test(proc.scopeCompliant) ? 'In-scope' : 'Out-of-scope'}
                        </Box>
                      </Box>
                    )}
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      )}

      {hasInvestigations && (
        <Box sx={sectionWrap}>
          <Box sx={sectionHead}>
            <Box sx={styles.sectionIconBox}><ScienceRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Investigations</Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {parsedData.investigations.map((inv, index) => (
                <Grid item xs={12} key={index}>
                  <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5, transition: 'border-color 0.15s', '&:hover': { borderColor: theme.borderStrong } }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75 }}>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary, fontFamily: theme.fontFamily }}>{inv?.name || `Investigation ${index + 1}`}</Typography>
                      {inv?.urgency && (
                        <Box sx={{ px: 1, py: 0.2, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', ...getUrgencyVariant(inv.urgency), border: `1px solid ${theme.border}` }}>
                          {inv.urgency}
                        </Box>
                      )}
                    </Box>
                    {inv?.indication && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Indication</Typography><Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{inv.indication}</Typography></Box>}
                    {inv?.timing && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Timing</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{inv.timing}</Typography></Box>}
                    {inv?.guideline && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Guideline</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{inv.guideline}</Typography></Box>}
                    {inv?.patientSpecific && <Box sx={dataRow}><Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 70 }}>Patient</Typography><Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary }}>{inv.patientSpecific}</Typography></Box>}
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      )}

      {hasLifestyleModifications && (
        <Box sx={sectionWrap}>
          <Box sx={sectionHead}>
            <Box sx={styles.sectionIconBox}><InfoRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Lifestyle Modifications</Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {parsedData.lifestyleModifications.map((mod, index) => (
                <Grid item xs={12} key={index}>
                  <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5, transition: 'border-color 0.15s', '&:hover': { borderColor: theme.borderStrong } }}>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary, mb: 0.75, fontFamily: theme.fontFamily }}>{mod?.recommendation || `Modification ${index + 1}`}</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 0.5 }}>
                      {mod?.evidence && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Evidence: {mod.evidence}</Box>}
                      {mod?.difficulty && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Difficulty: {mod.difficulty}</Box>}
                      {mod?.duration && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Duration: {mod.duration}</Box>}
                    </Box>
                    {mod?.guideline && <Typography sx={{ fontSize: '0.75rem', color: theme.textMuted }}><strong>Guideline:</strong> {mod.guideline}</Typography>}
                    {mod?.patientSpecific && <Typography sx={{ fontSize: '0.75rem', color: theme.textMuted, mt: 0.25 }}><strong>Patient Specific:</strong> {mod.patientSpecific}</Typography>}
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      )}

      {hasFollowUpPlan && (
        <Box sx={sectionWrap}>
          <Box sx={sectionHead}>
            <Box sx={styles.sectionIconBox}><TimelineRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Follow-up Plan</Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            <Grid container spacing={1.5}>
              {parsedData.followUpPlan?.nextVisit && (
                <Grid item xs={12} md={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600 }}>Next Visit</Typography>
                    <Box sx={{ px: 1.25, py: 0.35, backgroundColor: theme.accent, color: theme.accentFg, fontSize: '0.75rem', fontFamily: theme.fontFamily }}>{parsedData.followUpPlan.nextVisit}</Box>
                  </Box>
                </Grid>
              )}
              {parsedData.followUpPlan?.frequency && (
                <Grid item xs={12} md={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600 }}>Frequency</Typography>
                    <Box sx={{ px: 1.25, py: 0.35, border: `1px solid ${theme.border}`, fontSize: '0.75rem', color: theme.textSecondary }}>{parsedData.followUpPlan.frequency}</Box>
                  </Box>
                </Grid>
              )}
              {parsedData.followUpPlan?.duration && (
                <Grid item xs={12} md={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600 }}>Duration</Typography>
                    <Box sx={{ px: 1.25, py: 0.35, border: `1px solid ${theme.border}`, fontSize: '0.75rem', color: theme.textSecondary }}>{parsedData.followUpPlan.duration}</Box>
                  </Box>
                </Grid>
              )}
              {parsedData.followUpPlan?.guideline && (
                <Grid item xs={12}>
                  <Typography sx={{ fontSize: '0.75rem', color: theme.textMuted }}><strong>Guideline:</strong> {parsedData.followUpPlan.guideline}</Typography>
                </Grid>
              )}
            </Grid>
            {parsedData.followUpPlan?.monitoringParameters?.length > 0 && (
              <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${theme.border}` }}>
                <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, mb: 1, fontWeight: 600 }}>Monitoring Parameters</Typography>
                {parsedData.followUpPlan.monitoringParameters.map((param, index) => (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.6, py: 0.5, px: 1, border: `1px solid ${theme.border}`, backgroundColor: theme.bgSecondary }}>
                    <Box sx={{ width: 4, height: 4, backgroundColor: theme.accent, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{param}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

// Data Display Component
const TreatmentPlanData = ({
  treatmentData,
  onContinueClick,
  onEditClick,
  onDeleteClick,
  onSaveClick,
  onCancelEdit,
  expandedSections,
  toggleSection,
  isEditMode = false,
  editableSectionData,
  onFieldChange,
  showAiSuggestions,
  setShowAiSuggestions,
  saveCheckboxes,
  handleSaveToggle,
  acceptedSuggestions,
  handleAcceptSuggestion,
  handleDeleteAcceptedSuggestion,
  selectedIntent,
  setSelectedIntent,
  onIntentChange,
  planStatus,
  onPreviewPdfClick,
  generatingPdf
}) => {
  const handleContinue = onContinueClick || (() => {});
  const handleEdit = onEditClick || (() => {});
  const handleDelete = onDeleteClick || (() => {});
  const handleSave = onSaveClick || (() => {});
  const handleCancelEdit = onCancelEdit || (() => {});
  const handleToggle = toggleSection || (() => {});

  const [displayFormat, setDisplayFormat] = useState(null);

  useEffect(() => {
    if (treatmentData) {
      const hasSections = treatmentData.sections && Object.keys(treatmentData.sections).length > 0;
      const hasProtocolContent = treatmentData.processed_treatment_plan?.doctor_content?.trim() !== "";
      if (hasSections) setDisplayFormat('sections');
      else if (hasProtocolContent) setDisplayFormat('protocol');
      else setDisplayFormat(null);
    }
  }, [treatmentData]);

  const getIntentIcon = (intent) => {
    if (intent === "no_intent") return <DoNotDisturbRounded />;
    switch(intent) {
      case 'curative': return <HealingRounded />;
      case 'palliative': return <FavoriteRounded />;
      case 'supportive': return <PsychologyRounded />;
      case 'diagnostic': return <BiotechRounded />;
      default: return <LocalHospitalRounded />;
    }
  };

  const handleIntentChange = (event, newIntent) => {
    if (newIntent !== null && onIntentChange) onIntentChange(newIntent);
  };

  const getSectionIcon = (section) => {
    switch(section) {
      case 'diagnosis': return <LocalHospitalRounded sx={{ fontSize: '0.8rem' }} />;
      case 'pharmacological_plan':
      case 'pharmacological': return <MedicationRounded sx={{ fontSize: '0.8rem' }} />;
      case 'investigations': return <ScienceRounded sx={{ fontSize: '0.8rem' }} />;
      case 'procedural_plan': return <AssignmentRounded sx={{ fontSize: '0.8rem' }} />;
      case 'monitoring_follow_up':
      case 'monitoring': return <TimelineRounded sx={{ fontSize: '0.8rem' }} />;
      case 'comorbidity_management': return <LocalHospitalRounded sx={{ fontSize: '0.8rem' }} />;
      case 'psychosocial_support': return <PsychologyRounded sx={{ fontSize: '0.8rem' }} />;
      case 'long_term_care': return <TimelineRounded sx={{ fontSize: '0.8rem' }} />;
      case 'patient_education': return <InfoRounded sx={{ fontSize: '0.8rem' }} />;
      default: return <InfoRounded sx={{ fontSize: '0.8rem' }} />;
    }
  };

  const getSectionTitle = (sectionKey) => {
    const titles = {
      'diagnosis': 'Diagnosis Details',
      'pharmacological_plan': 'Pharmacological Plan',
      'pharmacological': 'Pharmacological Plan',
      'investigations': 'Investigations',
      'procedural_plan': 'Procedural Plan',
      'monitoring_follow_up': 'Monitoring & Follow-up',
      'monitoring': 'Monitoring & Follow-up',
      'comorbidity_management': 'Comorbidity Management',
      'psychosocial_support': 'Psychosocial Support',
      'long_term_care': 'Long-term Care',
      'patient_education': 'Patient Education'
    };
    return titles[sectionKey] || sectionKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const extractProtocolContent = (data) => {
    try {
      if (!data) return null;
      if (data?.sections && Object.keys(data.sections).length > 0) return null;
      if (data?.processed_treatment_plan?.doctor_content) return data.processed_treatment_plan.doctor_content;
      if (data?.sections) {
        for (const key of Object.keys(data.sections)) {
          if (data.sections[key]?.doctor_content) return data.sections[key].doctor_content;
        }
      }
      if (typeof data === 'string') return data;
      return null;
    } catch (error) {
      console.error("Error extracting protocol:", error);
      return null;
    }
  };

  const protocolContent = extractProtocolContent(treatmentData);
  const hasMisalignments = treatmentData?.intent_alignment?.misalignment_flag && treatmentData.intent_alignment.misalignment_flag.trim() !== "";

  // Gather every piece of raw dictated/generated text, regardless of whether the data
  // arrived in 'protocol' or 'sections' format, and pull out any Recommended Procedures block.
  const allDoctorText = [
    treatmentData?.processed_treatment_plan?.doctor_content,
    ...(treatmentData?.sections ? Object.values(treatmentData.sections).map(s => s?.doctor_content) : [])
  ].filter(Boolean).join('\n\n');
  const proceduresList = extractAndParseProcedures(allDoctorText);

  const renderStructuredSection = (sectionKey, sectionData) => {
    if (!sectionData?.structured_data) return null;
    const structured = sectionData.structured_data;
    switch(sectionKey) {
      case 'medications':
        return (
          <Grid container spacing={1.5}>
            {structured.map((med, index) => (
              <Grid item xs={12} key={index}>
                <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary, mb: 0.75 }}>{med.name}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 0.75 }}>
                    {med.dose && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Dose: {med.dose}</Box>}
                    {med.frequency && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Freq: {med.frequency}</Box>}
                  </Box>
                  {med.indication && <Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}><strong>Indication:</strong> {med.indication}</Typography>}
                </Box>
              </Grid>
            ))}
          </Grid>
        );
      case 'investigations':
        return (
          <Grid container spacing={1.5}>
            {structured.map((inv, index) => (
              <Grid item xs={12} key={index}>
                <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary }}>{inv.name}</Typography>
                    {inv.urgency && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.65rem', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{inv.urgency}</Box>}
                  </Box>
                  {inv.indication && <Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{inv.indication}</Typography>}
                </Box>
              </Grid>
            ))}
          </Grid>
        );
      case 'lifestyleModifications':
        return (
          <Grid container spacing={1.5}>
            {structured.map((mod, index) => (
              <Grid item xs={12} key={index}>
                <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary, mb: 0.5 }}>{mod.recommendation}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {mod.evidence && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Evidence: {mod.evidence}</Box>}
                    {mod.difficulty && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Difficulty: {mod.difficulty}</Box>}
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>
        );
      case 'followUpPlan':
        return (
          <Box>
            {structured.nextVisit && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
                <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600 }}>Next Visit</Typography>
                <Box sx={{ px: 1.25, py: 0.35, backgroundColor: theme.accent, color: theme.accentFg, fontSize: '0.75rem' }}>{structured.nextVisit}</Box>
              </Box>
            )}
            {structured.monitoringParameters?.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, mb: 0.75, fontWeight: 600 }}>Monitoring Parameters</Typography>
                {structured.monitoringParameters.map((param, index) => (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5, py: 0.5, px: 1, border: `1px solid ${theme.border}`, backgroundColor: theme.bgSecondary }}>
                    <Box sx={{ width: 4, height: 4, backgroundColor: theme.accent, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{param}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      case 'primaryGoals':
        return (
          <Box>
            {structured.map((goal, index) => (
              <Box key={index} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 0.75 }}>
                <Box sx={{ width: 6, height: 6, backgroundColor: theme.accent, mt: 0.75, flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.83rem', color: theme.textSecondary }}>{goal}</Typography>
              </Box>
            ))}
          </Box>
        );
      default:
        return null;
    }
  };

  const renderMisalignmentSection = () => {
    if (!hasMisalignments) return null;
    return (
      <Box sx={styles.misalignmentCard}>
        <Box sx={styles.misalignmentHeader}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
            <Box sx={{ ...styles.sectionIconBox, backgroundColor: theme.accent, color: theme.accentFg }}><GppBadRounded sx={{ fontSize: '0.8rem' }} /></Box>
            <Typography sx={styles.sectionLabelText}>Intent Misalignment Detected</Typography>
            <Box sx={{ ml: 1, px: 1, py: 0.2, backgroundColor: theme.accent, color: theme.accentFg, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: theme.fontFamily }}>
              {treatmentData.intent_alignment.intent}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <MinimalToggle checked={saveCheckboxes?.misalignment || false} onChange={(checked) => handleSaveToggle('misalignment', checked)} label={saveCheckboxes?.misalignment ? 'Added' : 'Add'} />
            <Tooltip title={expandedSections.misalignment ? "Collapse" : "Expand"}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleToggle('misalignment'); }} sx={styles.expandBtn}>
                {expandedSections.misalignment ? <ExpandLess sx={{ fontSize: '1rem' }} /> : <ExpandMore sx={{ fontSize: '1rem' }} />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Collapse in={expandedSections.misalignment}>
          <Box sx={{ p: 2 }}>
            <Box sx={{ borderLeft: `3px solid ${theme.accent}`, pl: 2, py: 0.5 }}>
              <Typography sx={{ fontSize: '0.85rem', color: theme.textSecondary, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{treatmentData.intent_alignment.misalignment_flag}</Typography>
              {treatmentData.intent_alignment.notes && (
                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: `1px dashed ${theme.border}` }}>
                  <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, mb: 0.5, fontWeight: 600 }}>Clinical Notes</Typography>
                  <Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary }}>{treatmentData.intent_alignment.notes}</Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Collapse>
      </Box>
    );
  };

  const renderSection = (sectionKey) => {
    const sectionData = treatmentData?.sections?.[sectionKey];
    const doctorContent = sectionData?.doctor_content || "";
    const structuredData = sectionData?.structured_data;
    const aiSuggestions = Array.isArray(sectionData?.ai_suggestions) ? sectionData.ai_suggestions : [];
    const acceptedForSection = acceptedSuggestions?.[sectionKey] || [];

    const hasDoctorContent = doctorContent && doctorContent.trim() !== "";
    const hasStructuredData = structuredData && ((Array.isArray(structuredData) && structuredData.length > 0) || (typeof structuredData === 'object' && Object.keys(structuredData).length > 0));
    const availableSuggestions = aiSuggestions.filter((suggestion, index) => {
      let suggestionText = typeof suggestion === 'string' ? suggestion : (suggestion.suggestion || suggestion.text || "");
      const isAccepted = acceptedForSection.some(accepted => accepted.originalIndex === index || (suggestionText && accepted.text === suggestionText));
      return !isAccepted;
    });

    if (!hasDoctorContent && !hasStructuredData && availableSuggestions.length === 0 && acceptedForSection.length === 0) return null;

    return (
      <Box sx={styles.sectionCard} key={sectionKey}>
        <Box sx={styles.sectionCardHeader}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
            <Box sx={styles.sectionIconBox}>{getSectionIcon(sectionKey)}</Box>
            <Typography sx={styles.sectionLabelText}>{getSectionTitle(sectionKey)}</Typography>
            {hasDoctorContent && (
              <Box sx={{ px: 0.75, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <MicRounded sx={{ fontSize: '0.6rem' }} /> Dictated
              </Box>
            )}
            {hasStructuredData && (
              <Box sx={{ px: 0.75, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted }}>Structured</Box>
            )}
            {(availableSuggestions.length > 0 || acceptedForSection.length > 0) && showAiSuggestions && (
              <Box sx={{ px: 0.75, py: 0.2, backgroundColor: theme.accent, color: theme.accentFg, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {availableSuggestions.length} AI · {acceptedForSection.length} ✓
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <MinimalToggle checked={saveCheckboxes?.[sectionKey] || false} onChange={(checked) => handleSaveToggle(sectionKey, checked)} label={saveCheckboxes?.[sectionKey] ? 'Added' : 'Add'} />
            <Tooltip title={expandedSections[sectionKey] ? "Collapse" : "Expand"}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleToggle(sectionKey); }} sx={styles.expandBtn}>
                {expandedSections[sectionKey] ? <ExpandLess sx={{ fontSize: '1rem' }} /> : <ExpandMore sx={{ fontSize: '1rem' }} />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Collapse in={expandedSections[sectionKey]}>
          <Box sx={{ p: 2 }}>
            {hasStructuredData && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box sx={{ width: 3, height: 14, backgroundColor: theme.accent }} />
                  <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, fontWeight: 600 }}>Structured Treatment Data</Typography>
                </Box>
                <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5, backgroundColor: theme.bgSecondary }}>
                  {renderStructuredSection(sectionKey, sectionData)}
                </Box>
              </Box>
            )}

            {hasDoctorContent && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box sx={{ width: 3, height: 14, backgroundColor: theme.textSecondary }} />
                  <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, fontWeight: 600 }}>Doctor's Audio Dictation</Typography>
                </Box>
                <Box sx={{ borderLeft: `3px solid ${theme.textMuted}`, pl: 1.5, py: 0.5 }}>
                  <Typography sx={{ fontSize: '0.83rem', color: theme.textSecondary, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{doctorContent}</Typography>
                </Box>
              </Box>
            )}

            {acceptedForSection.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box sx={{ width: 3, height: 14, backgroundColor: '#444' }} />
                  <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, fontWeight: 600 }}>Accepted AI Enhancements</Typography>
                </Box>
                <Grid container spacing={1}>
                  {acceptedForSection.map((acceptedSuggestion) => (
                    <Grid item xs={12} key={acceptedSuggestion.id}>
                      <Box sx={{ border: `1px solid ${theme.border}`, borderLeft: `3px solid ${theme.textPrimary}`, p: 1.5, backgroundColor: theme.bgSecondary }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                          <Typography sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted }}>Enhancement</Typography>
                          <Tooltip title="Remove">
                            <IconButton size="small" onClick={() => handleDeleteAcceptedSuggestion(sectionKey, acceptedSuggestion.id)} sx={{ borderRadius: 0, p: 0.5 }}>
                              <DeleteRounded sx={{ fontSize: '0.8rem', color: theme.textMuted }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                        <Typography sx={{ fontSize: '0.82rem', color: theme.textSecondary, mb: 0.5 }}>{acceptedSuggestion.text}</Typography>
                        {acceptedSuggestion.justification && (
                          <Typography sx={{ fontSize: '0.75rem', color: theme.textMuted, fontStyle: 'italic' }}><strong>Rationale:</strong> {acceptedSuggestion.justification}</Typography>
                        )}
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}

            {availableSuggestions.length > 0 && showAiSuggestions && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box sx={{ width: 3, height: 14, backgroundColor: theme.textMuted }} />
                  <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, fontWeight: 600 }}>AI Clinical Decision Support</Typography>
                </Box>
                <Grid container spacing={1}>
                  {availableSuggestions.map((suggestion, index) => {
                    let suggestionText = typeof suggestion === 'string' ? suggestion : (suggestion.suggestion || suggestion.text || JSON.stringify(suggestion));
                    let justification = typeof suggestion !== 'string' ? (suggestion.rationale || suggestion.justification || "") : "";
                    const originalIndex = aiSuggestions.findIndex(s => {
                      if (typeof s === 'string') return s === suggestionText;
                      if (s.suggestion) return s.suggestion === suggestionText;
                      if (s.text) return s.text === suggestionText;
                      return false;
                    });
                    return (
                      <Grid item xs={12} key={`suggestion-${sectionKey}-${originalIndex}-${Date.now()}`}>
                        <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5, backgroundColor: theme.bgSecondary, transition: 'border-color 0.15s', '&:hover': { borderColor: theme.textSecondary } }}>
                          <Typography sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, mb: 0.75 }}>AI Suggestion #{index + 1}</Typography>
                          <Typography sx={{ fontSize: '0.82rem', color: theme.textSecondary, mb: 0.5, lineHeight: 1.6 }}>{suggestionText}</Typography>
                          {justification && <Typography sx={{ fontSize: '0.75rem', color: theme.textMuted, fontStyle: 'italic', mb: 1 }}><strong>Rationale:</strong> {justification}</Typography>}
                          <Box sx={{ display: 'flex', gap: 0.75 }}>
                            <Button size="small" onClick={() => handleAcceptSuggestion(sectionKey, suggestion, originalIndex)}
                              sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.borderStrong}`, backgroundColor: theme.accent, color: theme.accentFg, '&:hover': { backgroundColor: theme.textSecondary } }}>
                              Accept
                            </Button>
                            <Button size="small"
                              sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.border}`, color: theme.textMuted, '&:hover': { borderColor: theme.textSecondary } }}>
                              Ignore
                            </Button>
                          </Box>
                        </Box>
                      </Grid>
                    );
                  })}
                </Grid>
              </Box>
            )}
          </Box>
        </Collapse>
      </Box>
    );
  };

  if (!treatmentData && !protocolContent) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
        <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.textMuted, mb: 1 }}>No Treatment Plan</Typography>
        <Typography sx={{ fontSize: '0.85rem', color: theme.textSecondary, fontFamily: theme.fontFamily }}>
          {selectedIntent && selectedIntent !== "no_intent" ? `Transcribe audio to generate a ${selectedIntent} treatment plan.` : "Transcribe audio to generate a treatment plan."}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Intent section */}
      {(!treatmentData || !treatmentData.sections || Object.keys(treatmentData.sections).length === 0) && (
        <Box sx={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
          <Box sx={{ p: 2 }}>
            {treatmentData?.intent_alignment &&
              treatmentData.intent_alignment.alignment_status !== 'not_assessable' &&
              treatmentData.intent_alignment.intent !== 'none' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, fontWeight: 600 }}>Intent Alignment</Typography>
                  <Box sx={{ px: 1, py: 0.2, border: `1px solid ${treatmentData.intent_alignment.alignment_status === 'aligned' ? theme.borderStrong : theme.border}`, backgroundColor: treatmentData.intent_alignment.alignment_status === 'aligned' ? theme.accent : 'transparent', color: treatmentData.intent_alignment.alignment_status === 'aligned' ? theme.accentFg : theme.textMuted, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {treatmentData.intent_alignment.intent}
                  </Box>
                  <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.65rem', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {treatmentData.intent_alignment.alignment_status}
                  </Box>
                  {treatmentData.intent_alignment.notes && (
                    <Typography sx={{ fontSize: '0.78rem', color: theme.textMuted, fontStyle: 'italic' }}>{treatmentData.intent_alignment.notes}</Typography>
                  )}
                </Box>
              )}
          </Box>
        </Box>
      )}

      {/* Action Buttons */}
      <Box sx={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ px: 1, py: 0.2, border: `1px solid ${planStatus === PLAN_STATUS.CURRENT ? theme.borderStrong : theme.border}`, backgroundColor: planStatus === PLAN_STATUS.CURRENT ? theme.accent : 'transparent', color: planStatus === PLAN_STATUS.CURRENT ? theme.accentFg : theme.textMuted, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: theme.fontFamily }}>
              {planStatus || 'Draft'}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75 }}>
            {isEditMode ? (
              <>
                <Button size="small" onClick={handleSave} startIcon={<SaveRounded sx={{ fontSize: '0.85rem' }} />}
                  sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.borderStrong}`, backgroundColor: theme.accent, color: theme.accentFg, fontFamily: theme.fontFamily, '&:hover': { backgroundColor: theme.textSecondary } }}>
                  Save Changes
                </Button>
                <Button size="small" onClick={handleCancelEdit} startIcon={<CloseRounded sx={{ fontSize: '0.85rem' }} />}
                  sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.border}`, color: theme.textSecondary, fontFamily: theme.fontFamily, '&:hover': { borderColor: theme.textPrimary } }}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="small" onClick={handleContinue} startIcon={<PlayArrowRounded sx={{ fontSize: '0.85rem' }} />}
                  sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.border}`, color: theme.textSecondary, fontFamily: theme.fontFamily, '&:hover': { borderColor: theme.textPrimary, color: theme.textPrimary } }}>
                  Continue
                </Button>
                <Button size="small" onClick={handleEdit} startIcon={<EditRounded sx={{ fontSize: '0.85rem' }} />}
                  sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.border}`, color: theme.textSecondary, fontFamily: theme.fontFamily, '&:hover': { borderColor: theme.textPrimary, color: theme.textPrimary } }}>
                  Edit
                </Button>
                <Button size="small" onClick={handleDelete} startIcon={<DeleteRounded sx={{ fontSize: '0.85rem' }} />}
                  sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.border}`, color: theme.textMuted, fontFamily: theme.fontFamily, '&:hover': { borderColor: theme.textPrimary, color: theme.textPrimary } }}>
                  Delete
                </Button>
                <Button size="small" onClick={onPreviewPdfClick} disabled={generatingPdf}
                  startIcon={generatingPdf ? <CircularProgress size={12} sx={{ color: theme.accentFg }} /> : <PictureAsPdfRounded sx={{ fontSize: '0.85rem' }} />}
                  sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.borderStrong}`, backgroundColor: theme.accent, color: theme.accentFg, fontFamily: theme.fontFamily, '&:hover': { backgroundColor: theme.textSecondary } }}>
                  Preview & Download PDF
                </Button>
              </>
            )}
          </Box>
        </Box>
      </Box>

      {/* Intent info for DB data */}
      {treatmentData?.sections && Object.keys(treatmentData.sections).length > 0 && treatmentData.intent_alignment && treatmentData.intent_alignment.intent && treatmentData.intent_alignment.intent !== 'none' && (
        <Box sx={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bgSecondary, p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, fontWeight: 600 }}>Treatment Intent</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.2, border: `1px solid ${theme.border}`, backgroundColor: theme.bg, fontSize: '0.72rem', color: theme.textSecondary, fontFamily: theme.fontFamily, textTransform: 'capitalize' }}>
              {getIntentIcon(treatmentData.intent_alignment.intent)}
              <span style={{ marginLeft: 4 }}>{treatmentData.intent_alignment.intent}</span>
            </Box>
          </Box>
        </Box>
      )}

      {/* Misalignment */}
      {renderMisalignmentSection()}

      {/* Evaluation */}
      <EvaluationSection evaluation={treatmentData?.evaluation || treatmentData?.clinical_evaluation} />

      {/* Recommended Procedures standalone block — only needed for 'sections' format.
          'protocol' format already renders procedures in the correct position
          (between Medications and Investigations) inside ReadOnlyTreatmentProtocolSection. */}
      {!isEditMode && displayFormat !== 'protocol' && proceduresList.length > 0 && (
        <Box sx={styles.sectionCard}>
          <Box sx={styles.sectionCardHeader}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
              <Box sx={styles.sectionIconBox}><AssignmentRounded sx={{ fontSize: '0.8rem' }} /></Box>
              <Typography sx={styles.sectionLabelText}>Recommended Procedures</Typography>
            </Box>
            <Tooltip title={expandedSections.recommendedProcedures !== false ? "Collapse" : "Expand"}>
              <IconButton size="small" onClick={() => handleToggle('recommendedProcedures')} sx={styles.expandBtn}>
                {expandedSections.recommendedProcedures !== false ? <ExpandLess sx={{ fontSize: '1rem' }} /> : <ExpandMore sx={{ fontSize: '1rem' }} />}
              </IconButton>
            </Tooltip>
          </Box>
          <Collapse in={expandedSections.recommendedProcedures !== false}>
            <Box sx={{ p: 2 }}>
              <Grid container spacing={1.5}>
                {proceduresList.map((proc, index) => (
                  <Grid item xs={12} key={index}>
                    <Box sx={{ border: `1px solid ${theme.border}`, p: 1.5, transition: 'border-color 0.15s', '&:hover': { borderColor: theme.borderStrong } }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75 }}>
                        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: theme.textPrimary, fontFamily: theme.fontFamily }}>{proc?.name || `Procedure ${index + 1}`}</Typography>
                        {proc?.timing && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.65rem', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{proc.timing}</Box>}
                      </Box>
                      {proc?.indication && <Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary, mb: 0.5 }}><strong>Indication:</strong> {proc.indication}</Typography>}
                      {proc?.reasonNeeded && <Typography sx={{ fontSize: '0.8rem', color: theme.textSecondary, mb: 0.5 }}><strong>Why Needed:</strong> {proc.reasonNeeded}</Typography>}
                      {proc?.guideline && <Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.5 }}><strong>Guideline:</strong> {proc.guideline}</Typography>}
                      {proc?.patientSpecific && <Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.5 }}><strong>Patient Specific:</strong> {proc.patientSpecific}</Typography>}
                      {proc?.supportingTrial && <Typography sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.5 }}><strong>Trial:</strong> {proc.supportingTrial}</Typography>}

                      {proc?.steps?.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Procedure Steps</Typography>
                          {proc.steps.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                        </Box>
                      )}
                      {proc?.prerequisites?.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Prerequisites</Typography>
                          {proc.prerequisites.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                        </Box>
                      )}
                      {proc?.contraindications?.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Contraindications</Typography>
                          {proc.contraindications.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                        </Box>
                      )}
                      {proc?.complications?.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Expected Complications</Typography>
                          {proc.complications.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                        </Box>
                      )}
                      {proc?.postCare?.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textMuted, fontWeight: 600, mb: 0.5 }}>Post-Procedure Care</Typography>
                          {proc.postCare.map((s, i) => (<Typography key={i} sx={{ fontSize: '0.78rem', color: theme.textSecondary, mb: 0.25 }}>— {s}</Typography>))}
                        </Box>
                      )}

                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                        {proc?.cardiacRisk && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Cardiac risk: {proc.cardiacRisk}</Box>}
                        {proc?.duration && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Duration: {proc.duration}</Box>}
                        {proc?.anesthesia && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Anesthesia: {proc.anesthesia}</Box>}
                        {proc?.hospitalStay && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Stay: {proc.hospitalStay}</Box>}
                        {proc?.recoveryTime && <Box sx={{ px: 1, py: 0.2, border: `1px solid ${theme.border}`, fontSize: '0.68rem', color: theme.textMuted }}>Recovery: {proc.recoveryTime}</Box>}
                      </Box>
                      {proc?.scopeCompliant && (
                        <Box sx={{ mt: 1 }}>
                          <Box sx={{ display: 'inline-block', px: 1, py: 0.2, border: `1px solid ${theme.borderStrong}`, backgroundColor: /yes/i.test(proc.scopeCompliant) ? theme.accent : 'transparent', color: /yes/i.test(proc.scopeCompliant) ? theme.accentFg : theme.textMuted, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {/yes/i.test(proc.scopeCompliant) ? 'In-scope' : 'Out-of-scope'}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Box>
          </Collapse>
        </Box>
      )}

      {/* Content */}
      {!isEditMode && (
        <>
          {displayFormat === 'protocol' && (
            <Box sx={styles.sectionCard}>
              <Box sx={styles.sectionCardHeader}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                  <Box sx={styles.sectionIconBox}><AssignmentRounded sx={{ fontSize: '0.8rem' }} /></Box>
                  <Typography sx={styles.sectionLabelText}>Treatment Protocol</Typography>
                </Box>
                <Tooltip title={expandedSections.protocol ? "Collapse" : "Expand"}>
                  <IconButton size="small" onClick={() => handleToggle('protocol')} sx={styles.expandBtn}>
                    {expandedSections.protocol ? <ExpandLess sx={{ fontSize: '1rem' }} /> : <ExpandMore sx={{ fontSize: '1rem' }} />}
                  </IconButton>
                </Tooltip>
              </Box>
              <Collapse in={expandedSections.protocol}>
                <Box sx={{ p: 2 }}>
                  {protocolContent ? (
                    <ReadOnlyTreatmentProtocolSection protocolData={protocolContent} styles={styles} />
                  ) : (
                    <Typography sx={{ fontSize: '0.83rem', color: theme.textMuted, textAlign: 'center', py: 4 }}>No treatment protocol available.</Typography>
                  )}
                </Box>
              </Collapse>
            </Box>
          )}

          {displayFormat === 'sections' && (
            <>{treatmentData?.sections && Object.keys(treatmentData.sections).map(sectionKey => renderSection(sectionKey))}</>
          )}
        </>
      )}

      {/* Edit Mode */}
      {isEditMode && editableSectionData && (
        <EditableTreatmentProtocolSection
          sectionData={editableSectionData}
          styles={styles}
          onDataChange={onFieldChange}
          isSectionsFormat={treatmentData?.sections && Object.keys(treatmentData.sections).length > 0}
        />
      )}
    </Box>
  );
};

// ─── Main TreatmentPlan Component ───
const TreatmentPlan = forwardRef(({
  doctorId,
  patientId,
  treatmentObjective,
  dictationData,
  dictationText,
  onTreatmentObjectiveChange,
  reloadTrigger = 0,
  onStatusChange,
  initialStatus = PLAN_STATUS.DRAFT,
  onDataLoaded  // ADD THIS NEW PROP
}, ref) => {

  const [treatmentData, setTreatmentData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedSections, setExpandedSections] = useState({ protocol: true });
  const [planStatus, setPlanStatus] = useState(initialStatus);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editableSectionData, setEditableSectionData] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [history, setHistory] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [saveCheckboxes, setSaveCheckboxes] = useState({});
  const [showAiSuggestions, setShowAiSuggestions] = useState(true);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState({});
  const [selectedIntent, setSelectedIntent] = useState(treatmentObjective || "no_intent");
  const [isGeneratingWithIntent, setIsGeneratingWithIntent] = useState(false);
  const [previousDictationText, setPreviousDictationText] = useState('');
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const isMounted = useRef(true);



  useEffect(() => {
  if (onDataLoaded) {
    onDataLoaded(!!treatmentData);
  }
}, [treatmentData, onDataLoaded]);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    if (doctorId && patientId) fetchExistingPlan();
  }, [doctorId, patientId, reloadTrigger]);

  useEffect(() => {
    if (dictationText && dictationText.trim() !== "" && dictationText !== previousDictationText && isMounted.current) {
      if (treatmentData) return;
      const hasTreatmentProtocol = dictationText.includes("TREATMENT PROTOCOL") || dictationText.includes("PRIMARY GOALS") || dictationText.includes("MEDICATIONS") || dictationText.includes("INVESTIGATIONS") || dictationText.includes("LIFESTYLE MODIFICATIONS") || dictationText.includes("FOLLOW-UP PLAN");
      if (hasTreatmentProtocol) {
        const dictData = { processed_treatment_plan: { doctor_content: dictationText, structured_data: parseProtocolToStructuredData(dictationText) || {} }, sections: {}, metadata: { created_at: new Date().toISOString(), version: 1 } };
        setTreatmentData(dictData);
        setPlanStatus(PLAN_STATUS.DRAFT);
        setCurrentVersion(1);
        setExpandedSections({ protocol: true });
        setSaveCheckboxes({}); 
        setPreviousDictationText(dictationText);
      }
    }
  }, [dictationText, treatmentData]);

  useEffect(() => {
    if (dictationData && isMounted.current) {
      if (treatmentData) return;
      const finalData = dictationData.finaloutput || dictationData;
      setHistory(prev => [...prev, { data: finalData, status: PLAN_STATUS.CURRENT, timestamp: new Date().toISOString() }]);
      setTreatmentData(finalData);
      setPlanStatus(PLAN_STATUS.CURRENT);
      setCurrentVersion(prev => prev + 1);
      setExpandedSections({ protocol: true });
      const initialCheckboxes = {};
      if (finalData.sections) {
        Object.keys(finalData.sections).forEach(sectionKey => {
          initialCheckboxes[sectionKey] = finalData.sections[sectionKey]?.doctor_content?.trim() !== "";
        });
      }
      setSaveCheckboxes(initialCheckboxes);
      if (onStatusChange) onStatusChange(PLAN_STATUS.CURRENT);
    }
  }, [dictationData, treatmentData, onStatusChange]);

  useEffect(() => {
    if (treatmentData) {
      const sectionsWithContent = {};
      if (treatmentData.sections) {
        Object.keys(treatmentData.sections).forEach(sectionKey => {
          const section = treatmentData.sections[sectionKey];
          sectionsWithContent[sectionKey] = section.doctor_content?.trim() !== "" || (section.ai_suggestions && section.ai_suggestions.length > 0);
        });
      }
      const hasProtocolContent = treatmentData.processed_treatment_plan?.doctor_content?.trim() !== "";
      setExpandedSections(prev => ({ ...prev, protocol: hasProtocolContent, ...sectionsWithContent }));
      const initialCheckboxes = {};
      if (treatmentData.sections) {
        Object.keys(treatmentData.sections).forEach(sectionKey => {
          initialCheckboxes[sectionKey] = treatmentData.sections[sectionKey]?.doctor_content?.trim() !== "";
        });
      }
      setSaveCheckboxes(initialCheckboxes);
    }
  }, [treatmentData]);

  useImperativeHandle(ref, () => ({
    saveTreatmentPlanData: () => prepareTreatmentPlanForSave(),
    getPlanStatus: () => planStatus,
    getCurrentData: () => treatmentData,
    resetPlan: () => {
      if (isMounted.current) {
        setTreatmentData(null); setPlanStatus(PLAN_STATUS.DRAFT); setIsEditMode(false); setEditableSectionData(null); setSaveCheckboxes({}); setAcceptedSuggestions({});
      }
    }
  }));

  const fetchExistingPlan = async () => {
    if (!doctorId || !patientId) return;
    setLoading(true); setError(null);
    try {
      const url = `${API_BASE_URL}hms/users/data/context/get-current-plan/${patientId}/${doctorId}`;
      const response = await fetch(url);
      if (response.status === 404) { setTreatmentData(null); setPlanStatus(PLAN_STATUS.DRAFT); setLoading(false); checkDictationForTreatmentProtocol(); return; }
      if (!response.ok) {}
      const result = await response.json();
      if (result.data) {
        const planData = result.data;
        const transformedData = transformPlanData(planData);
        const hasAnyContent = checkForAnyContent(transformedData);
        if (hasAnyContent) {
          const hasSections = transformedData.sections && Object.keys(transformedData.sections).length > 0;
          const hasProtocolContent = transformedData.processed_treatment_plan?.doctor_content?.trim() !== "";
          setTreatmentData(transformedData);
          setPlanStatus(planData.metadata?.plan_status || PLAN_STATUS.CURRENT);
          setCurrentVersion(planData.metadata?.version || 1);
          const initialExpandedState = { protocol: hasProtocolContent };
          if (transformedData.sections) {
            Object.keys(transformedData.sections).forEach(sectionKey => {
              const section = transformedData.sections[sectionKey];
              initialExpandedState[sectionKey] = section.doctor_content?.trim() !== "" || (section.ai_suggestions && section.ai_suggestions.length > 0);
            });
          }
          setExpandedSections(initialExpandedState);
          const initialCheckboxes = {};
          if (transformedData.sections) {
            Object.keys(transformedData.sections).forEach(sectionKey => {
              initialCheckboxes[sectionKey] = transformedData.sections[sectionKey]?.doctor_content?.trim() !== "";
            });
          }
          setSaveCheckboxes(initialCheckboxes);
          setLoading(false);
        } else { setTreatmentData(null); setLoading(false); checkDictationForTreatmentProtocol(); }
      } else { setTreatmentData(null); setLoading(false); checkDictationForTreatmentProtocol(); }
    } catch (err) { setTreatmentData(null); setLoading(false); checkDictationForTreatmentProtocol(); }
  };

  const checkForTreatmentProtocol = (planData) => {
    if (!planData) return false;
    try {
      const finaloutput = planData.finaloutput || {};
      const processedPlan = finaloutput.processed_treatment_plan || {};
      const sections = finaloutput.sections || {};
      const doctorContent = processedPlan.doctor_content;
      if (doctorContent && doctorContent.trim() !== "") {
        if (doctorContent.includes("TREATMENT PROTOCOL") || doctorContent.includes("PRIMARY GOALS") || doctorContent.includes("MEDICATIONS") || doctorContent.includes("INVESTIGATIONS") || doctorContent.includes("LIFESTYLE MODIFICATIONS") || doctorContent.includes("FOLLOW-UP PLAN")) return true;
      }
      if (Object.keys(sections).length > 0 && Object.values(sections).some(s => s.doctor_content && s.doctor_content.trim() !== "")) return true;
      const structuredData = processedPlan.structured_data;
      if (structuredData) {
        if ((structuredData.primaryGoals?.length > 0) || (structuredData.medications?.length > 0) || (structuredData.investigations?.length > 0) || (structuredData.lifestyleModifications?.length > 0) || (structuredData.followUpPlan?.nextVisit) || (structuredData.followUpPlan?.monitoringParameters?.length > 0)) return true;
      }
      return false;
    } catch (error) { return false; }
  };

  const checkForAnyContent = (transformedData) => {
    if (!transformedData) return false;
    try {
      if (transformedData.sections) {
        if (Object.values(transformedData.sections).some(s => (s.doctor_content && s.doctor_content.trim() !== "") || (s.ai_suggestions && s.ai_suggestions.length > 0))) return true;
      }
      if (transformedData.processed_treatment_plan?.doctor_content?.trim() !== "") return true;
      if (transformedData.clinical_evaluation && Object.values(transformedData.clinical_evaluation).some(val => val && val.trim() !== "")) return true;
      if (transformedData.intent_alignment && (transformedData.intent_alignment.misalignment_flag?.trim() !== "" || transformedData.intent_alignment.notes?.trim() !== "")) return true;
      return false;
    } catch (error) { return false; }
  };

  const checkDictationForTreatmentProtocol = () => {
    if (!dictationText || dictationText.trim() === "") {
      setTreatmentData(null); setLoading(false);
      setSnackbar({ open: true, message: 'No existing plan found. Please transcribe audio to generate a new plan.', severity: 'info' });
      return;
    }
    const hasTreatmentProtocol = dictationText.includes("TREATMENT PROTOCOL") || dictationText.includes("PRIMARY GOALS") || dictationText.includes("MEDICATIONS") || dictationText.includes("INVESTIGATIONS") || dictationText.includes("LIFESTYLE MODIFICATIONS") || dictationText.includes("FOLLOW-UP PLAN");
    if (hasTreatmentProtocol) {
      const dictData = { processed_treatment_plan: { doctor_content: dictationText, structured_data: parseProtocolToStructuredData(dictationText) || {} }, sections: {}, metadata: { created_at: new Date().toISOString(), version: 1 } };
      setTreatmentData(dictData); setPlanStatus(PLAN_STATUS.DRAFT); setCurrentVersion(1); setExpandedSections({ protocol: true }); setSaveCheckboxes({}); setLoading(false);
      setSnackbar({ open: true, message: 'Using dictation text as treatment protocol', severity: 'success' });
    } else { generateTreatmentPlanWithIntent(selectedIntent); }
  };

  const transformPlanData = (planData) => {
    try {
      const finaloutput = planData.finaloutput || {};
      const processedPlan = finaloutput.processed_treatment_plan || {};
      const sections = finaloutput.sections || {};
      const hasSectionsData = Object.keys(sections).length > 0;
      if (hasSectionsData) {
        const transformedSections = {};
        Object.entries(sections).forEach(([key, value]) => {
          transformedSections[key] = { doctor_content: value.doctor_content || "", structured_data: value.structured_data || null, ai_suggestions: value.ai_suggestions || [] };
        });
        const protocolContent = generateProtocolFromSections(transformedSections);
        return {
          processed_treatment_plan: { doctor_content: protocolContent, structured_data: processedPlan.structured_data || {}, ai_enhancement: processedPlan.ai_enhancement || null },
          sections: transformedSections,
          intent_alignment: finaloutput.intent_alignment || { intent: "none", alignment_status: "not_assessable", misalignment_flag: "", notes: "" },
          clinical_evaluation: finaloutput.clinical_evaluation || {}, evaluation: finaloutput.clinical_evaluation || {},
          metadata: planData.metadata || { created_at: new Date().toISOString(), version: 1 }
        };
      } else {
        return {
          processed_treatment_plan: { doctor_content: processedPlan.doctor_content || "", structured_data: processedPlan.structured_data || {}, ai_enhancement: processedPlan.ai_enhancement || null },
          sections: {},
          intent_alignment: finaloutput.intent_alignment || { intent: "none", alignment_status: "not_assessable", misalignment_flag: "", notes: "" },
          clinical_evaluation: finaloutput.clinical_evaluation || {}, evaluation: finaloutput.clinical_evaluation || {},
          metadata: planData.metadata || { created_at: new Date().toISOString(), version: 1 }
        };
      }
    } catch (error) { return null; }
  };

  const generateProtocolFromSections = (sections) => {
    let protocol = "TREATMENT PROTOCOL\n\n";
    if (sections.diagnosis?.doctor_content) protocol += `DIAGNOSIS\n${sections.diagnosis.doctor_content}\n\n`;
    if (sections.pharmacological_plan?.doctor_content) protocol += `PHARMACOLOGICAL PLAN\n${sections.pharmacological_plan.doctor_content}\n\n`;
    if (sections.investigations?.doctor_content) protocol += `INVESTIGATIONS\n${sections.investigations.doctor_content}\n\n`;
    if (sections.procedural_plan?.doctor_content) protocol += `PROCEDURAL PLAN\n${sections.procedural_plan.doctor_content}\n\n`;
    if (sections.monitoring_follow_up?.doctor_content) protocol += `MONITORING & FOLLOW-UP\n${sections.monitoring_follow_up.doctor_content}\n\n`;
    return protocol.trim();
  };

  const generateTreatmentPlanWithIntent = async (intent) => {
    if (!doctorId || !patientId || !dictationText || dictationText.trim() === "") {
      setError("Missing required information to generate plan."); return;
    }
    setIsGeneratingWithIntent(true); setLoading(true); setError(null);
    try {
      const useNewEndpoint = intent && intent !== "no_intent" && intent.trim() !== "";
      let payload, endpointUrl;
      if (useNewEndpoint) {
        endpointUrl = `${API_BASE_URL}hms/users/orchestration/generate_treatment_plan`;
        payload = { doctor_id: doctorId, patient_id: patientId, treatment_intent: intent, dictation: dictationText };
      } else {
        endpointUrl = `${API_BASE_URL}hms/users/orchestration/generate_documentation_with_suggestions`;
        payload = { doctor_id: doctorId, patient_id: patientId, feature_id: "documentation-treatment-plan", dictation: dictationText, output_json: {} };
      }
      const response = await fetch(endpointUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`API call failed with status: ${response.status}`);
      const data = await response.json();
      const finalData = data.finaloutput || data;
      setHistory(prev => [...prev, { data: finalData, status: PLAN_STATUS.CURRENT, timestamp: new Date().toISOString() }]);
      setTreatmentData(finalData); setPlanStatus(PLAN_STATUS.CURRENT); setCurrentVersion(prev => prev + 1); setExpandedSections({ protocol: true });
      const initialCheckboxes = {};
      if (finalData.sections) {
        Object.keys(finalData.sections).forEach(sectionKey => { initialCheckboxes[sectionKey] = finalData.sections[sectionKey]?.doctor_content?.trim() !== ""; });
      }
      setSaveCheckboxes(initialCheckboxes); setAcceptedSuggestions({});
    } catch (err) { setError(`Failed to generate treatment plan: ${err.message}`); }
    finally { setLoading(false); setIsGeneratingWithIntent(false); }
  };

  const handleIntentChange = async (event, newIntent) => {
    if (newIntent !== null) {
      setSelectedIntent(newIntent);
      if (onTreatmentObjectiveChange) onTreatmentObjectiveChange(newIntent);
      if (dictationText && dictationText.trim() !== "") await generateTreatmentPlanWithIntent(newIntent);
    }
  };

  const toggleSection = (section) => setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  const handleSaveToggle = (section, checked) => setSaveCheckboxes(prev => ({ ...prev, [section]: checked }));

  const handleAcceptSuggestion = (sectionKey, suggestion, index) => {
    let suggestionText = typeof suggestion === 'string' ? suggestion : (suggestion.suggestion || suggestion.text || JSON.stringify(suggestion));
    let justification = typeof suggestion !== 'string' ? (suggestion.rationale || suggestion.justification || "") : "";
    setAcceptedSuggestions(prev => {
      const currentForSection = prev[sectionKey] || [];
      const isDuplicate = currentForSection.some(accepted => accepted.originalIndex === index || accepted.text === suggestionText);
      if (isDuplicate) return prev;
      return { ...prev, [sectionKey]: [...currentForSection, { text: suggestionText, justification, originalIndex: index, acceptedAt: new Date().toISOString(), id: `${sectionKey}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${index}` }] };
    });
    setSaveCheckboxes(prev => ({ ...prev, [sectionKey]: prev[sectionKey] || true }));
  };

  const handleDeleteAcceptedSuggestion = (sectionKey, suggestionId) => {
    setAcceptedSuggestions(prev => ({ ...prev, [sectionKey]: (prev[sectionKey] || []).filter(s => s.id !== suggestionId) }));
  };

  const handleContinueClick = () => {
    setHistory(prev => [...prev, { data: treatmentData, status: PLAN_STATUS.CONTINUE, timestamp: new Date().toISOString() }]);
    setPlanStatus(PLAN_STATUS.CONTINUE); setIsEditMode(false);
    if (onStatusChange) onStatusChange(PLAN_STATUS.CONTINUE);
    setSnackbar({ open: true, message: 'Plan continued successfully', severity: 'success' });
  };

  const handleEditClick = () => {
    const hasSections = treatmentData?.sections && Object.keys(treatmentData.sections).length > 0;
    if (hasSections) { setEditableSectionData(convertSectionsToEditableData(treatmentData.sections)); setIsEditMode(true); }
    else {
      const protocolContent = extractProtocolContent(treatmentData);
      const structuredData = parseProtocolToStructuredData(protocolContent);
      if (structuredData) { setEditableSectionData(structuredData); setIsEditMode(true); }
    }
  };

  const extractProtocolContent = (data) => {
    try {
      if (!data) return null;
      if (data?.processed_treatment_plan?.doctor_content) return data.processed_treatment_plan.doctor_content;
      if (data?.sections) { for (const key of Object.keys(data.sections)) { if (data.sections[key]?.doctor_content) return data.sections[key].doctor_content; } }
      if (typeof data === 'string') return data;
      return null;
    } catch (error) { return null; }
  };

  const parseProtocolToStructuredData = (protocolContent) => {
    if (!protocolContent) return null;
    try {
      const sections = { primaryDiagnosis: '', primaryGoals: [], medications: [], procedures: extractAndParseProcedures(protocolContent), investigations: [], lifestyleModifications: [], followUpPlan: { nextVisit: '', monitoringParameters: [] } };
      const goalsMatch = protocolContent.match(/PRIMARY GOALS\s*([^]*?)(?=MEDICATIONS|$)/);
      if (goalsMatch) sections.primaryGoals = goalsMatch[1].split('•').map(item => item.trim()).filter(item => item && !item.includes('PRIMARY GOALS'));
      const medicationsMatch = protocolContent.match(/MEDICATIONS\s*([^]*?)(?=INVESTIGATIONS|$)/);
      if (medicationsMatch) {
        sections.medications = medicationsMatch[1].split('•').filter(item => item.trim()).map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (!lines.length) return null;
          const med = { name: lines[0], dose: '', frequency: '', indication: '', guideline: '', patientSpecific: '' };
          lines.forEach(line => {
            if (line.startsWith('- Dose:')) med.dose = line.replace('- Dose:', '').trim();
            else if (line.startsWith('- Frequency:')) med.frequency = line.replace('- Frequency:', '').trim();
            else if (line.startsWith('- Indication:')) med.indication = line.replace('- Indication:', '').trim();
            else if (line.startsWith('- Guideline:')) med.guideline = line.replace('- Guideline:', '').trim();
            else if (line.startsWith('- Patient Specific:')) med.patientSpecific = line.replace('- Patient Specific:', '').trim();
          });
          return med;
        }).filter(m => m !== null);
      }
      const investigationsMatch = protocolContent.match(/INVESTIGATIONS\s*([^]*?)(?=LIFESTYLE MODIFICATIONS|$)/);
      if (investigationsMatch) {
        sections.investigations = investigationsMatch[1].split('•').filter(item => item.trim()).map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (!lines.length) return null;
          const inv = { name: lines[0], indication: '', urgency: '', guideline: '', patientSpecific: '' };
          lines.forEach(line => {
            if (line.startsWith('- Indication:')) inv.indication = line.replace('- Indication:', '').trim();
            else if (line.startsWith('- Urgency:')) inv.urgency = line.replace('- Urgency:', '').trim();
            else if (line.startsWith('- Guideline:')) inv.guideline = line.replace('- Guideline:', '').trim();
            else if (line.startsWith('- Patient Specific:')) inv.patientSpecific = line.replace('- Patient Specific:', '').trim();
          });
          return inv;
        }).filter(i => i !== null);
      }
      const lifestyleMatch = protocolContent.match(/LIFESTYLE MODIFICATIONS\s*([^]*?)(?=FOLLOW-UP PLAN|$)/);
      if (lifestyleMatch) {
        sections.lifestyleModifications = lifestyleMatch[1].split('•').filter(item => item.trim()).map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (!lines.length) return null;
          const mod = { recommendation: lines[0], evidence: '', difficulty: '', guideline: '', patientSpecific: '' };
          lines.forEach(line => {
            if (line.startsWith('- Evidence:')) mod.evidence = line.replace('- Evidence:', '').trim();
            else if (line.startsWith('- Difficulty:')) mod.difficulty = line.replace('- Difficulty:', '').trim();
            else if (line.startsWith('- Guideline:')) mod.guideline = line.replace('- Guideline:', '').trim();
            else if (line.startsWith('- Patient Specific:')) mod.patientSpecific = line.replace('- Patient Specific:', '').trim();
          });
          return mod;
        }).filter(m => m !== null);
      }
      const followupMatch = protocolContent.match(/FOLLOW-UP PLAN\s*([^]*?)$/);
      if (followupMatch) {
        followupMatch[1].split('\n').map(l => l.trim()).filter(l => l).forEach(line => {
          if (line.startsWith('• Next Visit:')) sections.followUpPlan.nextVisit = line.replace('• Next Visit:', '').trim();
          else if (line.startsWith('-')) sections.followUpPlan.monitoringParameters.push(line.replace('-', '').trim());
        });
      }
      return sections;
    } catch (error) { return null; }
  };

  const splitBulletItems = (text) => {
    if (!text) return [];
    const parts = text.split('•').map(t => t.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [text.trim()];
  };

  const convertSectionsToEditableData = (sections) => {
    const editableData = { primaryGoals: [], medications: [], investigations: [], lifestyleModifications: [], followUpPlan: { nextVisit: '', monitoringParameters: [] } };
    if (sections.pharmacological_plan?.doctor_content) {
      editableData.medications = splitBulletItems(sections.pharmacological_plan.doctor_content).map(name => ({ name, dose: '', frequency: '', indication: '', guideline: '', patientSpecific: '' }));
    }
    if (sections.investigations?.doctor_content) {
      editableData.investigations = splitBulletItems(sections.investigations.doctor_content).map(name => ({ name, indication: '', urgency: 'routine', guideline: '', patientSpecific: '' }));
    }
    if (sections.procedural_plan?.doctor_content) {
      editableData.lifestyleModifications = splitBulletItems(sections.procedural_plan.doctor_content).map(recommendation => ({ recommendation, evidence: '', difficulty: '', guideline: '', patientSpecific: '' }));
    }
    if (sections.monitoring_follow_up?.doctor_content) editableData.followUpPlan.nextVisit = sections.monitoring_follow_up.doctor_content;
    return editableData;
  };

  const handleFieldChange = (fieldPath, value) => {
    if (!editableSectionData) return;
    setEditableSectionData(prev => {
      const newData = JSON.parse(JSON.stringify(prev));
      if (fieldPath === 'primaryGoals._add') { if (!newData.primaryGoals) newData.primaryGoals = []; newData.primaryGoals.push(''); return newData; }
      if (fieldPath === 'medications._add') { if (!newData.medications) newData.medications = []; newData.medications.push({ name: '', dose: '', frequency: '', indication: '', guideline: '', patientSpecific: '' }); return newData; }
      if (fieldPath === 'investigations._add') { if (!newData.investigations) newData.investigations = []; newData.investigations.push({ name: '', indication: '', urgency: 'routine', guideline: '', patientSpecific: '' }); return newData; }
      if (fieldPath === 'lifestyleModifications._add') { if (!newData.lifestyleModifications) newData.lifestyleModifications = []; newData.lifestyleModifications.push({ recommendation: '', evidence: '', difficulty: '', guideline: '', patientSpecific: '' }); return newData; }
      if (fieldPath === 'followUpPlan.monitoringParameters._add') { if (!newData.followUpPlan.monitoringParameters) newData.followUpPlan.monitoringParameters = []; newData.followUpPlan.monitoringParameters.push(''); return newData; }
      if (fieldPath.endsWith('._delete')) {
        const parts = fieldPath.split('.');
        const index = parseInt(parts[0].match(/\[(\d+)\]/)[1]);
        const arrayPath = parts[0].replace(/\[\d+\]/, '');
        if (arrayPath === 'primaryGoals') newData.primaryGoals.splice(index, 1);
        else if (arrayPath === 'medications') newData.medications.splice(index, 1);
        else if (arrayPath === 'investigations') newData.investigations.splice(index, 1);
        else if (arrayPath === 'lifestyleModifications') newData.lifestyleModifications.splice(index, 1);
        else if (arrayPath === 'followUpPlan.monitoringParameters') newData.followUpPlan.monitoringParameters.splice(index, 1);
        return newData;
      }
      const pathParts = fieldPath.split('.');
      let current = newData;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part.includes('[')) {
          const match = part.match(/(.+)\[(\d+)\]/);
          if (match) current = current[match[1]][parseInt(match[2])];
        } else { if (!current[part]) current[part] = {}; current = current[part]; }
      }
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart.includes('[')) { const match = lastPart.match(/(.+)\[(\d+)\]/); if (match) { if (!current[match[1]]) current[match[1]] = []; current[match[1]][parseInt(match[2])] = value; } }
      else current[lastPart] = value;
      return newData;
    });
  };

  const handleSaveClick = () => {
    if (!editableSectionData) return;
    const hasSections = treatmentData?.sections && Object.keys(treatmentData.sections).length > 0;
    if (hasSections) {
      const updatedData = JSON.parse(JSON.stringify(treatmentData));
      if (editableSectionData.medications?.length > 0) {
        const medicationText = editableSectionData.medications.map(med => `• ${med.name}${med.dose ? ` ${med.dose}` : ''}${med.frequency ? ` ${med.frequency}` : ''}${med.indication ? ` for ${med.indication}` : ''}`).join('\n');
        if (updatedData.sections.pharmacological_plan) updatedData.sections.pharmacological_plan.doctor_content = medicationText;
        else updatedData.sections.pharmacological_plan = { doctor_content: medicationText, ai_suggestions: null };
      }
      if (editableSectionData.investigations?.length > 0) {
        const investigationText = editableSectionData.investigations.map(inv => `• ${inv.name}${inv.indication ? ` (${inv.indication})` : ''}${inv.urgency ? ` - ${inv.urgency}` : ''}`).join('\n');
        if (updatedData.sections.investigations) updatedData.sections.investigations.doctor_content = investigationText;
        else updatedData.sections.investigations = { doctor_content: investigationText, ai_suggestions: null };
      }
      if (editableSectionData.lifestyleModifications?.length > 0) {
        const lifestyleText = editableSectionData.lifestyleModifications.map(mod => `• ${mod.recommendation}`).join('\n');
        if (updatedData.sections.procedural_plan) updatedData.sections.procedural_plan.doctor_content = lifestyleText;
        else updatedData.sections.procedural_plan = { doctor_content: lifestyleText, ai_suggestions: null };
      }
      if (editableSectionData.followUpPlan?.nextVisit) {
        const followUpText = `Next Visit: ${editableSectionData.followUpPlan.nextVisit}\nMonitoring: ${editableSectionData.followUpPlan.monitoringParameters?.join(', ') || 'None'}`;
        if (updatedData.sections.monitoring_follow_up) updatedData.sections.monitoring_follow_up.doctor_content = followUpText;
        else updatedData.sections.monitoring_follow_up = { doctor_content: followUpText, ai_suggestions: null };
      }
      const updatedProtocol = generateProtocolFromSections(updatedData.sections);
      if (updatedData.processed_treatment_plan) updatedData.processed_treatment_plan.doctor_content = updatedProtocol;
      setHistory(prev => [...prev, { data: updatedData, status: PLAN_STATUS.MODIFIED, timestamp: new Date().toISOString() }]);
      setTreatmentData(updatedData); setPlanStatus(PLAN_STATUS.MODIFIED); setIsEditMode(false); setEditableSectionData(null); setCurrentVersion(prev => prev + 1);
      if (onStatusChange) onStatusChange(PLAN_STATUS.MODIFIED);
      setSnackbar({ open: true, message: 'Changes saved successfully', severity: 'success' });
    } else {
      const updatedProtocol = convertStructuredToProtocol(editableSectionData);
      const updatedData = JSON.parse(JSON.stringify(treatmentData));
      if (updatedData.processed_treatment_plan) updatedData.processed_treatment_plan.doctor_content = updatedProtocol;
      else if (updatedData.sections) { for (const key of Object.keys(updatedData.sections)) { if (updatedData.sections[key]?.doctor_content) { updatedData.sections[key].doctor_content = updatedProtocol; break; } } }
      setHistory(prev => [...prev, { data: updatedData, status: PLAN_STATUS.MODIFIED, timestamp: new Date().toISOString() }]);
      setTreatmentData(updatedData); setPlanStatus(PLAN_STATUS.MODIFIED); setIsEditMode(false); setEditableSectionData(null); setCurrentVersion(prev => prev + 1);
      if (onStatusChange) onStatusChange(PLAN_STATUS.MODIFIED);
      setSnackbar({ open: true, message: 'Changes saved successfully', severity: 'success' });
    }
  };

  const convertStructuredToProtocol = (structured) => {
    let protocol = `TREATMENT PROTOCOL\n\n`;
    if (structured.primaryGoals?.length > 0) { protocol += `PRIMARY GOALS\n`; structured.primaryGoals.forEach(goal => { protocol += `• ${goal}\n`; }); protocol += `\n`; }
    if (structured.medications?.length > 0) { protocol += `MEDICATIONS\n`; structured.medications.forEach(med => { protocol += `• ${med.name}\n`; if (med.dose) protocol += `  - Dose: ${med.dose}\n`; if (med.frequency) protocol += `  - Frequency: ${med.frequency}\n`; if (med.indication) protocol += `  - Indication: ${med.indication}\n`; if (med.guideline) protocol += `  - Guideline: ${med.guideline}\n`; if (med.patientSpecific) protocol += `  - Patient Specific: ${med.patientSpecific}\n`; }); protocol += `\n`; }
    if (structured.procedures?.length > 0) {
      protocol += `RECOMMENDED PROCEDURES\n`;
      structured.procedures.forEach(proc => {
        protocol += `• ${proc.name}\n`;
        if (proc.indication) protocol += `  - Indication: ${proc.indication}\n`;
        if (proc.timing) protocol += `  - Timing: ${proc.timing}\n`;
        if (proc.reasonNeeded) protocol += `  - Reason Needed: ${proc.reasonNeeded}\n`;
        if (proc.guideline) protocol += `  - Guideline: ${proc.guideline}\n`;
        if (proc.patientSpecific) protocol += `  - Patient Specific: ${proc.patientSpecific}\n`;
        if (proc.supportingTrial) protocol += `  - Supporting Trial: ${proc.supportingTrial}\n`;
        (proc.steps || []).forEach(s => { protocol += `    · Step: ${s}\n`; });
        (proc.prerequisites || []).forEach(s => { protocol += `    · Prerequisite: ${s}\n`; });
        (proc.contraindications || []).forEach(s => { protocol += `    · Contraindication: ${s}\n`; });
        (proc.complications || []).forEach(s => { protocol += `    · Possible Complication: ${s}\n`; });
        (proc.postCare || []).forEach(s => { protocol += `    · Post-Procedure Care: ${s}\n`; });
        if (proc.cardiacRisk) protocol += `  - Cardiac Risk: ${proc.cardiacRisk}\n`;
        if (proc.duration) protocol += `  - Estimated Duration: ${proc.duration}\n`;
        if (proc.scopeCompliant) protocol += `  - Specialty Scope Compliant: ${proc.scopeCompliant}\n`;
      });
      protocol += `\n`;
    }
    if (structured.investigations?.length > 0) { protocol += `INVESTIGATIONS\n`; structured.investigations.forEach(inv => { protocol += `• ${inv.name}\n`; if (inv.indication) protocol += `  - Indication: ${inv.indication}\n`; if (inv.urgency) protocol += `  - Urgency: ${inv.urgency}\n`; if (inv.guideline) protocol += `  - Guideline: ${inv.guideline}\n`; if (inv.patientSpecific) protocol += `  - Patient Specific: ${inv.patientSpecific}\n`; }); protocol += `\n`; }
    if (structured.lifestyleModifications?.length > 0) { protocol += `LIFESTYLE MODIFICATIONS\n`; structured.lifestyleModifications.forEach(mod => { protocol += `• ${mod.recommendation}\n`; if (mod.evidence) protocol += `  - Evidence: ${mod.evidence}\n`; if (mod.difficulty) protocol += `  - Difficulty: ${mod.difficulty}\n`; if (mod.guideline) protocol += `  - Guideline: ${mod.guideline}\n`; if (mod.patientSpecific) protocol += `  - Patient Specific: ${mod.patientSpecific}\n`; }); protocol += `\n`; }
    if (structured.followUpPlan) { protocol += `FOLLOW-UP PLAN\n`; if (structured.followUpPlan.nextVisit) protocol += `• Next Visit: ${structured.followUpPlan.nextVisit}\n`; if (structured.followUpPlan.monitoringParameters?.length > 0) structured.followUpPlan.monitoringParameters.forEach(param => { protocol += `- ${param}\n`; }); }
    return protocol;
  };

  const handleCancelEdit = () => { setIsEditMode(false); setEditableSectionData(null); setSnackbar({ open: true, message: 'Edit cancelled', severity: 'info' }); };
  const handleDeleteClick = () => { if (loading) return; setDeleteDialogOpen(true); };

  const handlePreviewPdf = () => {
    if (!treatmentData) { setSnackbar({ open: true, message: 'No treatment plan available to export', severity: 'info' }); return; }
    setGeneratingPdf(true);
    try {
      const doc = generateTreatmentPlanPDF({ treatmentData, patientId, doctorId, planStatus, version: currentVersion, selectedIntent });
      const blobUrl = doc.output('bloburl');
      setPdfPreviewUrl(blobUrl);
      setPdfPreviewOpen(true);
    } catch (err) {
      setSnackbar({ open: true, message: `Failed to generate PDF: ${err.message}`, severity: 'error' });
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!treatmentData) return;
    try {
      const doc = generateTreatmentPlanPDF({ treatmentData, patientId, doctorId, planStatus, version: currentVersion, selectedIntent });
      doc.save(`treatment-plan-${patientId || 'patient'}-v${currentVersion}.pdf`);
    } catch (err) {
      setSnackbar({ open: true, message: `Failed to download PDF: ${err.message}`, severity: 'error' });
    }
  };

  const handleClosePdfPreview = () => setPdfPreviewOpen(false);

  const confirmDelete = async () => {
    if (!doctorId || !patientId) { setSnackbar({ open: true, message: 'Missing doctor or patient information', severity: 'error' }); setDeleteDialogOpen(false); return; }
    try {
      setLoading(true);
      const checkUrl = `${API_BASE_URL}hms/users/data/context/get-current-plan/${patientId}/${doctorId}`;
      const checkResponse = await fetch(checkUrl);
      if (!checkResponse.ok && checkResponse.status !== 404) throw new Error(`Failed to check plan: ${checkResponse.status}`);
      const checkResult = await checkResponse.json();
      if (!checkResult.data || checkResponse.status === 404) {
        setTreatmentData(null); setPlanStatus(PLAN_STATUS.DELETED); setIsEditMode(false); setEditableSectionData(null); setSaveCheckboxes({}); setAcceptedSuggestions({}); setExpandedSections({ protocol: true });
        setHistory(prev => [...prev, { data: null, status: PLAN_STATUS.DELETED, timestamp: new Date().toISOString() }]);
        setDeleteDialogOpen(false);
        if (onStatusChange) onStatusChange(PLAN_STATUS.DELETED);
        setSnackbar({ open: true, message: 'Plan deleted successfully', severity: 'success' });
        setLoading(false); return;
      }
      const endpoints = [`${API_BASE_URL}hms/users/data/context/update-plan-status/${patientId}/${doctorId}`];
      let success = false, lastError = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_status: PLAN_STATUS.DELETED }) });
          if (response.ok) { success = true; break; } else { lastError = new Error(`Status ${response.status}`); }
        } catch (err) { lastError = err; }
      }
      if (!success) throw lastError || new Error('All delete endpoints failed');
      setTreatmentData(null); setPlanStatus(PLAN_STATUS.DELETED); setIsEditMode(false); setEditableSectionData(null); setSaveCheckboxes({}); setAcceptedSuggestions({}); setExpandedSections({ protocol: true });
      setHistory(prev => [...prev, { data: null, status: PLAN_STATUS.DELETED, timestamp: new Date().toISOString() }]);
      setDeleteDialogOpen(false);
      if (onStatusChange) onStatusChange(PLAN_STATUS.DELETED);
      setSnackbar({ open: true, message: 'Plan deleted successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: `Failed to delete plan: ${err.message}`, severity: 'error' });
    } finally { setLoading(false); }
  };

  const cancelDelete = () => setDeleteDialogOpen(false);

  const prepareTreatmentPlanForSave = () => {
    if (!treatmentData) return null;
    const currentObjective = selectedIntent !== "no_intent" ? selectedIntent : (treatmentData.intent_alignment?.intent || "symptom_control");
    const finalOutput = {
      processed_treatment_plan: { doctor_content: treatmentData.processed_treatment_plan?.doctor_content || "", ai_enhancement: treatmentData.processed_treatment_plan?.ai_enhancement || null, structured_data: editableSectionData || parseProtocolToStructuredData(treatmentData.processed_treatment_plan?.doctor_content) || {} },
      sections: {},
      intent_alignment: { intent: currentObjective, alignment_status: treatmentData.intent_alignment?.alignment_status || "aligned", misalignment_flag: treatmentData.intent_alignment?.misalignment_flag || "", notes: treatmentData.intent_alignment?.notes || "" },
      clinical_evaluation: treatmentData.evaluation || treatmentData.clinical_evaluation || {}
    };
    if (treatmentData.sections) {
      Object.keys(treatmentData.sections).forEach(sectionKey => {
        const shouldSave = saveCheckboxes[sectionKey];
        const sectionData = treatmentData.sections[sectionKey];
        const acceptedForSection = acceptedSuggestions[sectionKey] || [];
        if (!shouldSave) { finalOutput.sections[sectionKey] = { doctor_content: "", ai_suggestions: null }; return; }
        finalOutput.sections[sectionKey] = { doctor_content: sectionData?.doctor_content || "", ai_suggestions: acceptedForSection.length > 0 ? acceptedForSection.map(s => ({ suggestion: s.text, justification: s.justification })) : null };
      });
    }
    if (saveCheckboxes.misalignment && treatmentData.intent_alignment?.misalignment_flag) finalOutput.intent_alignment.misalignment_flag = treatmentData.intent_alignment.misalignment_flag;
    return {
      status: "success", feature_id: "documentation-treatment-plan", feature_name: "Treatment Plan Generator", display_method: "text",
      patient_id: patientId, doctor_id: { id: doctorId, plan_status: planStatus }, finaloutput: finalOutput, plan_status: planStatus, version: currentVersion,
      metadata: { doctor_id: doctorId, patient_id: patientId, saved_from: "doctor-dashboard", plan_status: planStatus, treatment_intent: selectedIntent !== "no_intent" ? selectedIntent : null, last_modified: new Date().toISOString(), version: currentVersion, structured_format: true }
    };
  };

  const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));

  if (loading || isGeneratingWithIntent) {
    return (
      <Box sx={{ fontFamily: theme.fontFamily, backgroundColor: theme.bgSecondary, minHeight: '100%' }}>
        <Box sx={{ backgroundColor: theme.bg, mb: 2, border: `1px solid ${theme.border}` }}>
          <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em', color: theme.textMuted, mb: 0.5 }}>Clinical Protocol</Typography>
              <Typography sx={{ fontWeight: 300, fontSize: '1.3rem', color: theme.textPrimary, letterSpacing: '-0.02em', fontFamily: theme.fontFamily }}>Treatment Plan</Typography>
            </Box>
          </Box>
          <Box sx={{ height: 1, backgroundColor: theme.border, mx: 2 }} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
          <CircularProgress size={32} thickness={2} sx={{ color: theme.accent, mb: 3 }} />
          <Typography sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.textMuted, mb: 0.75 }}>
            {isGeneratingWithIntent ? `Generating ${selectedIntent} plan` : 'Loading'}
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: theme.textSecondary, fontFamily: theme.fontFamily }}>
            {isGeneratingWithIntent ? `Applying ${selectedIntent} intent to clinical reasoning` : 'Retrieving existing plan from database'}
          </Typography>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ fontFamily: theme.fontFamily, backgroundColor: theme.bgSecondary, minHeight: '100%' }}>
        <Box sx={{ backgroundColor: theme.bg, mb: 2, border: `1px solid ${theme.border}` }}>
          <Box sx={{ p: 2.5 }}>
            <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em', color: theme.textMuted, mb: 0.5 }}>Clinical Protocol</Typography>
            <Typography sx={{ fontWeight: 300, fontSize: '1.3rem', color: theme.textPrimary, letterSpacing: '-0.02em', fontFamily: theme.fontFamily }}>Treatment Plan</Typography>
          </Box>
          <Box sx={{ height: 1, backgroundColor: theme.border, mx: 2 }} />
        </Box>
        <Box sx={{ border: `1px solid ${theme.border}`, borderLeft: `3px solid ${theme.accent}`, p: 2, backgroundColor: theme.bg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontSize: '0.83rem', color: theme.textSecondary, fontFamily: theme.fontFamily }}>{error}</Typography>
          <Button size="small" onClick={() => { setError(null); fetchExistingPlan(); }} startIcon={<RefreshRounded sx={{ fontSize: '0.85rem' }} />}
            sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.borderStrong}`, color: theme.textPrimary, fontFamily: theme.fontFamily }}>
            Retry
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ fontFamily: theme.fontFamily, backgroundColor: theme.bgSecondary, minHeight: '100%' }}>
      {/* Header */}
      <Box sx={{ backgroundColor: theme.bg, mb: 2, border: `1px solid ${theme.border}` }}>
        <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography sx={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em', color: theme.textMuted, mb: 0.5 }}>Clinical Protocol</Typography>
            <Typography sx={{ fontWeight: 300, fontSize: '1.3rem', color: theme.textPrimary, letterSpacing: '-0.02em', fontFamily: theme.fontFamily }}>Treatment Plan</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {history.length > 0 && (
              <Tooltip title="Version History">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.35, border: `1px solid ${theme.border}`, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.textMuted, fontFamily: theme.fontFamily }}>
                  <HistoryRounded sx={{ fontSize: '0.8rem' }} />
                  v{currentVersion}
                </Box>
              </Tooltip>
            )}
          </Box>
        </Box>
        <Box sx={{ height: 1, backgroundColor: theme.border, mx: 2 }} />
      </Box>

      {/* Data Display */}
      {treatmentData !== undefined && (
        <TreatmentPlanData
          treatmentData={treatmentData}
          onContinueClick={handleContinueClick}
          onEditClick={handleEditClick}
          onDeleteClick={handleDeleteClick}
          onSaveClick={handleSaveClick}
          onCancelEdit={handleCancelEdit}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          isEditMode={isEditMode}
          editableSectionData={editableSectionData}
          onFieldChange={handleFieldChange}
          showAiSuggestions={showAiSuggestions}
          setShowAiSuggestions={setShowAiSuggestions}
          saveCheckboxes={saveCheckboxes}
          handleSaveToggle={handleSaveToggle}
          acceptedSuggestions={acceptedSuggestions}
          handleAcceptSuggestion={handleAcceptSuggestion}
          handleDeleteAcceptedSuggestion={handleDeleteAcceptedSuggestion}
          selectedIntent={selectedIntent}
          setSelectedIntent={setSelectedIntent}
          onIntentChange={handleIntentChange}
          planStatus={planStatus}
          onPreviewPdfClick={handlePreviewPdf}
          generatingPdf={generatingPdf}
        />
      )}

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={cancelDelete} aria-labelledby="delete-dialog-title" disableEscapeKeyDown={loading}
        PaperProps={{ sx: { borderRadius: 0, border: `1px solid ${theme.borderStrong}`, boxShadow: 'none', fontFamily: theme.fontFamily } }}>
        <DialogTitle id="delete-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontFamily: theme.fontFamily, fontWeight: 300, fontSize: '1rem', borderBottom: `1px solid ${theme.border}`, pb: 2 }}>
          <WarningRounded sx={{ fontSize: '1rem', color: theme.textPrimary }} />
          Confirm Delete
        </DialogTitle>
        <DialogContent sx={{ pt: 2, pb: 1 }}>
          <DialogContentText sx={{ fontFamily: theme.fontFamily, fontSize: '0.85rem', color: theme.textSecondary }}>
            Are you sure you want to delete this treatment plan? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2.5, gap: 1, borderTop: `1px solid ${theme.border}`, pt: 2 }}>
          <Button onClick={cancelDelete} disabled={loading}
            sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.border}`, color: theme.textSecondary, fontFamily: theme.fontFamily }}>
            Cancel
          </Button>
          <Button onClick={confirmDelete} disabled={loading} startIcon={loading ? <CircularProgress size={14} /> : null}
            sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.borderStrong}`, backgroundColor: theme.accent, color: theme.accentFg, fontFamily: theme.fontFamily, '&:hover': { backgroundColor: theme.textSecondary } }}>
            {loading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* PDF Preview Dialog */}
      <Dialog open={pdfPreviewOpen} onClose={handleClosePdfPreview} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: 0, border: `1px solid ${theme.borderStrong}`, boxShadow: 'none', height: '90vh' } }}>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.border}`, fontFamily: theme.fontFamily, fontWeight: 300, py: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PictureAsPdfRounded sx={{ fontSize: '1.1rem' }} />
            <Typography sx={{ fontFamily: theme.fontFamily, fontSize: '1rem', fontWeight: 300 }}>Treatment Plan — PDF Preview</Typography>
          </Box>
          <IconButton size="small" onClick={handleClosePdfPreview} sx={{ borderRadius: 0 }}>
            <CloseRounded sx={{ fontSize: '1.1rem' }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, height: '100%' }}>
          {pdfPreviewUrl && (
            <iframe src={pdfPreviewUrl} title="Treatment Plan PDF Preview" style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${theme.border}`, px: 2.5, py: 1.5 }}>
          <Button onClick={handleClosePdfPreview}
            sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.border}`, color: theme.textSecondary, fontFamily: theme.fontFamily }}>
            Close
          </Button>
          <Button onClick={handleDownloadPdf} startIcon={<DownloadRounded sx={{ fontSize: '0.85rem' }} />}
            sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderRadius: 0, px: 1.5, py: 0.5, border: `1px solid ${theme.borderStrong}`, backgroundColor: theme.accent, color: theme.accentFg, fontFamily: theme.fontFamily, '&:hover': { backgroundColor: theme.textSecondary } }}>
            Download PDF
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Box sx={{ border: `1px solid ${theme.borderStrong}`, backgroundColor: theme.bg, px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', fontFamily: theme.fontFamily }}>
          <Typography sx={{ fontSize: '0.82rem', color: theme.textSecondary }}>{snackbar.message}</Typography>
          <IconButton size="small" onClick={handleCloseSnackbar} sx={{ borderRadius: 0, p: 0.25 }}><CloseRounded sx={{ fontSize: '0.85rem', color: theme.textMuted }} /></IconButton>
        </Box>
      </Snackbar>
    </Box>
  );
});

// ─── Styles ───
const styles = {
  sectionIconBox: {
    backgroundColor: theme.accent,
    color: theme.accentFg,
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sectionLabelText: {
    fontFamily: theme.fontFamily,
    fontSize: '0.78rem',
    fontWeight: 400,
    color: theme.textPrimary,
    letterSpacing: '-0.01em',
  },
  sectionCard: {
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg,
    transition: 'border-color 0.2s ease',
    '&:hover': { borderColor: theme.borderStrong },
    mb: 1.5,
  },
  sectionCardHeader: {
    px: 2,
    py: 1.25,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.bgSecondary,
    borderBottom: `1px solid ${theme.border}`,
  },
  expandBtn: {
    borderRadius: 0,
    p: 0.5,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg,
    color: theme.textSecondary,
    '&:hover': { backgroundColor: theme.bgTertiary, borderColor: theme.textSecondary },
  },
  misalignmentCard: {
    border: `1px solid ${theme.borderStrong}`,
    borderLeft: `3px solid ${theme.borderStrong}`,
    backgroundColor: theme.bg,
    mb: 1.5,
    transition: 'all 0.2s ease',
  },
  misalignmentHeader: {
    px: 2,
    py: 1.25,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.bgSecondary,
    borderBottom: `1px solid ${theme.border}`,
  },
  evaluationCard: {
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg,
    mb: 1.5,
  },
  evaluationHeader: {
    px: 2,
    py: 1.25,
    borderBottom: `1px solid ${theme.border}`,
    backgroundColor: theme.bgSecondary,
  },
  evaluationItemPaper: {
    p: 1.5,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg,
    transition: 'border-color 0.15s ease',
    '&:hover': { borderColor: theme.borderStrong },
  },
};

export default TreatmentPlan;