// Masters: TP hubs, law library, workflow stages, document catalogue, corpus, nav.
/* ---------- New India structure: Suit Claims Hubs (TP hubs), regions, nodal officers — sample names, replace with published lists ---------- */
export const HUBS = {
  'Bengaluru Urban':['Bengaluru TP Hub','Parent','South'],'Mysuru':['Mysuru TP Hub','Child of Bengaluru','South'],'Ernakulam':['Kochi TP Hub','Parent','South'],'Chennai':['Chennai TP Hub','Parent','South'],'Hyderabad':['Hyderabad TP Hub','Parent','South'],
  'South Delhi':['Delhi TP Hub','Parent','North'],'Lucknow':['Lucknow TP Hub','Parent','North'],'Jaipur':['Jaipur TP Hub','Parent','North'],'Hisar':['Hisar TP Hub','Child of Chandigarh','North'],
  'Pune':['Pune TP Hub','Parent','West'],'Nashik':['Nashik TP Hub','Child of Pune','West'],'Thane':['Thane TP Hub','Child of Mumbai','West'],'Nagpur':['Nagpur TP Hub','Parent','West'],'Indore':['Indore TP Hub','Child of Bhopal','West'],'Raipur':['Raipur TP Hub','Parent','West'],
  'Kolkata':['Kolkata TP Hub','Parent','East']
};
export const NODAL = {South:'R. Subramanian, Nodal Officer (Rule 24) — South',North:'A. K. Mehta, Nodal Officer (Rule 24) — North',West:'V. Kulkarni, Nodal Officer (Rule 24) — West',East:'S. Mukherjee, Nodal Officer (Rule 24) — East'};
export const hubOf = c => { const h=HUBS[c.district]||[c.district+' TP Hub','Parent','—']; return {name:h[0],type:h[1],region:h[2],nodal:NODAL[h[2]]||'To be assigned'}; };
export const SURVEYORS = ['M/s Precision Loss Assessors','M/s Veritas Claim Investigators','M/s Apex Surveyors & Investigators','M/s TrueLine Investigations'];
export const DELEGATION = [[2500000,'Designated Officer, TP Hub'],[10000000,'Regional Office — Claims Committee'],[Infinity,'Head Office — TP Claims Committee']];
export const approver = amt => DELEGATION.find(d=>amt<=d[0])[1];

