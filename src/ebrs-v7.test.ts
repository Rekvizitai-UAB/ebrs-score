import { describe, expect, it } from 'vitest'
import { computeReputation } from './scorer.js'
import { SIGNAL_REGISTRY } from './signals.js'
import type { CompanySignalData } from './types.js'

const registryData: CompanySignalData = {
  companyId: 1, companyName: 'Testas', foundedYear: 2005,
  yearlyRows: [2022, 2023, 2024, 2025].map(year => ({
    year, revenue: 1_000_000, profit: 100_000, netProfit: 80_000, employees: 20, salary: 2000, sodraDebt: 0,
  })),
  procurementData: null, taxData: null, legalData: null,
  reportingData: null, governanceData: null, ownershipData: null, bankruptcyData: null,
}

describe('EBRS v7 excludes publicity and platform participation', () => {
  it('produces identical scores, confidence and reasoning regardless of mentions, ratings or TOP membership', () => {
    const baseline = computeReputation(registryData)
    for (const sentiment of ['positive', 'negative', 'neutral']) {
      for (const activationStatus of ['inactive', 'activated', 'verified', 'lyderis']) {
        const decorated: CompanySignalData = {
          ...registryData, activationStatus, topYearsListed: 10, ratingAverage: 10, ratingCount: 100_000,
          mentions: Array.from({ length: 1000 }, (_, i) => ({
            source: `publisher-${i}.lt`, sentiment, sentimentScore: sentiment === 'negative' ? -1 : 1,
            isNews: true, foundAt: new Date(),
          })),
        }
        expect(computeReputation(decorated)).toEqual(baseline)
      }
    }
  })

  it('does not generate a score from publicity or paid status alone', () => {
    expect(computeReputation({ ...registryData, yearlyRows: [], foundedYear: null,
      topYearsListed: 10, ratingAverage: 10, ratingCount: 1000, activationStatus: 'lyderis' })).toBeNull()
  })

  it('has 13 signals across four axes with normalized weights', () => {
    expect(SIGNAL_REGISTRY).toHaveLength(13)
    expect(new Set(SIGNAL_REGISTRY.map(s => s.ebrsAxis))).toEqual(new Set(['continuity', 'financial', 'resilience', 'transparency']))
    expect(SIGNAL_REGISTRY.reduce((sum, s) => sum + s.defaultWeight, 0)).toBeCloseTo(1, 12)
    expect(computeReputation(registryData)?.algorithmVersion).toBe('v7.0.0')
  })
})
