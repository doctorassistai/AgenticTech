import { useState, useEffect, useRef, useMemo } from 'react'
import React from 'react'
import MultiSelectDropdown from "../components/MultiSelectDropdown";
import { useNavigate, useSearchParams } from "react-router-dom";
import InsurerSection from "../components/case/InsurerSection"
import ClaimantSection from "../components/case/ClaimantSection"
import ClaimSection from "../components/case/ClaimSection"
import AssignmentSection from "../components/case/AssignmentSection"
import CaseDocumentUpload from "../components/case/CaseDocumentUpload"

import {
  normalizeDate,
  parseDate,
  isValidNormalizedDate,
  normalizeDatesForForm,   // ← add
  isoToDMY,                // ← add
} from "../components/case/utils"

const SLA_RULES = {
  cashless: 6,   // 6 hours
  default:  72,  // 3 days
}

const SECTION_WEIGHTS = {
  insurer: 15,
  claimant: 20,
  claim: 40,
  assignment: 25,
}

const SECTIONS = [
  { id: 'insurer',    label: 'Insurer Details',  color: 'var(--accent)' },
  { id: 'claimant',  label: 'Claimant Info',     color: 'var(--purple)' },
  { id: 'claim',     label: 'Claim Details',     color: 'var(--amber)'  },
  { id: 'assignment', label: 'Assignment',        color: 'var(--green)'  },
]

const REQUIRED = {
  insurer: ['insurer', 'policyNumber', 'insurerRef', 'policyDetails.coverageType'],
  claimant: ['claimantName', 'claimantMobile', 'pinCode'],
  claim: ['claimMode', 'claimSubtype', 'claimTriggers'],
  assignment: ['targetDate'],
}

const FIELD_VALIDATORS = {
  claimantMobile: v => (!v || v.length !== 10) ? 'Must be exactly 10 digits' : null,
  pinCode:        v => (!v || v.length !== 6)  ? 'Must be exactly 6 digits'  : null,
  claimedAmount:  v => (Number(v) < 0)         ? 'Cannot be negative'        : null,
}

const BLANK_FORM = {
  insurer: '', policyNumber: '', policyType: 'Individual', insurerRef: '',tpaName: '',
  insurerContact: '', insurerContactInfo: '',
  claimantName: '', claimantMobile: '', altContact: '', claimantAge: '',
  relationship: 'Self', idProofType: 'Aadhaar Card', idProofNumber: '',
  claimantAddress: '', city: '', district: '', pinCode: '',
  claimMode: '', claimSubtype: '', tags: [], claimTriggers: [], description: '',
  dateOfIncident: '', dateOfIntimation: '', claimedAmount: '', sumInsured: '',
  claimPriority: 'Normal',
  investigations: { MV: [], HV: [], HVI: [], DIGI: [], TRIGGER: [] },
  accidentDetails: {
    dateTime: '', place: '', spotOfAccident: '', witness: '', witnessAddress: '',
    witnessStatement: '', broughtBy: '', broughtByNumber: '', broughtByAddress: '',
    broughtByStatement: '', firstAidHospital: '', firstAidDetails: '',
    fcpCollected: false, opCardCollected: false, patientNarration: '',
    helmetWorn: '', seatbeltWorn: '', vehicleDamagePercentage: '',
    vehicleType: '', policeReported: '', policeStation: '', firNumber: '', mlcNumber: ''
  },
  deathDetails: {
    date: '', time: '', reason: '', place: '', spotOfDeath: '', witness: '',
    witnessAddress: '', witnessStatement: '', broughtBy: '', broughtByNumber: '',
    broughtByAddress: '', broughtByStatement: '', incidentNarration: '',
    psychiatricHistory: '', depressionHistory: '', suicidalHistory: '',
    alcoholHistory: '', beneficiaryName: '', beneficiaryRelationship: '',
    beneficiaryStatement: '', postmortem: '', postmortemReport: '', claimDocumentRef: ''
  },
  criticalDetails: { diagnosis: '', stage: '', treatingDoctor: '', prognosis: '' },
  reimbursementDetails: { bankDetails: '', accountName: '', ifsc: '' },
  policyDetails: { startDate: '', endDate: '', coverageType: '', roomRentLimit: '', preExistingDisease: '' },
  cashlessDetails: { admissionType: '', estimatedCost: '', preAuthDetails: '', tpaName: '' },
  hospitalDetails: {
    name: '', address: '', type: '', doctorName: '', hospitalEmail: '',
    hospitalContactNumber: '', admissionDate: '', dischargeDate: '', city: '', department: ''
  },
  locationDetails: { incidentLocation: '', hospitalLocation: '' },
  claimSource: '', slaCategory: '', targetDate: '', assignmentNotes: '',
  billingDetails: {
  finalBillAmount: '',
  discountAmount: '',
  roomType: '',
  tariffType: ''
},
criticalDetails: {
  diagnosis: '',
  procedure: '',
  implants: '',
  surgeryDate: '',
  treatingDoctor: '',
  prognosis: ''
},
additionalMedicalDetails: {
  diagnosisSummary: '',
  chiefComplaints: '',
  pastHistory: '',
  generalExamination: '',
  localExamination: '',
  vitals: '',
  investigatorHospitalOpinion: '',
  investigatorMemberOpinion: '',
  firstConsultationDate: '',
},
railwayDetails: {
  incidentDate: '', incidentTime: '', stationNear: '', trainNumber: '',
  trainName: '', coachNumber: '', panchanama: false, witnessName: '',
  witnessAddress: '', witnessStatement: '', spotPhotos: false, spotVideos: false,
  policeReported: '', firNumber: '', mlcNumber: '', narration: '',
},

investigationDetails: {
  investigatorName: '',
  investigatorDesignation: '',
  dataCollectedFrom: '',
},

medicalStaff: {
  pathologistName: '',
  pathologistDesignation: '',
  pathologistRegNo: '',
  radiologistName: '',
  radiologistDesignation: '',
  radiologistRegNo: '',
},
claimantHousePincode: '',
hospitalPincode: '',
}

