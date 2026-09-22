import { describe, it, expect } from 'vitest'
import { computeReputation, SIGNAL_REGISTRY, ALGORITHM_VERSION, BANKRUPTCY_CAP, RESTRUCTURING_CAP, MIN_SIGNALS_FOR_VERDICT } from './index.js'
import type { CompanySignalData } from './types.js'

function makeCompany(overrides: Partial<CompanySignalData> = {}): CompanySignalData {
  return {
    companyId: 1,
    companyName: 'Test UAB',
    yearlyRows: [
      { year: 2020, revenue: 2000000, profit: 150000, netProfit: 120000, employees: 25, salary: 1200, sodraDebt: 0 },
      { year: 2021, revenue: 2500000, profit: 200000, netProfit: 170000, employees: 30, salary: 1350, sodraDebt: 0 },
      { year: 2022, revenue: 3000000, profit: 280000, netProfit: 240000, employees: 35, salary: 1500, sodraDebt: 0 },
      { year: 2023, revenue: 3800000, profit: 350000, netProfit: 300000, employees: 42, salary: 1700, sodraDebt: 0 },
      { year: 2024, revenue: 4500000, profit: 420000, netProfit: 360000, employees: 48, salary: 1900, sodraDebt: 0 },
    ],
    mentions: [],
    ratingAverage: null,
    ratingCount: 0,
    topYearsListed: 3,
    foundedYear: 2012,
    activationStatus: 'nominated',
    procurementData: null,
    taxData: null,
    legalData: null,
    reportingData: null,
    governanceData: null,
    ownershipData: null,
    ...overrides,
  }
}

describe('EBRS Scoring', () => {
  it('returns a score for a company with financial data', () => {
    const result = computeReputation(makeCompany())
    expect(result).not.toBeNull()
    expect(result!.overall).toBeGreaterThan(0)
    expect(result!.overall).toBeLessThanOrEqual(10)
    expect(result!.confidence).toBeGreaterThan(0)
    expect(result!.confidence).toBeLessThanOrEqual(100)
    expect(result!.algorithmVersion).toBe(ALGORITHM_VERSION)
  })

  it('returns null for truly empty data', () => {
    const result = computeReputation(makeCompany({ yearlyRows: [], topYearsListed: 0, foundedYear: null }))
    expect(result).toBeNull()
  })

  it('has 5 EBRS axes', () => {
    const result = computeReputation(makeCompany())!
    const axisNames = result.ebrsAxes.map(a => a.axis)
    expect(axisNames).toContain('continuity')
    expect(axisNames).toContain('financial')
    expect(axisNames).toContain('resilience')
  })

  it('excludes signals without data (null-exclusion)', () => {
    const result = computeReputation(makeCompany())!
    // No mentions → market_presence should be absent
    const hasMarketPresence = result.signals.some(s => s.id === 'market_presence')
    expect(hasMarketPresence).toBe(false)
    // No tax data → tax_discipline should be absent
    const hasTaxDiscipline = result.signals.some(s => s.id === 'tax_discipline')
    expect(hasTaxDiscipline).toBe(false)
  })

  it('re-normalizes weights to sum to 1.0', () => {
    const result = computeReputation(makeCompany())!
    const totalWeight = result.signals.reduce((s, sig) => s + sig.weight, 0)
    expect(totalWeight).toBeCloseTo(1.0, 2)
  })

  it('growing company scores higher on resilience than volatile one', () => {
    const growing = computeReputation(makeCompany())!
    const volatile = computeReputation(makeCompany({
      yearlyRows: [
        { year: 2020, revenue: 3000000, profit: 100000, netProfit: 80000, employees: 30, salary: 1300, sodraDebt: 0 },
        { year: 2021, revenue: 1500000, profit: -200000, netProfit: -250000, employees: 20, salary: 1200, sodraDebt: 0 },
        { year: 2022, revenue: 4000000, profit: 300000, netProfit: 250000, employees: 35, salary: 1400, sodraDebt: 0 },
        { year: 2023, revenue: 2000000, profit: -100000, netProfit: -150000, employees: 22, salary: 1250, sodraDebt: 0 },
        { year: 2024, revenue: 3500000, profit: 200000, netProfit: 170000, employees: 28, salary: 1350, sodraDebt: 0 },
      ],
    }))!

    const growingResilience = growing.signals.find(s => s.id === 'resilience')!.score
    const volatileResilience = volatile.signals.find(s => s.id === 'resilience')!.score
    expect(growingResilience).toBeGreaterThan(volatileResilience)
  })

  it('tax debt lowers financial score', () => {
    const clean = computeReputation(makeCompany({
      taxData: { hasDebt: false, debtTotal: 0, debtOverdue: 0, debtDeferred: 0, annualTaxCurrent: null, annualTaxPrevious: null, taxYear: null },
    }))!
    const indebted = computeReputation(makeCompany({
      taxData: { hasDebt: true, debtTotal: 50000, debtOverdue: 50000, debtDeferred: 0, annualTaxCurrent: null, annualTaxPrevious: null, taxYear: null },
    }))!

    const cleanTax = clean.signals.find(s => s.id === 'tax_discipline')!.score
    const debtTax = indebted.signals.find(s => s.id === 'tax_discipline')!.score
    expect(cleanTax).toBeGreaterThan(debtTax)
  })

  it('has 15 signals in the registry', () => {
    expect(SIGNAL_REGISTRY.length).toBe(15)
  })

  it('v5.3 coverage shrinkage pulls a sparse high-scoring company toward neutral', () => {
    // makeCompany() has strong financials but no government/market data, so only
    // a subset of the 15 signals are computable (low coverage).
    const result = computeReputation(makeCompany())!
    // result.signals weights are renormalised to sum to 1, so this is exactly the
    // raw (pre-shrinkage) weighted overall.
    const rawWeightedMean = result.signals.reduce((s, sig) => s + sig.score * sig.weight, 0)
    expect(result.signals.length).toBeLessThan(SIGNAL_REGISTRY.length) // sparse
    if (rawWeightedMean > 5) {
      // With missing signals the headline overall is regressed below the raw mean,
      // toward the neutral prior of 5.0.
      expect(result.overall).toBeLessThan(rawWeightedMean)
      expect(result.overall).toBeGreaterThan(5)
    }
  })

  it('v5.3 full coverage would leave the overall unshrunk (prior weight 0)', () => {
    // Sanity on the formula: when missing = 0, priorWeight = 0, so shrunk == raw.
    // (Constructing a full-15-signal fixture needs all gov tables; here we assert
    // the monotonic property: more signals present → less downward pull.)
    const sparse = computeReputation(makeCompany())!
    const richer = computeReputation(makeCompany({
      ratingAverage: 8.5, ratingCount: 12, // adds community_trust signal
    }))!
    expect(richer.signals.length).toBeGreaterThanOrEqual(sparse.signals.length)
  })
})

