/**
 * EBRS Reputation Scorer Engine
 *
 * Orchestrates the signal registry to compute a company's reputation score.
 *
 * Key principle: signals that return null (insufficient data) are EXCLUDED,
 * not defaulted to 5.0. Weights re-normalized across active signals only.
 */

import { SIGNAL_REGISTRY } from './signals.js'
import type { CompanySignalData, ReputationScore, StoredSignalScore, EbrsAxisScore, EbrsAxis } from './types.js'
import { EBRS_AXES } from './types.js'

export const ALGORITHM_VERSION = 'v6.0.0'

// ── v6.0 terminal-state caps ──
// An additive composite lets 14 healthy signals outvote one catastrophic
// state. v6.0 treats registered insolvency as a CAP, not a vote: active
// bankruptcy (incl. intentional) caps the overall at 2.9; restructuring at
// 4.9. Applied after coverage shrinkage, reported via `capApplied`.
export const BANKRUPTCY_CAP = 2.9
export const RESTRUCTURING_CAP = 4.9

// ── v6.0 verdict floor ──
// Below this many computable signals no verdict band should be presented -
// consumers render "insufficient data", not a color-coded judgment.
export const MIN_SIGNALS_FOR_VERDICT = 5

// ── v5.3 input guards (v6.0: applied INSIDE computeReputation) ──
// Never let NaN / Infinity / impossible values reach the signals. Coerce
// first: numeric fields may arrive as strings from DB drivers.
const PLAUSIBLE_MIN_YEAR = 1990
function finiteOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function nonNegOrNull(v: unknown): number | null {
  const n = finiteOrNull(v)
  return n != null && n >= 0 ? n : null
}

/** Sanitize yearly rows: drop implausible years, null NaN/Infinity/negative
 *  values. Exported so callers can inspect what the scorer will actually use. */
export function sanitizeCompanyData(data: CompanySignalData): CompanySignalData {
  const guardYear = new Date().getFullYear()
  return {
    ...data,
    yearlyRows: (data.yearlyRows ?? [])
      .filter(r => Number.isFinite(r.year) && r.year >= PLAUSIBLE_MIN_YEAR && r.year <= guardYear + 1)
      .map(r => ({
        year: r.year,
        revenue: nonNegOrNull(r.revenue),
        profit: finiteOrNull(r.profit),
        netProfit: finiteOrNull(r.netProfit),
        employees: nonNegOrNull(r.employees),
        salary: nonNegOrNull(r.salary),
        sodraDebt: nonNegOrNull(r.sodraDebt),
      })),
  }
}

// ── v5.3 coverage shrinkage (survivorship-bias correction) ──
// A company with few computable signals has its weights re-normalized across
// ONLY the present signals. If the absent signals are the adverse ones (tax
// debt, late/non-filing, bankruptcy, ownership opacity), the raw score is
// inflated purely by absence of scrutiny - a data-sparse company could
// out-score a fully-examined one. v5.3 regresses the headline `overall` toward
// a neutral prior: each MISSING signal counts as a fractional neutral
// pseudo-observation. Full coverage (all signals) = no shrinkage; sparse
// coverage = strong pull toward neutral. Per-signal and per-axis scores stay
// RAW (they report measured dimensions); only `overall` is regularised for how
// complete the evidence is. Both constants are deliberately tunable.
const COVERAGE_PRIOR = 5.0                     // neutral score the overall regresses toward
const COVERAGE_PRIOR_WEIGHT_PER_MISSING = 0.5  // each missing signal = half a neutral pseudo-vote

/**
 * Compute reputation score from company data.
 *
 * @param data - All available data for a single company
 * @returns ReputationScore or null if no signals have data
 *
 * @example
 * ```ts
 * import { computeReputation } from './dist/index.js'
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
 *   topYearsListed: 2,
 *   foundedYear: 2015,
 *   activationStatus: 'nominated',
 *   procurementData: null,
 *   taxData: null,
 *   legalData: null,
 *   reportingData: null,
 *   governanceData: null,
 *   ownershipData: null,
 * })
 *
 * console.log(score.overall)    // e.g. 6.8
 * console.log(score.confidence) // e.g. 42
 * console.log(score.ebrsAxes)   // 5-axis breakdown
 * ```
 */