const getValue = (obj, path) =>
  path.split('.').reduce((o, key) => o?.[key], obj)

function unflattenExtracted(flat) {
  const result = {}
  for (const [key, value] of Object.entries(flat)) {
    if (value === null || value === undefined) continue
    const parts = key.split('.')
    if (parts.length === 1) {
      result[key] = value
    } else {
      const [parent, child] = parts
      if (!result[parent]) result[parent] = {}
      result[parent][child] = value
    }
  }
  return result
}

export default function NewCase() {
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()
  const editCaseId    = searchParams.get('edit')
  const isEditMode    = !!editCaseId

  const [autoPriority, setAutoPriority]       = useState(true)
  const [autoTargetDate, setAutoTargetDate]   = useState(true)
  const [fieldErrors, setFieldErrors]         = useState({})
  const [investigatorsList, setInvestigatorsList] = useState([])
  const [loadingInvestigators, setLoadingInvestigators] = useState(true)
  const [loadingCase, setLoadingCase]         = useState(isEditMode)
  const [loadError, setLoadError]             = useState(null)
  const [caseStatus, setCaseStatus]           = useState(null)
  const [saving, setSaving]                   = useState(false)
  const [saveSuccess, setSaveSuccess]         = useState(false)
  const [extractedSuggestions, setExtractedSuggestions] = useState({})
  

  const BASE_URL = import.meta.env.VITE_BACKEND_URL

  const insurerRef    = useRef(null)
  const claimantRef   = useRef(null)
  const claimRef      = useRef(null)
  const assignmentRef = useRef(null)

  const sectionRefs = {
    insurer:    insurerRef,
    claimant:   claimantRef,
    claim:      claimRef,
    assignment: assignmentRef,
  }

  const [caseId, setCaseId]     = useState(isEditMode ? editCaseId : null)
  const [formData, setFormData] = useState(BLANK_FORM)

  function deepMergeAll(base, patch) {
    if (!patch || typeof patch !== 'object') return base
    const result = { ...base }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      if (
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        typeof result[k] === 'object' && result[k] !== null && !Array.isArray(result[k])
      ) {
        result[k] = deepMergeAll(result[k], v)
      } else {
        result[k] = v
      }
    }
    return result
  }

  // ── Load existing case ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isEditMode) return
    setLoadingCase(true)
    setLoadError(null)

    fetch(`${BASE_URL.replace(/\/$/, '')}/insurance/web/cases/${editCaseId}`)
      .then(r => {
        if (!r.ok) throw new Error(`Case not found (${r.status})`)
        return r.json()
      })
      .then(async claimData => {
        const status = claimData.status || 'DRAFT'
        setCaseStatus(status)

        if (status === 'DRAFT') {
          try {
            const docRes = await fetch(
              `${BASE_URL.replace(/\/$/, '')}/insurance/web/case-documents/${editCaseId}`,
              { headers: { 'X-User-Id': 'web-user', 'X-User-Role': 'supervisor' } }
            )
            if (!docRes.ok) throw new Error('No case documents found')
            const docData  = await docRes.json()
            const mergedRaw = docData.merged_extracted_data || {}
            const unflat   = unflattenExtracted(mergedRaw)
            const DROPDOWN_ONLY = ['insurer', 'claimMode', 'claimSubtype', 'tags']
            DROPDOWN_ONLY.forEach(k => delete unflat[k])
            const merged   = deepMergeAll(BLANK_FORM, unflat)
            merged.claimTriggers = claimData.claimTriggers || []
            const normalized = normalizeDatesForForm(merged)
            normalized.investigations = {
  MV: [], HV: [], HVI: [], DIGI: [], TRIGGER: [],
  ...(claimData.investigations || normalized.investigations || {}),
}
            setFormData(normalized)
            setAutoPriority(true)
            setAutoTargetDate(true)
          } catch (docErr) {
            console.warn('No case_documents for draft:', docErr.message)
            setFormData(BLANK_FORM)
          }
        } else {
          const merged     = deepMergeAll(BLANK_FORM, claimData)
          const normalized = normalizeDatesForForm(merged)
          if (claimData.dateOfIncident)   normalized.dateOfIncident   = isoToDMY(claimData.dateOfIncident)
          if (claimData.dateOfIntimation) normalized.dateOfIntimation = isoToDMY(claimData.dateOfIntimation)
          if (claimData.targetDate) normalized.targetDate = claimData.targetDate
          normalized.investigations = {
            MV: [], HV: [], HVI: [], TELE: [], BILL: [], TRIGGER: [],
            ...(claimData.investigations || {}),
          }
          setFormData(normalized)
          setAutoPriority(false)
          setAutoTargetDate(false)
        }
      })
      .catch(err => setLoadError(err.message || 'Failed to load case'))
      .finally(() => setLoadingCase(false))
  }, [editCaseId, isEditMode])
  useEffect(() => {
  const handler = (e) => {
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}, [])

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (FIELD_VALIDATORS[field]) {
      const err = FIELD_VALIDATORS[field](value)
      setFieldErrors(prev => ({ ...prev, [field]: err }))
    }
  }

  // ── Risk score ──────────────────────────────────────────────────────────
  const riskScore = useMemo(() => {
    let score = 0
    if (Number(formData.claimedAmount) > 500000) score += 30
    if (formData.dateOfIncident && formData.dateOfIntimation) {
      const diffDays =
        (parseDate(formData.dateOfIntimation) - parseDate(formData.dateOfIncident)) /
        (1000 * 60 * 60 * 24)
      if (diffDays > 3) score += 20
    }
    if ((formData.tags || []).includes('Accident')) score += 20
    if ((formData.tags || []).includes('Death'))    score += 40
    if (!formData.claimantAddress)                  score += 10
    return score
  }, [formData.claimedAmount, formData.dateOfIncident, formData.dateOfIntimation, formData.claimantAddress, formData.tags])

  const riskLabel = useMemo(() => {
    if (riskScore >= 60) return "🔴 Critical"
    if (riskScore >= 40) return "🟠 High"
    if (riskScore >= 20) return "🟡 Medium"
    return "🟢 Low"
  }, [riskScore])

  useEffect(() => {
    if (!autoPriority) return
    let priority = 'Normal'
    if (riskScore >= 60) priority = 'Critical'
    else if (riskScore >= 40) priority = 'Urgent'
    else if (riskScore >= 20) priority = 'High'
    setFormData(prev => ({ ...prev, claimPriority: priority }))
  }, [riskScore, autoPriority])