/* ---------- Law library ---------- */
export const LAW = {
  sarla:{t:'Sarla Verma v. Delhi Transport Corporation',c:'(2009) 6 SCC 121',ct:'Supreme Court',h:'Age-based multiplier table; personal-expense deduction by number of dependants.'},
  pranay:{t:'National Insurance Co. Ltd. v. Pranay Sethi',c:'(2017) 16 SCC 680',ct:'Supreme Court · Constitution Bench',h:'Future prospects by age and employment type; fixed conventional heads with periodic enhancement.'},
  magma:{t:'Magma General Insurance Co. Ltd. v. Nanu Ram',c:'(2018) 18 SCC 130',ct:'Supreme Court',h:'Consortium includes spousal, parental and filial consortium.'},
  munna:{t:'Munna Lal Jain v. Vipin Kumar Sharma',c:'(2015) 6 SCC 347',ct:'Supreme Court',h:'Multiplier follows the age of the deceased, not of the dependants.'},
  rajkumar:{t:'Raj Kumar v. Ajay Kumar',c:'(2011) 1 SCC 343',ct:'Supreme Court',h:'Medical (physical) disability differs from functional disability affecting earning capacity.'},
  sidram:{t:'Sidram v. Divisional Manager, United India Insurance Co. Ltd.',c:'(2023) 3 SCC 439',ct:'Supreme Court',h:'Heads of compensation in injury claims; just-compensation principle.'},
  kirti:{t:'Kirti v. Oriental Insurance Co. Ltd.',c:'(2021) 2 SCC 166',ct:'Supreme Court',h:'Notional income for homemakers; future prospects apply to notional income.'},
  kishan:{t:'Kishan Gopal v. Lala',c:'(2014) 1 SCC 244',ct:'Supreme Court',h:'Notional income for non-earning children and students.'},
  swaran:{t:'National Insurance Co. Ltd. v. Swaran Singh',c:'(2004) 3 SCC 297',ct:'Supreme Court',h:'Licence breach must be proved and be fundamental; pay-and-recover remedy.'},
  mukund:{t:'Mukund Dewangan v. Oriental Insurance Co. Ltd.',c:'(2017) 14 SCC 663',ct:'Supreme Court',h:'LMV licence covers transport vehicles of the LMV class (GVW up to 7,500 kg).'},
  rambha:{t:'Bajaj Allianz General Insurance Co. Ltd. v. Rambha Devi',c:'Constitution Bench, 2024',ct:'Supreme Court · Constitution Bench',h:'Affirmed Mukund Dewangan on LMV licence scope.'},
  amrit:{t:'Amrit Paul Singh v. TATA AIG General Insurance Co. Ltd.',c:'(2018) 7 SCC 558',ct:'Supreme Court',h:'Plying without a valid permit is a fundamental breach; insurer pays and recovers from owner.'},
  khenyei:{t:'Khenyei v. New India Assurance Co. Ltd.',c:'(2015) 9 SCC 273',ct:'Supreme Court',h:'Composite negligence: joint and several liability; apportionment between tortfeasors inter se.'},
  jhaveri:{t:'Pramodkumar Rasikbhai Jhaveri v. Karmasey Kunvargi Tak',c:'(2002) 6 SCC 455',ct:'Supreme Court',h:'Contributory negligence requires the victim’s own fault to contribute to the accident.'},
  siddique:{t:'Mohammed Siddique v. National Insurance Co. Ltd.',c:'(2020) 3 SCC 57',ct:'Supreme Court',h:'Triple riding alone does not prove contributory negligence without a causal link.'},
  gohar:{t:'Gohar Mohammed v. Uttar Pradesh SRTC',c:'(2023) 4 SCC 381',ct:'Supreme Court',h:'Directions on DAR-based procedure and time-bound offers by insurers’ designated officers.'}
};
export const STAT = {
  'Policy Intelligence':['MV Act s.147 — requirements of policy','MV Act s.149 — insurer’s duty and permitted defences'],
  'Income Intelligence':['MV Act s.166/168 — just compensation','State minimum-wage notification (benchmark)'],
  'Medical Intelligence':['MV Act s.168 — just compensation','RPwD Act 2016 guidelines for disability assessment'],
  'Case Reconstruction':['Indian Evidence law — contemporaneous records carry greater weight','CMVR DAR procedure (2022) — FAR / IAR / DAR'],
  'Claimant Intelligence':['MV Act s.166(1) — legal representatives','Sarla Verma deduction table'],
  'Claims Integrity':['Internal SOP — anomaly flags need human verification; no adverse inference from a flag alone'],
  'Negligence Engine':['MV Act s.166 — fault liability','Composite vs contributory negligence doctrine'],
  'Liability Engine':['MV Act s.164 — no-fault liability: ₹5 lakh on death, ₹2.5 lakh on grievous hurt','Claimant need not plead or prove negligence'],
  'DAR Verification':['Gohar Mohammed directions — surveyor verification within 20 days of DAR','Disputed DAR: surveyor report to Deputy Commissioner of Police'],
  'Settlement Intelligence':['LSA Act 1987 s.20 — reference to Lok Adalat','s.21 — award deemed decree, final, no appeal']
};

