/**
 * EBRS — European Business Reputation Standard
 *
 * Open-source company reputation scoring algorithm.
 * 15 signals across 5 axes. Null-exclusion principle.
 *
 * @example
 * ```ts
 * import { computeReputation, SIGNAL_REGISTRY } from './dist/index.js'
 *
 * const score = computeReputation({
 *   companyId: 1,
 *   companyName: 'Example UAB',
 *   yearlyRows: [
 *     { year: 2023, revenue: 5000000, profit: 400000, netProfit: 350000, employees: 45, salary: 1800, sodraDebt: 0 },
 *     { year: 2024, revenue: 6200000, profit: 550000, netProfit: 480000, employees: 52, salary: 2100, sodraDebt: 0 },
 *   ],
 *   mentions: [],
 *   ratingAverage: null,
 *   ratingCount: 0,
 *   topYearsListed: 0,
 *   foundedYear: 2015,
 *   activationStatus: 'inactive',
 *   procurementData: null,
 *   taxData: null,
 *   legalData: null,
 *   reportingData: null,
 *   governanceData: null,
 *   ownershipData: null,
 * })
 *
 * if (score) {
 *   console.log(`Score: ${score.overall}/10 (${score.confidence}% confidence)`)
 *   console.log(`Risk: ${score.riskLevel}`)
 *   for (const axis of score.ebrsAxes) {
 *     console.log(`  ${axis.name}: ${axis.score}/10`)
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

export {
  computeReputation,
  sanitizeCompanyData,
  ALGORITHM_VERSION,
  BANKRUPTCY_CAP,
  RESTRUCTURING_CAP,
  MIN_SIGNALS_FOR_VERDICT,
} from './scorer.js'
export { SIGNAL_REGISTRY } from './signals.js'
export { EBRS_AXES } from './types.js'

// Re-export all types
export type {
  CompanySignalData as CompanyData,
  CompanySignalData,
  YearlyRow,
  MentionRow,
  ProcurementData,
  TaxData,
  LegalData,
  ReportingData,
  GovernanceData,
  OwnershipData,
  SignalDefinition,
  SignalResult,
  SignalCategory,
  ReputationScore,
  StoredSignalScore,
  EbrsAxisScore,
  EbrsAxis,
} from './types.js'
