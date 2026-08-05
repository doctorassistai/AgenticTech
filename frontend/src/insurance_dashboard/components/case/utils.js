export const normalizeDate = (value) => {
  if (!value) return ''

  let v = String(value).trim()

  // remove spaces
  v = v.replace(/\s+/g, '')

  // DDMMYYYY
  if (/^\d{8}$/.test(v)) {
    const first4 = v.slice(0, 4)

    // YYYYMMDD
    if (Number(first4) > 1900) {
      return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`
    }

    // DDMMYYYY
    v = `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`
  }

  const parts = v.split(/[\/\-\.]/)

  if (parts.length !== 3) return ''

  let day
  let month
  let year

  // YYYY-MM-DD
  if (parts[0].length === 4) {
    year = parts[0]
    month = parts[1]
    day = parts[2]
  }

  // DD-MM-YYYY
  else {
    day = parts[0]
    month = parts[1]
    year = parts[2]
  }

  // 2-digit year support
  if (year.length === 2) {
    year = `20${year}`
  }

  day = String(day).padStart(2, '0')
  month = String(month).padStart(2, '0')

  const d = Number(day)
  const m = Number(month)
  const y = Number(year)

  if (
    Number.isNaN(d) ||
    Number.isNaN(m) ||
    Number.isNaN(y)
  ) {
    return ''
  }

  if (
    d < 1 || d > 31 ||
    m < 1 || m > 12 ||
    year.length !== 4
  ) {
    return ''
  }

  const testDate = new Date(`${year}-${month}-${day}`)

  if (
    testDate.getFullYear() !== y ||
    testDate.getMonth() + 1 !== m ||
    testDate.getDate() !== d
  ) {
    return ''
  }

  return `${year}-${month}-${day}`
}

export const parseDate = (value) => {
  const normalized = normalizeDate(value)

  if (!normalized) return null

  return new Date(normalized)
}

export const isValidNormalizedDate = (value) => {
  if (!value) return true

  return normalizeDate(value) !== ''
}
// components/case/utils.js
export function isoToDMY(val) {
  if (!val) return ''
  if (typeof val === 'string' && val.match(/^\d{2}\/\d{2}\/\d{4}$/)) return val
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
    const [y, m, d] = val.substring(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  return val || ''
}

export function normalizeDatesForForm(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const result = {}
  const DATE_KEYS = ['startDate', 'endDate', 'admissionDate', 'dischargeDate',
    'dateOfIncident', 'dateOfIntimation', 'inceptionDate',
    'date', 'dateTime', 'incidentDate']
  for (const [k, v] of Object.entries(obj)) {
    if (DATE_KEYS.includes(k) && typeof v === 'string') {
      result[k] = isoToDMY(v)
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = normalizeDatesForForm(v)
    } else {
      result[k] = v
    }
  }
  return result
}