/* ---------- Workflow stages (New India TP hub roles) ---------- */
export const STAGES = [
 {n:'Court intimation',own:'System · eCourts sync',sla:'T+0',trig:'Claim petition / FAR / notice listed against the company (CNR matched on policy or vehicle)',auto:['Parse petition, FAR and notice','Match policy no. / vehicle reg. to policy admin','Route to TP hub by tribunal location','Start statutory clocks (WS, DAR, offer)'],ai:['Document Intelligence'],exit:'Case record created, matched to policy and routed to a TP hub'},
 {n:'Registered & assigned',own:'TP Hub in-charge (Suit Claims Hub)',sla:'1 day',trig:'Case created',auto:['Assign Designated Officer (Rule 23) and panel advocate','Tag regional Nodal Officer (Rule 24)','Initial reserve from similar-case model','Vakalatnama & appearance task'],ai:['Portfolio Intelligence'],exit:'DO, advocate, nodal officer and initial reserve set'},
 {n:'Document auto-collection',own:'System · connectors',sla:'7 days',trig:'Assignment done',auto:['FIR / IAR / DAR (police portal)','RC, permit, fitness (vehicle registry)','DL (licence registry)','Policy & endorsements (policy admin)','Consent requests: bank (account aggregator), ITR','Hospital records request'],ai:['Document Intelligence'],exit:'At least 80% of documents received; the rest formally requested'},
 {n:'AI extraction & evidence graph',own:'System · AI',sla:'2 hours',trig:'Documents received',auto:['OCR + layout parsing','Entity extraction into evidence graph','Timeline reconstruction & conflict detection'],ai:['Document Intelligence','Case Reconstruction','Medical Intelligence','Income Intelligence','Claims Integrity'],exit:'Evidence graph complete; findings generated'},
 {n:'DAR verification (surveyor)',own:'Panel surveyor / investigator',sla:'20 days from DAR',trig:'DAR (Form VII) received',auto:['Appoint surveyor from panel','Verification checklist: vehicle, driver, policy, victim, site plan (Form VIII), MVI (Form IX), verification report (Form X)','If DAR disputed: surveyor report to Deputy Commissioner of Police'],ai:['Case Reconstruction','Claims Integrity'],exit:'DAR accepted, or disputed with surveyor report sent to DCP; all findings decided'},
 {n:'Coverage & liability review',own:'Designated Officer',sla:'5 days',trig:'Surveyor report received',auto:['Coverage matrix','Negligence & contributory analysis','Recovery-right detection','Local Commissioner cost flag if liability disputed'],ai:['Policy Intelligence','Liability Engine','Negligence Engine'],exit:'All coverage and liability findings accepted, modified or rejected'},
 {n:'Quantum assessment',own:'Designated Officer',sla:'3 days',trig:'Liability reviewed',auto:['Deterministic compensation engine (4 scenarios)','Reserve revision proposal','Interest accrual'],ai:['Compensation Engine','Precedent Engine'],exit:'Officer-approved quantum range and reserve'},
 {n:'Form XI offer / settlement decision',own:'Designated Officer (Rule 23)',sla:'30 days from DAR',trig:'Quantum approved',auto:['Form XI offer with reasons, from approved scenario','Approval routed by delegation of powers','Nodal Officer alert if the 30-day window is at risk'],ai:['Settlement Intelligence'],exit:'Form XI filed before tribunal, or decision to contest recorded'},
 {n:'Written statement',own:'Panel advocate',sla:'30 days from notice',trig:'Offer rejected, not accepted, or contest decided',auto:['Written statement with cited defences (no s.166(3) time-bar plea)','Document requisition list'],ai:['Legal Intelligence','Litigation Intelligence'],exit:'WS filed; copy uploaded'},
 {n:'Evidence & cross-examination',own:'Panel advocate',sla:'Per court',trig:'Issues framed',auto:['Cross-examination questions from contradictions','Witness & exhibit tracker','Local Commissioner fee provision where liability is disputed'],ai:['Litigation Intelligence','Claims Integrity'],exit:'Evidence closed'},
  {n:'Lok Adalat settlement',own:'Designated Officer',sla:'Per sitting',trig:'AI identification, DLSA / SLSA referral list, or consent of parties (s.20)',auto:['Fitness score and conditions','Negotiation band: opening, target, ceiling','Pre-sitting mandate by delegation of powers','Joint memo of compromise with apportionment','Sitting-day console','Award (s.21) → 30-day payment clock'],ai:['Settlement Intelligence','Compensation Engine','Claims Integrity'],exit:'Lok Adalat award passed, or returned to tribunal (no prejudice)'},
 {n:'Arguments',own:'Panel advocate',sla:'Per court',trig:'Evidence closed',auto:['Written arguments with authorities'],ai:['Legal Intelligence'],exit:'Reserved for award'},
 {n:'Award analysis',own:'Regional Office — legal',sla:'7 days from award',trig:'Award uploaded / pronounced',auto:['Award extraction','Tribunal vs insurer head-by-head diff','Appeal-issue report'],ai:['Award Analysis','Legal Intelligence'],exit:'Appeal / comply decision proposed'},
 {n:'Appeal decision',own:'RO / HO legal (per delegation)',sla:'90 days (s.173)',trig:'Appeal report ready',auto:['Cost–benefit of appeal','Draft grounds','Statutory deposit computation'],ai:['Appeal Intelligence'],exit:'Appeal filed or compliance approved'},
 {n:'Payment / deposit',own:'Finance (TP hub accounts)',sla:'30 days from award or record of settlement',trig:'Compliance approved or settlement recorded',auto:['Interest to date of deposit','Payment voucher & UTR capture'],ai:['Interest & Delay Engine'],exit:'Deposit confirmed by tribunal'},
 {n:'Recovery',own:'TP hub recovery desk',sla:'Ongoing',trig:'Pay-and-recover order',auto:['Recovery notice','Execution petition tracker'],ai:['Recovery Intelligence'],exit:'Recovered or written off'},
 {n:'Closed',own:'System',sla:'—',trig:'Disbursal / settlement / withdrawal recorded',auto:['Archive with immutable audit log','Feed outcome back to precedent corpus'],ai:['Portfolio Intelligence'],exit:'—'}
];
export const ENGINES = ['Document Intelligence','Case Reconstruction','Policy Intelligence','Liability Engine','Negligence Engine','Claimant Intelligence','Medical Intelligence','Income Intelligence','Compensation Engine','Legal Intelligence','Precedent Engine','Claims Integrity','Litigation Intelligence','Settlement Intelligence','Portfolio Intelligence'];

