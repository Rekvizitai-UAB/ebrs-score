import { registeredLegalStatus } from './legal-status.js'

/** Shared interpretation of current insolvency evidence. Historical proceedings remain stored. */
export interface InsolvencyEvidence {
  legalStatus?: string | null
  insolvencyOverride?: string | null
  insolvencyOverrideAt?: Date | string | null
  rcStatus?: string | null
  rcStatusDate?: Date | string | null
  rcDeregistrationDate?: Date | string | null
  legalData?: { status: string | null; statusDate?: Date | null; deregistrationDate?: Date | null } | null
  bankruptcyData?: {
    status: string
    statusDate?: string | null
    endDecisionDate?: string | null
    terminationDate?: string | null
    terminationReason?: string | null
    intentionalBankruptcyDate?: string | null
  } | null
}

export interface InsolvencyResolution {
  cap: 'bankruptcy' | 'restructuring' | null
  source: 'operator' | 'register' | 'avnt' | null
  label: string | null
  completedRestructuring: boolean
  completedBankruptcy: boolean
  evidenceConflict: boolean
}

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Only an explicit completed restructuring closes this particular AVNT signal.
 * A terminated case is not presumed a successful recovery, and neither is a
 * bankruptcy liquidation decision. Future/invalid dates never erase a warning.
 */
export function restructuringCompleted(record: InsolvencyEvidence['bankruptcyData'], asOf = new Date()): boolean {
  if (record?.status !== 'restructuring') return false
  const start = record.statusDate
  const end = record.endDecisionDate
  return validDate(start) && validDate(end) && end >= start && end <= asOf.toISOString().slice(0, 10)
}

function rcStatusDate(data: InsolvencyEvidence): string | null {
  const value = data.rcStatusDate ?? data.legalData?.statusDate
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null
  return value?.slice(0, 10) ?? null
}

/** Both sources must support closure: AVNT repayment/settlement and a subsequent
 * ordinary RC status. Termination alone, liquidation and unknown reasons do not clear it.
 */
export function bankruptcyCompleted(data: InsolvencyEvidence, asOf = new Date()): boolean {
  const record = data.bankruptcyData
  if (record?.status !== 'bankrupt') return false
  if ((data.rcStatus ?? data.legalData?.status) !== '5ef6b364-a5ff-47fb-8600-ff859214ef85') return false
  if (data.rcDeregistrationDate ?? data.legalData?.deregistrationDate) return false
  if (!['Įmonė atsiskaitė su visais kreditoriais', 'Pasirašyta taikos sutartis'].includes(record.terminationReason?.trim() ?? '')) return false
  const start = record.statusDate
  const end = record.terminationDate
  const registered = rcStatusDate(data)
  const today = asOf.toISOString().slice(0, 10)
  return validDate(start) && validDate(end) && validDate(registered) && end >= start && registered >= end && registered <= today
}

export function registerInsolvencyCap(legalStatus: string | null | undefined): InsolvencyResolution['cap'] {
  if (!legalStatus) return null
  const status = legalStatus.trim().toLowerCase()
  if (status.startsWith('bankrut') || [
    'likviduojamas dėl bankroto', 'išregistruotas', 'likviduotas', 'likviduojamas', 'inicijuojamas likvidavimas',
  ].includes(status)) return 'bankruptcy'
  if (status.startsWith('restrukt')) return 'restructuring'
  return null
}

export function resolveInsolvency(data: InsolvencyEvidence, asOf = new Date()): InsolvencyResolution {
  const completedRestructuring = restructuringCompleted(data.bankruptcyData, asOf)
  const completedBankruptcy = bankruptcyCompleted(data, asOf)
  const empty: InsolvencyResolution = { cap: null, source: null, label: null, completedRestructuring, completedBankruptcy, evidenceConflict: false }
  // A documented correction outranks older feeds. A later dated adverse event
  // must still take effect; an old all-clear must not suppress future insolvency.
  const overrideDateValue = data.insolvencyOverrideAt
  const overrideDate = overrideDateValue instanceof Date ? overrideDateValue.toISOString().slice(0, 10) : overrideDateValue?.slice(0, 10)
  const rcDate = rcStatusDate(data)
  const rcLabel = registeredLegalStatus(data.legalStatus, data.rcStatus ?? data.legalData?.status,
    data.rcDeregistrationDate ?? data.legalData?.deregistrationDate)
  const avntDate = data.bankruptcyData?.statusDate
  const today = asOf.toISOString().slice(0, 10)
  const laterRcEvent = validDate(overrideDate) && validDate(rcDate) && rcDate > overrideDate && rcDate <= today && registerInsolvencyCap(rcLabel)
  const laterAvntEvent = validDate(overrideDate) && validDate(avntDate) && avntDate > overrideDate && avntDate <= today
    && ['bankrupt', 'restructuring', 'intentional_bankruptcy'].includes(data.bankruptcyData?.status ?? '')
  const override = laterRcEvent || laterAvntEvent ? null : data.insolvencyOverride
  if (override === 'none') return { ...empty, source: 'operator' }
  if (override === 'bankruptcy') return { ...empty, cap: 'bankruptcy', source: 'operator', label: 'Bankroto procesas' }
  if (override === 'restructuring') return { ...empty, cap: 'restructuring', source: 'operator', label: 'Restruktūrizavimas' }

  const registered = registeredLegalStatus(data.legalStatus, data.rcStatus ?? data.legalData?.status,
    data.rcDeregistrationDate ?? data.legalData?.deregistrationDate)
  const registerCap = registerInsolvencyCap(registered)
  if (registerCap === 'bankruptcy') return { ...empty, cap: registerCap, source: 'register', label: registered!.trim() }
  const avnt = data.bankruptcyData
  if ((avnt?.status === 'bankrupt' && !completedBankruptcy) || avnt?.status === 'intentional_bankruptcy') {
    const registeredDate = rcStatusDate(data)
    const evidenceConflict = registered === 'Teisinis statusas neįregistruotas'
      && validDate(registeredDate) && validDate(avnt.statusDate) && registeredDate > avnt.statusDate
    const label = avnt.status === 'intentional_bankruptcy' ? 'Tyčinis bankrotas' : 'Bankrotas'
    return { ...empty, cap: 'bankruptcy', source: 'avnt', evidenceConflict,
      label: evidenceConflict ? 'Teisinių šaltinių neatitiktis' : label }
  }
  // An explicit current registered restructuring still wins over a completed historical AVNT process.
  if (registerCap === 'restructuring') return { ...empty, cap: registerCap, source: 'register', label: registered!.trim() }
  if (avnt?.status === 'restructuring' && !completedRestructuring) return { ...empty, cap: 'restructuring', source: 'avnt', label: 'Restruktūrizavimas' }
  return empty
}