const getUnfilledFields = () => {
  const unfilled = new Set()
  Object.entries(REQUIRED).forEach(([, fields]) => {
    fields.forEach(f => {
      const v = getValue(formData, f)
      if (v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0)) {
        unfilled.add(f)
      }
    })
  })
  return unfilled
}
const [submitAttempted, setSubmitAttempted] = useState(false)

  useEffect(() => {
    const fetchFieldOfficers = async () => {
      try {
        const response = await fetch(`https://doctorassist.ai//api/insurance/api/hms/users/field-officers`)
        const data = await response.json()
        const officerNames = (data.data || []).map(officer => ({
          id: officer.sys_user_id,
          name: officer.full_name,
          sys_user_id: officer.sys_user_id,
          _id: officer._id,
          ...officer
        }))
        setInvestigatorsList(officerNames)
      } catch (error) {
        console.error("Error fetching field officers:", error)
        setInvestigatorsList([])
      } finally {
        setLoadingInvestigators(false)
      }
    }
    fetchFieldOfficers()
  }, [BASE_URL])



  useEffect(() => {
  if (!autoTargetDate) return

  const now = new Date()
  let target

  if (formData.claimMode === 'cashless') {
    target = new Date(now.getTime() + 6 * 3_600_000)
  } else {
    target = new Date(now)
    target.setDate(target.getDate() + 3)
    target.setHours(23, 59, 0, 0)
  }

  const dd   = String(target.getDate()).padStart(2, '0')
  const mm   = String(target.getMonth() + 1).padStart(2, '0')
  const yyyy = target.getFullYear()
  const hh   = String(target.getHours()).padStart(2, '0')
  const min  = String(target.getMinutes()).padStart(2, '0')

  setFormData(prev => ({ ...prev, targetDate: `${dd}/${mm}/${yyyy} ${hh}:${min}` }))
}, [formData.claimMode, autoTargetDate])

  // ── Section progress ────────────────────────────────────────────────────
  const sectionProgress = (sectionId) => {
    const required = REQUIRED[sectionId]
    if (!required.length) return 100
    const filled = required.filter(f => {
      if (f === 'investigations') {
        return Object.values(formData.investigations || {})
          .some(arr => arr.some(a => a.investigatorId?.trim()))
      }
      const v = getValue(formData, f)
      return v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
    })
    return Math.round((filled.length / required.length) * 100)
  }

  const totalProgress = () => {
    let total = 0
    Object.keys(REQUIRED).forEach(section => {
      total += (sectionProgress(section) * SECTION_WEIGHTS[section]) / 100
    })
    return Math.round(total)
  }

  const scrollTo = (id) => {
    sectionRefs[id]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Submit checks ───────────────────────────────────────────────────────
const SUBMIT_CHECKS = [
  {
    id: 'allFilled',
    label: 'Fill all required fields',
    check: (formData) => Object.entries(REQUIRED).every(([, fields]) =>
      fields.every(f => {
        const v = getValue(formData, f)
        return v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
      })
    ),
  },
  { id: 'mobileLength', label: 'Primary mobile must be exactly 10 digits', check: (fd) => !fd.claimantMobile || fd.claimantMobile.length === 10 },
  { id: 'pinLength', label: 'PIN code must be exactly 6 digits', check: (fd) => !fd.pinCode || fd.pinCode.length === 6 },
]

  const getFailingCheck = () => SUBMIT_CHECKS.find(({ check }) => !check(formData)) ?? null
  const canSubmit       = () => getFailingCheck() === null

  // ── Build payload ───────────────────────────────────────────────────────
  const buildPayload = () => {
    const cleanedInvestigations = {}
    Object.keys(formData.investigations).forEach(type => {
      cleanedInvestigations[type] = formData.investigations[type].filter(
        assignment => assignment.investigatorId && assignment.investigatorId.trim() !== ''
      )
    })

    const nfd = {
      ...formData,
      dateOfIncident:   normalizeDate(formData.dateOfIncident),
      dateOfIntimation: normalizeDate(formData.dateOfIntimation),
      policyDetails: {
        ...formData.policyDetails,
        startDate:     normalizeDate(formData.policyDetails?.startDate),
        endDate:       normalizeDate(formData.policyDetails?.endDate),
        inceptionDate: normalizeDate(formData.policyDetails?.inceptionDate),
      },
      hospitalDetails: {
        ...formData.hospitalDetails,
        admissionDate: normalizeDate(formData.hospitalDetails?.admissionDate),
        dischargeDate: normalizeDate(formData.hospitalDetails?.dischargeDate),
      },
      accidentDetails: { ...formData.accidentDetails, dateTime: normalizeDate(formData.accidentDetails?.dateTime) },
      deathDetails:    { ...formData.deathDetails,    date:     normalizeDate(formData.deathDetails?.date) },


    }


    return {
      insurer: nfd.insurer, policyNumber: nfd.policyNumber, policyType: nfd.policyType,
      insurerRef: nfd.insurerRef || null, insurerContact: nfd.insurerContact || null,
      insurerContactInfo: nfd.insurerContactInfo || null,
      claimantName: nfd.claimantName, claimantMobile: nfd.claimantMobile,
      altContact: nfd.altContact || null,
      claimantAge: nfd.claimantAge ? Number(nfd.claimantAge) : null,
      relationship: nfd.relationship || null, idProofType: nfd.idProofType || null,
      idProofNumber: nfd.idProofNumber, claimantAddress: nfd.claimantAddress || null,
      city: nfd.city || null, district: nfd.district || null, pinCode: nfd.pinCode,
      claimMode: nfd.claimMode, claimSubtype: nfd.claimSubtype, tags: nfd.tags,
      claimTriggers: nfd.claimTriggers || [],
      description: nfd.description,
      dateOfIncident: nfd.dateOfIncident || null, dateOfIntimation: nfd.dateOfIntimation || null,
      claimedAmount: (nfd.claimedAmount !== '' && nfd.claimedAmount !== null && nfd.claimedAmount !== undefined)
  ? Number(nfd.claimedAmount)
  : null,
      sumInsured:    nfd.sumInsured    ? Number(nfd.sumInsured)    : null,
      claimPriority: nfd.claimPriority,
      policyDetails: nfd.policyDetails, hospitalDetails: nfd.hospitalDetails,
      locationDetails: nfd.locationDetails, claimSource: nfd.claimSource,
      slaCategory: nfd.slaCategory, reimbursementDetails: (nfd.reimbursementDetails?.bankDetails || nfd.reimbursementDetails?.accountName || nfd.reimbursementDetails?.ifsc)
  ? nfd.reimbursementDetails
  : null,
      cashlessDetails: nfd.cashlessDetails,
      accidentDetails: nfd.tags.includes('Accident') ? nfd.accidentDetails : null,tpaName: nfd.tpaName || null,
      deathDetails:    nfd.tags.includes('Death')    ? nfd.deathDetails    : null,
    railwayDetails:  nfd.tags.includes('Railway')          ? nfd.railwayDetails  : null,
    criticalDetails: nfd.tags.includes('Critical Illness') ? nfd.criticalDetails : null,
      criticalDetails: nfd.tags.includes('Critical Illness') ? nfd.criticalDetails : null,
      investigations: cleanedInvestigations,doctor_assigned: nfd.doctor_assigned || null,
      targetDate: nfd.targetDate || null, assignmentNotes: nfd.assignmentNotes || null,
    }
  }

  // ── Validate dates ──────────────────────────────────────────────────────
const validateDates = () => {
  const invalidDates = []
  const checkDate = (label, value) => {
    if (value && !isValidNormalizedDate(value)) invalidDates.push(label)
  }
  checkDate('Date of Incident',      formData.dateOfIncident)
  checkDate('Date of Intimation',    formData.dateOfIntimation)
  checkDate('Policy Start Date',     formData.policyDetails?.startDate)
  checkDate('Policy End Date',       formData.policyDetails?.endDate)
  checkDate('Policy Inception Date', formData.policyDetails?.inceptionDate)
  checkDate('Admission Date',        formData.hospitalDetails?.admissionDate)
  checkDate('Discharge Date',        formData.hospitalDetails?.dischargeDate)
  checkDate('Date of Death',         formData.deathDetails?.date)
  checkDate('Target Date',           (formData.targetDate || '').split(' ')[0])  // ← only this line changes
  return invalidDates
}

  // ── Save Changes (draft → form-save, allocated → PUT) ──────────────────
// ── Ensure we always have a real caseId before any write ───────────────
const ensureCaseId = async () => {
  const existing = caseId || editCaseId
  if (existing) return existing

  const res = await fetch(
    `${BASE_URL.replace(/\/$/, '')}/insurance/web/create-draft-case`,
    { method: 'POST' }
  )
  if (!res.ok) throw new Error(`Failed to create draft case (${res.status})`)
  const data = await res.json()
  setCaseId(data.caseId)
  return data.caseId
}

// ── Save Changes ────────────────────────────────────────────────────────
const handleSaveChanges = async () => {
  const invalidDates = validateDates()
  if (invalidDates.length) {
    alert(`Invalid date format in:\n\n${invalidDates.join('\n')}\n\nUse DD/MM/YYYY`)
    return
  }

  setSaving(true)
  setSaveSuccess(false)

  try {
    const targetId = await ensureCaseId()  // ← guaranteed non-null

    if (caseStatus === 'DRAFT' || !caseStatus) {
      const formSnapshot = {
        insurer: formData.insurer || null,
        policyNumber: formData.policyNumber || null,
        policyType: formData.policyType || null,
        insurerRef: formData.insurerRef || null,
        insurerContact: formData.insurerContact || null,
        insurerContactInfo: formData.insurerContactInfo || null,
        claimantName: formData.claimantName || null,
        claimantMobile: formData.claimantMobile || null,
        altContact: formData.altContact || null,
        claimantAge: formData.claimantAge ? Number(formData.claimantAge) : null,
        relationship: formData.relationship || null,
        idProofType: formData.idProofType || null,
        idProofNumber: formData.idProofNumber || null,
        claimantAddress: formData.claimantAddress || null,
        city: formData.city || null,
        district: formData.district || null,
        pinCode: formData.pinCode || null,
        claimMode: formData.claimMode || null,
        claimSubtype: formData.claimSubtype || null,
        tags: formData.tags || [],
        claimTriggers: formData.claimTriggers || [],
        description: formData.description || null,
        dateOfIncident: normalizeDate(formData.dateOfIncident) || null,
        dateOfIntimation: normalizeDate(formData.dateOfIntimation) || null,
        claimedAmount: formData.claimedAmount ? Number(formData.claimedAmount) : null,
        sumInsured: formData.sumInsured ? Number(formData.sumInsured) : null,
        claimPriority: formData.claimPriority || null,
        targetDate: formData.targetDate || null,  // ← ADD THIS LINE
        assignmentNotes: formData.assignmentNotes || null,
        claimSource: formData.claimSource || null,
        slaCategory: formData.slaCategory || null,
        policyDetails: formData.policyDetails || {},
        hospitalDetails: formData.hospitalDetails || {},
        locationDetails: formData.locationDetails || {},
        reimbursementDetails: formData.reimbursementDetails || {},
        cashlessDetails: formData.cashlessDetails || {},
        accidentDetails: formData.accidentDetails || {},
        deathDetails: formData.deathDetails || {},
        criticalDetails: formData.criticalDetails || {},
        investigations: formData.investigations || {},
        railwayDetails: formData.railwayDetails || {},
      }

      const res = await fetch(
        `${BASE_URL.replace(/\/$/, '')}/insurance/web/case-documents/${targetId}/form-save`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': 'web-user',
            'X-User-Role': 'supervisor',
          },
          body: JSON.stringify({ merged_extracted_data: formSnapshot }),
        }
      )

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        alert(`Save failed (${res.status}): ` + (body?.detail ?? 'Unknown error'))
        return
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)

    } else {
      const payload = buildPayload()
      const res = await fetch(
        `${BASE_URL.replace(/\/$/, '')}/insurance/web/cases/${targetId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        alert(`Save failed (${res.status}): ` + (body?.detail ? JSON.stringify(body.detail) : 'Unknown error'))
        return
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    }
  } catch (err) {
    console.error(err)
    alert('Network error while saving: ' + err.message)
  } finally {
    setSaving(false)
  }
}

// ── Submit ──────────────────────────────────────────────────────────────
const handleSubmit = async () => {
    setSubmitAttempted(true)          // ← add this line

  const invalidDates = validateDates()
  if (invalidDates.length) {
    alert(`Invalid date format in:\n\n${invalidDates.join('\n')}\n\nUse DD/MM/YYYY`)
    return
  }
    if (!canSubmit()) return          // ← add this guard


  try {
    const targetId = await ensureCaseId()  // ← guaranteed non-null

    const payload = buildPayload()
    const res = await fetch(
      `${BASE_URL.replace(/\/$/, '')}/insurance/web/cases/${targetId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      console.error('Submission error body:', body)
      alert(`Submission failed (${res.status}): ` + (body?.detail ? JSON.stringify(body.detail) : 'Unknown error'))
      return
    }



    // Clear staging data if this was a draft
    if (caseStatus === 'DRAFT' || !caseStatus) {
      fetch(
        `${BASE_URL.replace(/\/$/, '')}/insurance/web/case-documents/${targetId}/clear-staging`,
        {
          method: 'POST',
          headers: { 'X-User-Id': 'web-user', 'X-User-Role': 'supervisor' },
        }
      ).catch(err => console.warn('clear-staging failed (non-critical):', err))
    }

    alert(caseStatus === 'DRAFT' ? 'Case submitted successfully!' : 'Case updated successfully!')
    navigate('/insurance/dashboard')

  } catch (err) {
    console.error(err)
    alert('Network error while submitting case: ' + err.message)
  }
}
const unfilledFields = getUnfilledFields()
  const prog = totalProgress()

  if (loadingCase) {
    return (
      <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, flexDirection: 'column', gap: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '3px solid var(--border)', borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>Loading case {editCaseId}…</div>
        <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240, flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 32 }}>⚠</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Failed to load case</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{loadError}</div>
        <button className="btn btn-ghost" onClick={() => navigate('/insurance/dashboard')}>← Back to Dashboard</button>
      </div>
    )
  }

  const statusBadgeStyle = caseStatus === 'DRAFT'
    ? { background: 'color-mix(in srgb, var(--amber,#f59e0b) 15%, transparent)', color: 'var(--amber,#f59e0b)', border: '1px solid color-mix(in srgb, var(--amber,#f59e0b) 30%, transparent)' }
    : { background: 'color-mix(in srgb, var(--green,#22c55e) 15%, transparent)', color: 'var(--green,#22c55e)', border: '1px solid color-mix(in srgb, var(--green,#22c55e) 30%, transparent)' }

  return (
    <div className="page-content">

      {/* Sticky Progress Header */}
      <div className="nc-progress-header">
        <div className="nc-progress-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isEditMode && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('/insurance/dashboard')}
                style={{ fontSize: 12 }}
              >
                ← Dashboard
              </button>
            )}
            <span className="nc-progress-title">
              {isEditMode ? `Edit Case — ${editCaseId}` : 'New Case'}
            </span>
            {isEditMode && caseStatus && (
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
                borderRadius: 6, padding: '3px 8px',
                ...statusBadgeStyle,
              }}>
                {caseStatus === 'DRAFT' ? 'Draft' : 'Editing'}
              </span>
            )}
          </div>
          <span className="nc-progress-pct">{prog}% complete</span>
        </div>

        <CaseDocumentUpload
          formData={formData}
          setFormData={setFormData}
          BASE_URL={BASE_URL}
          caseId={caseId}
          setCaseId={setCaseId}
          setExtractedSuggestions={setExtractedSuggestions}  // ← ADD THIS

        />

        <div className="nc-section-pills">
          {SECTIONS.map(s => {
            const pct = sectionProgress(s.id)
            return (
              <button
                key={s.id}
                className="nc-pill"
                onClick={() => scrollTo(s.id)}
                style={{ '--pill-color': s.color }}
              >
                <span className="nc-pill-label">{s.label}</span>
                <span className="nc-pill-ring">
                  <svg viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border)" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15.9" fill="none"
                      stroke={s.color} strokeWidth="3"
                      strokeDasharray={`${pct} ${100 - pct}`}
                      strokeDashoffset="25" strokeLinecap="round"
                    />
                  </svg>
                  <span className="nc-pill-pct">{pct}%</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="nc-master-bar">
          <div className="nc-master-fill" style={{ width: `${prog}%` }} />
        </div>
      </div>

      <InsurerSection
        formData={formData} setFormData={setFormData}
        handleChange={handleChange} sectionRefs={sectionRefs}
        sectionProgress={sectionProgress} SectionBadge={SectionBadge}
          extractedSuggestions={extractedSuggestions}  unfilledFields={unfilledFields}// ← ADD THIS

      />
      <ClaimantSection
        formData={formData} handleChange={handleChange}
        fieldErrors={fieldErrors} sectionRefs={sectionRefs}
        sectionProgress={sectionProgress} SectionBadge={SectionBadge}
          extractedSuggestions={extractedSuggestions} unfilledFields={unfilledFields} // ← ADD THIS

      />
      <ClaimSection
        formData={formData} setFormData={setFormData}
        handleChange={handleChange} sectionRefs={sectionRefs}
        sectionProgress={sectionProgress} SectionBadge={SectionBadge}
        riskLabel={riskLabel} setAutoPriority={setAutoPriority}
        extractedSuggestions={extractedSuggestions}  unfilledFields={unfilledFields}// ← ADD THIS

      />
      <AssignmentSection
  formData={formData}
  setFormData={setFormData}
  sectionRefs={sectionRefs}
  sectionProgress={sectionProgress}
  SectionBadge={SectionBadge}
  INVESTIGATORS={investigatorsList}
  loadingInvestigators={loadingInvestigators}
  setAutoTargetDate={setAutoTargetDate}
  BASE_URL={BASE_URL}
  unfilledFields={unfilledFields}
/>

      {/* Submit Bar */}
      <div className="nc-submit-bar">
        {!canSubmit() && (
          <span className="nc-submit-hint">⚠ {getFailingCheck()?.label}</span>
        )}

        {saveSuccess && (
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: 'var(--green, #22c55e)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            ✓ Changes saved
          </span>
        )}

        <div style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
{isEditMode && (
  <button className="btn btn-ghost" onClick={() => navigate('/insurance/dashboard')}>
    ✕ Cancel
  </button>
)}

          {isEditMode && (
            <button
              className="btn btn-ghost"
              onClick={handleSaveChanges}
              disabled={saving}
              style={{
                borderColor: 'var(--accent)', color: 'var(--accent)',
                opacity: saving ? 0.6 : 1,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {saving ? (
                <>
                  <span style={{
                    display: 'inline-block', width: 11, height: 11,
                    border: '2px solid var(--accent)', borderTopColor: 'transparent',
                    borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                  }} />
                  Saving…
                </>
              ) : (
                <>
                  💾 Save Changes
                  {caseStatus === 'DRAFT' && (
                    <span style={{ fontSize: 10, opacity: 0.7 }}>(draft)</span>
                  )}
                </>
              )}
            </button>
          )}

          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!canSubmit()}
            style={{ opacity: canSubmit() ? 1 : 0.45, cursor: canSubmit() ? 'pointer' : 'not-allowed' }}
          >
            {isEditMode
              ? (caseStatus === 'DRAFT' ? 'Submit Case' : 'Update Case')
              : 'Submit Case'
            }
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function SectionBadge({ pct, color }) {
  const done = pct === 100
  return (
    <span className="nc-section-badge" style={{
      background: done ? `${color}18` : 'var(--bg3)',
      color: done ? color : 'var(--muted)',
      border: `1px solid ${done ? color + '40' : 'var(--border)'}`,
    }}>
      {done ? '✓ Complete' : `${pct}%`}
    </span>
  )
}