/* ---------- Document catalogue (auto-collection map) ---------- */
export const DOCS = [
 ['Claim petition','eCourts','API','court'],['Notice / summons','eCourts','API','court'],
 ['FIR','Police portal (CCTNS)','API','auto'],['Detailed Accident Report (DAR)','Police eDAR','API','auto'],['Site plan','Police eDAR','API','auto'],['Mechanical inspection report','Police eDAR','API','auto'],['Charge sheet','eCourts (criminal)','API','auto'],
 ['Insurance policy & endorsements','Policy admin (internal)','Internal','auto'],['Registration certificate','Vehicle registry','API','auto'],['Driving licence','Licence registry','API','auto'],
 ['Permit','Vehicle registry','API','auto','commercial'],['Fitness certificate','Vehicle registry','API','auto','commercial'],
 ['MLC','Hospital','Request','claimant'],['Discharge summary / IP records','Hospital','Request','claimant'],['Medical bills','Claimant','Upload','claimant'],
 ['Post-mortem report','Police eDAR','API','auto','death'],['Death certificate','Civil registration','API','auto','death'],['Disability certificate','Medical board','Request','claimant','injury'],
 ['Income proof (salary / ITR / Form 16)','Claimant / consent','Consent','claimant'],['Bank statements (12 months)','Account aggregator','Consent','claimant'],
 ['Legal heir / dependency proof','Claimant','Upload','claimant','death'],['Identity (masked)','Claimant','Upload','claimant'],
 ['Written statement','Panel advocate','Upload','ws'],['Depositions','eCourts','API','evid'],['Award','eCourts','API','award']
];

