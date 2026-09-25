import { describe, expect, it } from 'vitest'
import { computeReputation } from './scorer.js'
import { SIGNAL_REGISTRY } from './signals.js'
import type { CompanySignalData } from './types.js'

/**
 * 2026-09-08: a bankruptcy lawyer phoned to say we were publishing an
 * insolvent company as "Patikima · Žema rizika" with EBRS 7.7. The terminal
 * cap read ONLY the AVNT extract (711 rows, newest 2025-10-02), never the
 * register's own legal status - so 857 companies the state itself marks
 * bankrupt, liquidating or deregistered escaped the cap and 141 of them were
 * published as reliable, the worst at 7.6.
 */
/**
 * A HEALTHY company on every other axis - strong revenue, no debt, filings on
 * time. That is the point: the cap has to beat a good score, which is exactly
 * what failed in production (a 7.7 "Patikima" on an insolvent company).
 */
function baseData(overrides: Partial<CompanySignalData> = {}): CompanySignalData {
  return {
    companyId: 1,
    companyName: 'UAB Testas',
    yearlyRows: [
      { year: 2023, revenue: 5_000_000, profit: 400_000, netProfit: 350_000, employees: 40 },
      { year: 2024, revenue: 6_000_000, profit: 500_000, netProfit: 430_000, employees: 45 },
      { year: 2025, revenue: 7_000_000, profit: 600_000, netProfit: 520_000, employees: 50 },
    ] as CompanySignalData['yearlyRows'],
    mentions: [],
    ratingAverage: 4.6,
    ratingCount: 25,
    topYearsListed: 6,
    foundedYear: 2010,
    activationStatus: 'verified',
    procurementData: null,
    taxData: { hasDebt: false, debtTotal: 0, debtOverdue: 0, debtDeferred: 0, annualTaxCurrent: null, annualTaxPrevious: null, taxYear: null },
    legalData: null,
    reportingData: null,
    governanceData: null,
    ownershipData: null,
    legalStatus: null,
    bankruptcyData: null,
    ...overrides,
  } as CompanySignalData
}

describe('current dated SODRA debt reaches both affected signals', () => {
  const historical = baseData().yearlyRows.map(row => ({ ...row, sodraDebt: 10_000, salary: 2_000 }))
  const data = baseData({ yearlyRows: historical })

  it.each(['financial_strength', 'workforce_health'])('%s uses current debt without rewriting annual history', id => {
    const signal = SIGNAL_REGISTRY.find(item => item.id === id)!
    const cleared = signal.compute({ ...data, currentSodraDebt: { amount: 0, date: '2026-09-09' } })!
    const overdue = signal.compute({ ...data, currentSodraDebt: { amount: 500, date: '2026-09-10' } })!
    expect(cleared.details).toMatchObject({ sodraDebt: 0, sodraDebtDate: '2026-09-09', sodraPenalty: 0 })
    expect(overdue.details).toMatchObject({ sodraDebt: 500, sodraDebtDate: '2026-09-10' })
    expect(Number(overdue.details.sodraPenalty)).toBeLessThan(0)
    expect(overdue.score).toBeLessThan(cleared.score)
    expect(historical.every(row => row.sodraDebt === 10_000)).toBe(true)
    expect(signal.compute(data)!.details.sodraDebt).toBe(10_000)
  })

  it('keeps unavailable current debt unknown instead of reusing annual debt or claiming known zero', () => {
    const signal = SIGNAL_REGISTRY.find(item => item.id === 'financial_strength')!
    const unknown = signal.compute({ ...data, currentSodraDebt: { amount: null, date: null } })!
    const zero = signal.compute({ ...data, currentSodraDebt: { amount: 0, date: '2026-09-09' } })!
    expect(unknown.details).toMatchObject({ sodraDebt: null, sodraDebtDate: null, sodraPenalty: 0 })
    expect(unknown.dataPoints).toBe(zero.dataPoints - 1)
    expect(unknown.confidence).toBeLessThan(zero.confidence)
  })
})

describe('the register outranks the extract', () => {
  const CASES: Array<[string, 'Kritinė' | 'Aukšta']> = [
    ['Bankrutuojantis', 'Kritinė'],
    ['Bankrutavęs', 'Kritinė'],
    ['Likviduojamas dėl bankroto', 'Kritinė'],
    ['Likviduojamas', 'Kritinė'],
    ['Išregistruotas', 'Kritinė'],
    ['Inicijuojamas likvidavimas', 'Kritinė'],
    ['Restruktūrizuojamas', 'Aukšta'],
  ]

  for (const [status, band] of CASES) {
    it(`caps "${status}" even with no AVNT row at all`, () => {
      const score = computeReputation(baseData({ legalStatus: status }))!
      expect(score.overall).toBeLessThanOrEqual(status.toLowerCase().startsWith('restrukt') ? 4.9 : 2.9)
      expect(score.riskLevel).toBe(band)
    })
  }

  it('leaves an ordinary trading company alone', () => {
    // Reorganisation and conversion are changes of FORM, not of solvency:
    // a healthy company does them all the time and must not be branded.
    for (const status of ['Teisinis statusas neįregistruotas', 'Reorganizuojamas', 'Pertvarkomas', null]) {
      const score = computeReputation(baseData({ legalStatus: status }))!
      expect(score.capApplied ?? null).toBeNull()
    }
  })

  it('still honours the AVNT extract when the register is silent', () => {
    const score = computeReputation(
      baseData({ bankruptcyData: { status: 'bankrupt', statusDate: null, intentionalBankruptcyDate: null } as CompanySignalData['bankruptcyData'] }),
    )!
    expect(score.overall).toBeLessThanOrEqual(2.9)
  })
})

