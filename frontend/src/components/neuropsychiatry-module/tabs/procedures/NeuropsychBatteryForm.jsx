import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const NeuropsychBatteryForm = () => {
  return (
    <>
      <FormField label="P12 — Neuropsychological Assessment Battery" type="subhead" />
      <FormField k="npReferral" label="Referral Question" type="textarea" full placeholder="e.g., MCI vs depression-related cognitive impairment; capacity; dementia subtyping" />
      <FormField k="npValidity" label="Performance Validity" type="select" options={['Valid', 'Suboptimal effort', 'Invalid — cannot interpret']} />

      <FormField label="Tests Administered — by Domain" type="subhead" />
      <FormField k="npGeneral" label="General Cognition" type="checks" full options={['WAIS-IV', 'RBANS', 'ACE-III', 'MoCA', "Raven's Progressive Matrices", 'None']} />
      <FormField k="npMemory" label="Learning & Memory" type="checks" full options={['WMS-IV', 'RAVLT', 'CVLT-II', 'Rey Complex Figure — recall', 'Logical Memory', 'None']} />
      <FormField k="npAttention" label="Attention / Processing Speed" type="checks" full options={['Trail Making A', 'Digit Symbol', 'Symbol Search', 'Digit Span', 'Stroop', 'None']} />
      <FormField k="npExecutive" label="Executive Function" type="checks" full options={['Trail Making B', 'WCST', 'Verbal Fluency (FAS)', 'Category Fluency', 'Tower Test', 'BADS', 'None']} />
      <FormField k="npLanguage" label="Language" type="checks" full options={['Boston Naming Test', 'Token Test', 'Fluency', 'None']} />
      <FormField k="npVisuospatial" label="Visuospatial" type="checks" full options={['Rey Complex Figure — copy', 'Clock Drawing', 'JLO (line orientation)', 'Block Design', 'None']} />
      <FormField k="npSocial" label="Social Cognition / Emotion" type="checks" full options={['Faces test', 'Theory of mind', 'Reading the Mind in the Eyes', 'None']} />
      <FormField k="npMoodValidity" label="Mood / Effort Measures" type="checks" full options={['BDI-II', 'BAI', 'TOMM', 'Rey 15-item', 'Premorbid (TOPF/NART)', 'None']} />

      <FormField label="Results & Formulation" type="subhead" />
      <FormField k="npScores" label="Key Scores / Standardized Results" type="textarea" full />
      <FormField k="npProfile" label="Cognitive Profile / Pattern of Deficits" type="textarea" full />
      <FormField k="npImpression" label="Impression" type="select" options={['Within normal limits', 'Mild Cognitive Impairment', 'Dementia — Alzheimer type', 'Dementia — frontotemporal', 'Dementia — Lewy body', 'Dementia — vascular', 'Depression-related cognitive impairment (pseudodementia)', 'Functional cognitive disorder', 'Other']} />
      <FormField k="npRecommend" label="Recommendations" type="textarea" full />
    </>
  );
};

export default NeuropsychBatteryForm;