/* ---------- Similar-case corpus (portfolio awards, sample) ---------- */
export const CORPUS = [
 {id:'AWD-KA-2024-118',st:'Karnataka',type:'Death',age:40,occ:'driver',inc:24000,deps:4,award:5840000,mult:15,fp:'40%',neg:'Insured vehicle 100%',yr:2024},
 {id:'AWD-KA-2025-041',st:'Karnataka',type:'Death',age:44,occ:'driver',inc:26000,deps:3,award:5210000,mult:14,fp:'25%',neg:'Insured 90% · victim 10% (no helmet)',yr:2025},
 {id:'AWD-TN-2023-207',st:'Tamil Nadu',type:'Death',age:36,occ:'teacher',inc:55000,deps:5,award:11020000,mult:15,fp:'50%',neg:'Insured 100%',yr:2023},
 {id:'AWD-DL-2025-066',st:'Delhi',type:'Death',age:23,occ:'delivery',inc:19000,deps:2,award:3120000,mult:18,fp:'40%',neg:'Insured 100%; pay & recover (permit)',yr:2025},
 {id:'AWD-MH-2024-311',st:'Maharashtra',type:'Injury',age:49,occ:'farmer',inc:17500,dis:15,award:1460000,mult:13,fp:'25%',neg:'Insured 85%',yr:2024},
 {id:'AWD-KL-2025-090',st:'Kerala',type:'Injury',age:31,occ:'engineer',inc:128000,dis:8,award:2380000,mult:16,fp:'50%',neg:'Insured 100%',yr:2025},
 {id:'AWD-RJ-2024-155',st:'Rajasthan',type:'Injury',age:36,occ:'driver',inc:16000,dis:100,award:5390000,mult:15,fp:'40%',neg:'Insured 100%',yr:2024},
 {id:'AWD-UP-2025-022',st:'Uttar Pradesh',type:'Death',age:55,occ:'homemaker',inc:10000,deps:2,award:1320000,mult:11,fp:'10%',neg:'Insured 100%',yr:2025},
 {id:'AWD-WB-2024-078',st:'West Bengal',type:'Death',age:26,occ:'private',inc:15000,deps:2,award:2740000,mult:17,fp:'40%',neg:'Insured 100%',yr:2024},
 {id:'AWD-MP-2025-133',st:'Madhya Pradesh',type:'Injury',age:47,occ:'shop',inc:30000,dis:20,award:2210000,mult:13,fp:'25%',neg:'Composite 60:40',yr:2025}
];


export const CONNECTORS=[['eCourts (CNR / cause list / orders)','Petitions, next dates, orders, awards','Live'],['Police portal & eDAR','FIR, FAR, DAR, site plan, MVI, post-mortem','Live'],['Vehicle registry','RC, permit, fitness, pollution history','Live'],['Licence registry','DL class, validity, endorsements','Live'],['Policy admin (internal)','Policy, endorsements, premium receipt','Live'],['Account aggregator','Bank statements with claimant consent','Consent'],['Income tax (ITR / Form 16)','Claimant consent or court direction','Consent'],['Hospitals','MLC, IP records, bills — request & upload','Request'],['Legal Services Authorities (NALSA / SLSA / DLSA)','Lok Adalat calendars, referral lists, awards','Live'],['Finance / payments','Deposit vouchers, UTR','Live'],['Legal management','Advocate diary, fee bills','Live']];
export const EVENTMAP=[['FAR / notice issued to insurer','→ 00 Court intimation; routed to TP hub; WS clock T+30'],['DAR (Form VII) received','→ 04 surveyor clock T+20; Form XI clock T+30'],['Surveyor report — DAR accepted','→ 05 Coverage & liability review'],['Surveyor report — DAR disputed','Report to DCP; case continues with dispute flag'],['Form XI accepted by claimant','Record of settlement; deposit clock T+30'],['Form XI rejected by claimant','Inquiry limited to enhancement; floor = offered amount'],['Issues framed','Court stage updated; cross-exam pack generated'],['Referred to Lok Adalat (s.20)','→ 10 Lok Adalat; fitness score, band and mandate request prepared'],['Lok Adalat award (s.21)','→ 14 Payment; 30-day clock; apportionment and minors’ FD'],['Not settled at Lok Adalat','Returned to tribunal without prejudice; can be re-listed'],['Evidence closed','→ 11 Arguments'],['Award pronounced / uploaded','→ 12 Award analysis; limitation T+90'],['Appeal admitted / stay granted','→ 13 Appeal; interest exposure recalculated'],['Deposit confirmed','→ 14 Payment; disbursal tracked'],['Execution petition filed','→ 15 Recovery'],['Disposed / withdrawn','→ 16 Closed; outcome fed to corpus']];
export const NAV = [
 ['Operate',[['dashboard','Command centre'],['sync','Court & connector sync'],['cases','Case register'],['diary','Hearing diary']]],
 ['Decide',[['lokadalat','Lok Adalat'],['settle','Settlement desk'],['awards','Awards & appeals'],['recovery','Recovery'],['integrity','Claims integrity']]],
 ['Analyse',[['mis','MIS reports'],['ask','Ask the portfolio']]],
 ['Configure',[['workflow','Workflow designer'],['rules','Rules & masters'],['dev','Developer hand-off']]]
];