export function computeReputation(rawData: CompanySignalData): ReputationScore | null {
  // v6.0: guards run inside the entry point, so direct callers are protected
  // too (previously the guards lived only in the production DB layer).
  const data = sanitizeCompanyData(rawData)
  const activeSignals: StoredSignalScore[] = []

  for (const signal of SIGNAL_REGISTRY) {
    const result = signal.compute(data)
    if (result !== null) {
      activeSignals.push({
        id: signal.id,
        name: signal.name,
        score: Math.round(result.score * 100) / 100,
        confidence: Math.round(result.confidence * 100) / 100,
        weight: signal.defaultWeight,
        dataPoints: result.dataPoints,
        reasoning: result.reasoning,
        details: result.details,
        ebrsAxis: signal.ebrsAxis,
      })
    }
  }

  if (activeSignals.length === 0) return null

  // Re-normalize weights across active signals only
  const totalWeight = activeSignals.reduce((s, sig) => s + sig.weight, 0)
  for (const sig of activeSignals) {
    sig.weight = sig.weight / totalWeight
  }

  const overall = activeSignals.reduce((s, sig) => s + sig.score * sig.weight, 0)

  // v5.3 coverage shrinkage: regress the raw weighted overall toward the neutral
  // prior in proportion to how many of the signals are MISSING. Full coverage →
  // priorWeight 0 → unchanged.
  const missingSignals = SIGNAL_REGISTRY.length - activeSignals.length
  const priorWeight = missingSignals * COVERAGE_PRIOR_WEIGHT_PER_MISSING
  let shrunkOverall = (overall * activeSignals.length + COVERAGE_PRIOR * priorWeight)
    / (activeSignals.length + priorWeight)

  // v6.0 terminal-state cap - registered insolvency bounds the overall no
  // matter how strong the historical signals are. Never silent: capApplied.
  let capApplied: 'bankruptcy' | 'restructuring' | null = null
  const insolvencyStatus = data.bankruptcyData?.status
  if (insolvencyStatus === 'bankrupt' || insolvencyStatus === 'intentional_bankruptcy') {
    shrunkOverall = Math.min(shrunkOverall, BANKRUPTCY_CAP)
    capApplied = 'bankruptcy'
  } else if (insolvencyStatus === 'restructuring') {
    shrunkOverall = Math.min(shrunkOverall, RESTRUCTURING_CAP)
    capApplied = 'restructuring'
  }

  // Confidence = weighted avg of signal confidences x signal coverage
  const signalCoverage = activeSignals.length / SIGNAL_REGISTRY.length
  const avgConfidence = activeSignals.reduce((s, sig) => s + sig.confidence * sig.weight, 0)
  const confidence = Math.round(avgConfidence * signalCoverage * 100)

  const sortedRevRows = data.yearlyRows.filter(r => r.revenue && r.revenue > 0).sort((a, b) => a.year - b.year)
  const dataYears = sortedRevRows.length

  const roundedOverall = Math.round(shrunkOverall * 10) / 10 // v5.3: coverage-adjusted
  const riskLevel = roundedOverall >= 7 ? 'Low' : roundedOverall >= 5 ? 'Medium' : roundedOverall >= 3 ? 'High' : 'Critical'

  const growthSig = activeSignals.find(s => s.id === 'growth_trajectory')
  const cagr = growthSig?.details?.cagr as number | undefined
  const growthTrend = cagr !== undefined
    ? (cagr >= 15 ? 'Fast growth' : cagr >= 5 ? 'Growing' : cagr >= -2 ? 'Stable' : cagr >= -10 ? 'Declining' : 'Fast decline')
    : 'No data'

  const latestRev = sortedRevRows.length > 0 ? sortedRevRows[sortedRevRows.length - 1].revenue! : 0
  const marketPosition = latestRev > 86000000 ? 'Dominant' : latestRev > 9000000 ? 'Strong' : latestRev > 1000000 ? 'Established' : latestRev > 392000 ? 'Growing' : 'Emerging'

  const latestProfit = sortedRevRows.length > 0 ? (sortedRevRows[sortedRevRows.length - 1].profit ?? 0) : 0
  const margin = latestRev > 0 ? Math.round((latestProfit / latestRev) * 1000) / 10 : null

  const profSig = activeSignals.find(s => s.id === 'profitability_trend')
  const consecutiveProfitYears = (profSig?.details?.consecutiveYears as number) ?? 0

  // 5-axis aggregation
  const ebrsAxes: EbrsAxisScore[] = []
  const axisKeys: EbrsAxis[] = ['continuity', 'financial', 'market', 'resilience', 'transparency']
  for (const axis of axisKeys) {
    const axisSignals = activeSignals.filter(s => s.ebrsAxis === axis)
    if (axisSignals.length === 0) continue
    const axisTotalWeight = axisSignals.reduce((s, sig) => s + sig.weight, 0)
    const axisScore = axisTotalWeight > 0
      ? axisSignals.reduce((s, sig) => s + sig.score * (sig.weight / axisTotalWeight), 0)
      : 0
    const axisConfidence = axisSignals.reduce((s, sig) => s + sig.confidence, 0) / axisSignals.length
    ebrsAxes.push({
      axis,
      name: EBRS_AXES[axis].name,
      score: Math.round(axisScore * 10) / 10,
      confidence: Math.round(axisConfidence * 100) / 100,
      signalCount: axisSignals.length,
    })
  }

  // Coverage metadata — how many of the 15 possible signals were computable.
  // Companies with fewer signals may have inflated scores because problematic
  // dimensions (e.g., tax issues, procurement red flags) were simply absent.
  const signalCoverageRatio = Math.round(signalCoverage * 100)

  return {
    overall: roundedOverall,
    confidence,
    signals: activeSignals,
    ebrsAxes,
    algorithmVersion: ALGORITHM_VERSION,
    dataYears,
    riskLevel,
    growthTrend,
    marketPosition,
    margin,
    consecutiveProfitYears,
    signalCoverage: signalCoverageRatio,
    scoreState: activeSignals.length < MIN_SIGNALS_FOR_VERDICT ? 'insufficient_data' : 'ok',
    capApplied,
  }
}