describe('an operator who has read the court order outranks every feed', () => {
  it('caps a company the register still calls healthy', () => {
    // UAB EKO Perdirbimas: restructuring initiated 2026-06-11
    // (eB2-2070-852/2026), register still "Teisinis statusas neįregistruotas"
    // in September, AVNT does not list it at all. We published 7.7.
    const score = computeReputation(baseData({
      legalStatus: 'Teisinis statusas neįregistruotas',
      insolvencyOverride: 'restructuring',
    }))!
    expect(score.overall).toBeLessThanOrEqual(4.9)
    expect(score.capApplied).toBe('restructuring')
  })

  it('an explicit all-clear beats a stale feed in the other direction', () => {
    // A company that finished its bankruptcy must not stay branded because an
    // extract still carries the old row.
    const score = computeReputation(baseData({
      insolvencyOverride: 'none',
      bankruptcyData: { status: 'bankrupt', statusDate: null, intentionalBankruptcyDate: null } as CompanySignalData['bankruptcyData'],
      legalStatus: 'Bankrutuojantis',
    }))!
    expect(score.capApplied ?? null).toBeNull()
    expect(score.overall).toBeGreaterThan(4.9)
  })

  it('ignores an unrecognised override rather than trusting it', () => {
    const score = computeReputation(baseData({ insolvencyOverride: 'maybe?' }))!
    expect(score.capApplied ?? null).toBeNull()
  })
})


describe('completed proceedings and daily RC evidence', () => {
  const completed = { status: 'restructuring' as const, statusDate: '2021-01-01', endDecisionDate: '2025-02-10', intentionalBankruptcyDate: null }
  const activeRc = { status: '5ef6b364-a5ff-47fb-8600-ff859214ef85', registrationDate: new Date('2010-01-01'), deregistrationDate: null, legalForm: null, statusDate: null, isActiveInRc: true }

  it('removes the active cap and legal penalty after documented restructuring completion', () => {
    const score = computeReputation(baseData({ bankruptcyData: completed, legalData: activeRc }))!
    expect(score.capApplied).toBeNull()
    expect(score.overall).toBeGreaterThan(4.9)
    expect(score.signals.find(s => s.id === 'legal_standing')?.score).toBeGreaterThan(2)
  })

  it.each([null, '', '2025-02-30', '2020-01-01', '2099-01-01'])('does not erase a warning for an absent, invalid, pre-process or future completion date (%s)', endDecisionDate => {
    const score = computeReputation(baseData({ bankruptcyData: { ...completed, endDecisionDate }, legalData: activeRc }))!
    expect(score.capApplied).toBe('restructuring')
    expect(score.signals.find(s => s.id === 'legal_standing')?.score).toBe(2)
  })

  it('does not confuse a bankruptcy ending decision with successful restructuring', () => {
    const score = computeReputation(baseData({ bankruptcyData: { ...completed, status: 'bankrupt' }, legalData: activeRc }))!
    expect(score.capApplied).toBe('bankruptcy')
  })

  it('uses a new registered restructuring even when a historical AVNT process ended', () => {
    const score = computeReputation(baseData({ bankruptcyData: completed, legalData: { ...activeRc, status: '04aca49f-d1f9-47f8-af8a-5800eae51e6b' } }))!
    expect(score.capApplied).toBe('restructuring')
  })

  it('caps bankruptcy in the daily RC record when the imported text is still ordinary', () => {
    const score = computeReputation(baseData({ legalStatus: 'Teisinis statusas neįregistruotas', legalData: { ...activeRc, status: '20a01d01-4e39-4d14-82f3-a9af198de63b' } }))!
    expect(score.capApplied).toBe('bankruptcy')
    expect(score.overall).toBeLessThanOrEqual(2.9)
    expect(score.signals.find(s => s.id === 'legal_standing')?.reasoning).toContain('Bankrutuojantis')
  })

  it('uses the current RC state instead of a historical imported restructuring label', () => {
    const score = computeReputation(baseData({ legalStatus: 'Restruktūrizuojamas', legalData: activeRc, bankruptcyData: completed }))!
    expect(score.capApplied).toBeNull()
  })

  it.each(['bankruptcy', 'restructuring', 'none'])('applies a documented %s correction to both cap and legal signal', insolvencyOverride => {
    const score = computeReputation(baseData({ insolvencyOverride, bankruptcyData: { ...completed, status: 'bankrupt' }, legalData: activeRc }))!
    expect(score.capApplied).toBe(insolvencyOverride === 'none' ? null : insolvencyOverride)
    const signal = score.signals.find(s => s.id === 'legal_standing')!
    if (insolvencyOverride === 'none') expect(signal.score).toBeGreaterThan(2)
    else expect(signal.score).toBe(insolvencyOverride === 'bankruptcy' ? 0 : 2)
  })
})