/* ---------- Integrity view sample data (replace with API later) ---------- */
export const RECURRING = [
  ['Lifeline Nursing Home, Kasba', 'Hospital', 4],
  ['Adv. T. Das', 'Claimant advocate', 4],
  ['Bapi Mondal', 'Witness', 4],
  ['Dr. A. Kulkarni', 'Disability board signatory', 7],
];
export const INTEGRITY_CHECKS = [
  'Duplicate claimant / accident across insurers',
  'Duplicate or template-matched bills',
  'Policy incepted shortly before accident',
  'Delayed FIR or delayed admission',
  'Income certificate issued after accident',
  'Disability not supported by contemporaneous records',
  'PDF metadata, font and overwrite forensics',
  'Recurring hospital–advocate–witness clusters',
];


/* ---------- Gates, roles and guardrails (sample config — replace with API later) ---------- */
export const GATED_STAGES = [4, 5, 6, 7, 13];
export const ROLES = [
  ['Admin', 'All modules, masters, audit'],
  ['TP Hub in-charge (Suit Claims Hub)', 'Assignment, reserves, all cases of the hub and its child hubs'],
  ['Designated Officer (Rule 23)', 'Assigned cases; decide findings; file Form XI within delegated powers'],
  ['Nodal Officer (Rule 24)', 'Regional escalations; statutory-clock breaches; liaison with police and tribunals'],
  ['Panel surveyor / investigator', 'DAR verification; upload report; no access to reserves'],
  ['Panel advocate', 'Assigned cases; drafts; no reserves'],
  ['Regional / Head Office legal', 'Award analysis, appeal decisions, rule-set approval'],
  ['Finance (hub accounts)', 'Deposits, UTRs, recovery ledger'],
  ['Auditor', 'Read-only; audit trail'],
];
export const GUARDRAILS = [
  ['No s.166(3) time-bar plea', 'Supreme Court interim order (Nov 2025): no claim to be dismissed as time-barred. The drafting engine never generates this defence.'],
  ['Surveyor verification within 20 days of DAR', 'Disputed DAR: surveyor report goes to the Deputy Commissioner of Police.'],
  ['Form XI within 30 days of DAR, with reasons', 'Nodal Officer alerted 7 days before the window closes.'],
  ['Deposit within 30 days of record of settlement', 'Tracked on the payment stage and SLA report.'],
  ['Rejected offer: enhancement-only inquiry', 'The offered amount becomes the floor in all scenarios.'],
  ['Local Commissioner fees', 'Borne by the insurer when it disputes liability; provisioned in the defend scenarios.'],
    ['Lok Adalat only on compromise', 'No award without the consent of all claimants (s.20; Jalour Singh). Settlement above the approved mandate is blocked.'],
  ['Lok Adalat award payment', 'Paid within 30 days of the award; minors’ share to fixed deposit until majority.'],['Anomaly flags', 'Verification prompts only; no adverse inference from a flag alone.'],
];import { R, TODAY } from "../data/rules.js";