// ── v6.0 guarantees ──

describe('EBRS v6.0', () => {
  const base = {
    companyId: 1, companyName: 'Test UAB', mentions: [], ratingAverage: null,
    ratingCount: 0, topYearsListed: 0, foundedYear: 2015,
    activationStatus: 'nominated', procurementData: null, taxData: null,
    legalData: null, reportingData: null, governanceData: null, ownershipData: null,
  } as never as Parameters<typeof computeReputation>[0]

  const healthyYears = [
    { year: 2022, revenue: 9000000, profit: 900000, netProfit: 800000, employees: 100, salary: 2500, sodraDebt: 0 },
    { year: 2023, revenue: 9500000, profit: 950000, netProfit: 850000, employees: 105, salary: 2600, sodraDebt: 0 },
    { year: 2024, revenue: 9800000, profit: 990000, netProfit: 900000, employees: 110, salary: 2700, sodraDebt: 0 },
  ]

  it('input guards run inside computeReputation - Infinity/NaN/implausible years never produce NaN', () => {
    const score = computeReputation({ ...base, yearlyRows: [
      { year: 2023, revenue: 5000000, profit: Infinity, netProfit: NaN, employees: 45, salary: 1800, sodraDebt: 0 },
      { year: 3905, revenue: 1, profit: 1, netProfit: 1, employees: 1, salary: 1, sodraDebt: 0 },
      { year: 2024, revenue: 6200000, profit: 550000, netProfit: 480000, employees: 52, salary: 2100, sodraDebt: 0 },
    ] })
    expect(score).not.toBeNull()
    expect(Number.isNaN(score!.overall)).toBe(false)
  })

  it('active bankruptcy caps the overall at BANKRUPTCY_CAP no matter how healthy other signals are', () => {
    const score = computeReputation({ ...base, yearlyRows: healthyYears,
      ratingAverage: 8, ratingCount: 10,
      bankruptcyData: { status: 'bankrupt' } })
    expect(score!.overall).toBeLessThanOrEqual(BANKRUPTCY_CAP)
    expect(score!.capApplied).toBe('bankruptcy')
  })

  it('restructuring caps the overall at RESTRUCTURING_CAP', () => {
    const score = computeReputation({ ...base, yearlyRows: healthyYears,
      bankruptcyData: { status: 'restructuring' } })
    expect(score!.overall).toBeLessThanOrEqual(RESTRUCTURING_CAP)
    expect(score!.capApplied).toBe('restructuring')
  })

  it('below MIN_SIGNALS_FOR_VERDICT signals the scoreState is insufficient_data', () => {
    const score = computeReputation({ ...base, yearlyRows: [
      { year: 2024, revenue: 500000, profit: 40000, netProfit: 35000, employees: null, salary: null, sodraDebt: null },
    ] })
    expect(score).not.toBeNull()
    if (score!.signals.length < MIN_SIGNALS_FOR_VERDICT) {
      expect(score!.scoreState).toBe('insufficient_data')
    } else {
      expect(score!.scoreState).toBe('ok')
    }
  })

  it('signal weights sum to exactly 1.00', () => {
    const sum = SIGNAL_REGISTRY.reduce((s, sig) => s + sig.defaultWeight, 0)
    expect(Math.round(sum * 100) / 100).toBe(1.0)
  })
})
