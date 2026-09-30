import re

file_path = r'c:\drassist changes\27-08-2026\nephrology-module\NephrologyWorkflow.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

render_content_code = """  const renderContent = () => {
    if (activeTab === "proc_hd") return <HemodialysisGuide />;
    if (activeTab === "proc_avf") return <AVFistulaGuide />;
    if (activeTab === "proc_tx") return <TransplantGuide />;
    const historyProps = { sessions: historicalSessions, currentSessionId: sessionId, onOpenEncounter: selectEncounter };
    if (activeTab === "inpatient_dashboard") return <InpatientDashboardTab historyProps={historyProps} />;

    if (track === "intake_baseline") {
      switch (activeTab) {
        case "onboarding": return <OnboardingTab />;
        case "profile": return <ProfileBaselineTab />;
        case "screening": return <ScreeningAlertsTab />;
        default: return <OnboardingTab />;
      }
    } else if (track === "diagnostics") {
      switch (activeTab) {
        case "planner": return <PlannerTab />;
        case "urine_intel": return <UrineIntelTab />;
        case "biopsy_gn": return <BiopsyGNTab />;
        default: return <PlannerTab />;
      }
    } else if (track === "aki_hosp") {
      switch (activeTab) {
        case "classification": return <ClassificationTab historyProps={historyProps} />;
        case "cause_engine": return <CauseEngineTab historyProps={historyProps} />;
        case "aki_management": return <AkiManagementTab historyProps={historyProps} />;
        default: return <ClassificationTab historyProps={historyProps} />;
      }
    } else if (track === "ckd_mgmt") {
      switch (activeTab) {
        case "overview": return <OverviewTab historyProps={historyProps} />;
        case "progression": return <ProgressionTab historyProps={historyProps} />;
        case "htn_diabetes": return <HtnDiabetesTab historyProps={historyProps} />;
        case "complication_engine": return <ComplicationEngineTab historyProps={historyProps} />;
        case "ckd_meds": return <CkdMedicationsTab historyProps={historyProps} />;
        default: return <ProgressionTab />;
      }
    } else if (track === "decision_support") {
      switch (activeTab) {
        case "nephrotoxicity": return <NephrotoxicityTab />;
        case "what_changed": return <WhatChangedTab />;
        case "what_next": return <WhatNextTab />;
        default: return <NephrotoxicityTab />;
      }
    } else if (track === "dialysis_rrt") {
      switch (activeTab) {
        case "decision": return <DecisionTab historyProps={historyProps} />;
        case "access": return <AccessTab historyProps={historyProps} />;
        case "delivery": return <DeliveryTab historyProps={historyProps} />;
        case "pd_home": return <PdHomeTab historyProps={historyProps} />;
        case "adequacy_review": return <AdequacyReviewTab historyProps={historyProps} />;
        default: return <DecisionTab historyProps={historyProps} />;
      }
    } else if (track === "transplant") {
      switch (activeTab) {
        case "pre_tx": return <PreTxTab />;
        case "donor_eligibility": return <DonorEligibilityTab />;
        case "immuno": return <ImmunoTab />;
        case "post_tx": return <PostTxTab />;
        default: return <PreTxTab />;
      }
    } else if (track === "longitudinal_ops") {
      switch (activeTab) {
        case "discharge": return <DischargeTab />;
        case "post_discharge": return <PostDischargeTab />;
        case "timeline": return <TimelineTab />;
        case "digital_twin": return <DigitalTwinTab />;
        case "analytics": return <AnalyticsTab />;
        default: return <DischargeTab />;
      }
    }

    // We will replace these with actual imports step-by-step
    return <TabPlaceholder title={`${track.toUpperCase()} - ${activeTab.toUpperCase()}`} />;
  };"""

new_content = re.sub(r'  const renderContent = \(\) => \{.*?(?=  let navItems =)', render_content_code + '\n\n', content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)
print('Done!')
