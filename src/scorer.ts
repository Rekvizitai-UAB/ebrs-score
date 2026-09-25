/** Pure EBRS algorithm. Published with identical logic in Rekvizitai-UAB/ebrs-score. */
import { SIGNAL_REGISTRY } from './signals.js'
import { resolveInsolvency } from './insolvency.js'
import { reportedProfit } from './reported-profit.js'
import { EBRS_AXES } from './types.js'
import type { CompanySignalData, ReputationScore, StoredSignalScore, EbrsAxisScore, EbrsAxis } from './types.js'

export const ALGORITHM_VERSION = 'v7.0.0'

// ── v6.0 terminal-state caps ──
// An additive composite lets 14 healthy signals outvote one catastrophic
// state: a company in active bankruptcy scored ~6.3 "Patikima" because
// legal_standing carries only ~8% weight. v6.0 treats registered insolvency
// as a CAP, not a vote: an active bankruptcy (incl. intentional) caps the
// overall below the caution band; restructuring caps it below "Patikima".
// The cap is applied AFTER coverage shrinkage and is reported via
// `capApplied` so the reasoning is transparent, never silent.
export const BANKRUPTCY_CAP = 2.9      // → risk band 'Kritinė' by threshold
export const RESTRUCTURING_CAP = 4.9   // → risk band 'Aukšta' by threshold

// ── v6.0 insufficient-data threshold ──
// Below this many computable signals the platform does not present a band
// at all - front-ends render "Nepakanka duomenų" instead of a verdict.
// The numeric overall is still computed (internal ordering, trends), but a
// verdict built on <1/3 of the evidence base is not a verdict.
export const MIN_SIGNALS_FOR_VERDICT = 5

// ── v5.3 coverage shrinkage (survivorship-bias correction) ──
// A company with few computable signals had its weights re-normalized across
// ONLY the present signals. If the absent signals are the adverse ones (tax
// debt, late/non-filing, bankruptcy, ownership opacity), the raw score is
// inflated purely by absence of scrutiny - a data-sparse company could
// out-score a fully-examined one. v5.3 regresses the headline overall toward a
// neutral prior: each MISSING signal counts as a fractional neutral
// pseudo-observation. Full coverage (13/13) = no shrinkage; sparse coverage =
// strong pull toward neutral. Per-signal and per-axis scores stay RAW (they
// report measured dimensions); only `overall` is regularized for how complete
// the evidence is. Both constants are deliberately tunable + documented.
const COVERAGE_PRIOR = 5.0                     // neutral score the overall regresses toward
const COVERAGE_PRIOR_WEIGHT_PER_MISSING = 0.5  // each missing signal = half a neutral pseudo-vote

// ── v5.3 input guards ──
// Never let NaN / Infinity / impossible values reach the signals. A corrupt
// row (e.g. year 3905, or a negative revenue) would wreck CAGR / age / log math.
const PLAUSIBLE_MIN_YEAR = 1990
// Coerce first - Drizzle returns decimal/numeric columns as STRINGS, so a
// strict Number.isFinite on the raw value would wrongly null real revenue.
function finiteOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function nonNegOrNull(v: unknown): number | null {
  const n = finiteOrNull(v)
  return n != null && n >= 0 ? n : null
}

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

/**
 * Compute reputation score from pre-gathered data.
 * Can be called with data from DB (batch) or from inline data (real-time fallback).
 */
export function computeReputation(rawData: CompanySignalData): ReputationScore | null {
  const data = sanitizeCompanyData(rawData)
  const activeSignals: StoredSignalScore[] = []

  // Run each signal - only include those that return a result
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
    sig.weight = sig.weight / totalWeight // now sums to 1.0
  }

  // Weighted average of signal scores (weights already re-normalized to sum to 1.0)
  const overall = activeSignals.reduce((s, sig) => {
    return s + sig.score * sig.weight
  }, 0)

  // v5.3 coverage shrinkage: regress the raw weighted overall toward the neutral
  // prior in proportion to how many of the 13 signals are MISSING. Each missing
  // signal acts as a fractional neutral pseudo-observation, so a data-sparse
  // company can no longer out-score a fully-examined one by absence of scrutiny.
  // Full coverage → priorWeight 0 → overall unchanged.
  const missingSignals = SIGNAL_REGISTRY.length - activeSignals.length
  const priorWeight = missingSignals * COVERAGE_PRIOR_WEIGHT_PER_MISSING
  let shrunkOverall = (overall * activeSignals.length + COVERAGE_PRIOR * priorWeight)
    / (activeSignals.length + priorWeight)

  // v6.0 terminal-state cap - registered insolvency bounds the overall no
  // matter how strong the historical signals are. Applied after shrinkage,
  // before rounding; the risk band then follows from the capped value.
  const capApplied = resolveInsolvency(data).cap
  if (capApplied === 'bankruptcy') shrunkOverall = Math.min(shrunkOverall, BANKRUPTCY_CAP)
  if (capApplied === 'restructuring') shrunkOverall = Math.min(shrunkOverall, RESTRUCTURING_CAP)

  // Overall confidence = (weighted avg of signal confidences) × (signal coverage)
  // Coverage penalty: if only 3 of 6 signals had data, max confidence is 50%
  // This ensures scores based on partial data are flagged as less certain
  const signalCoverage = activeSignals.length / SIGNAL_REGISTRY.length
  const avgConfidence = activeSignals.reduce((s, sig) => s + sig.confidence * sig.weight, 0)
  const confidence = Math.round(avgConfidence * signalCoverage * 100)

  // Data years
  const sortedRevRows = data.yearlyRows.filter(r => r.revenue && r.revenue > 0).sort((a, b) => a.year - b.year)
  const dataYears = sortedRevRows.length

  // Derived labels from actual signal results (v5.3: coverage-adjusted overall)
  const roundedOverall = Math.round(shrunkOverall * 10) / 10
  const riskLevel = roundedOverall >= 7 ? 'Žema' : roundedOverall >= 5 ? 'Vidutinė' : roundedOverall >= 3 ? 'Aukšta' : 'Kritinė'

  // Growth trend from growth signal
  const growthSig = activeSignals.find(s => s.id === 'growth_trajectory')
  const cagr = growthSig?.details?.cagr as number | undefined
  const growthTrend = cagr !== undefined
    ? (cagr >= 15 ? 'Sparčiai auga' : cagr >= 5 ? 'Auga' : cagr >= -2 ? 'Stabili' : cagr >= -10 ? 'Mažėja' : 'Sparčiai mažėja')
    : 'Nėra duomenų'

  // Market position from revenue
  const latestRev = sortedRevRows.length > 0 ? sortedRevRows[sortedRevRows.length - 1].revenue! : 0
  const marketPosition = latestRev > 86000000 ? 'Dominuojanti' : latestRev > 9000000 ? 'Stipri' : latestRev > 1000000 ? 'Įsitvirtinusi' : latestRev > 392000 ? 'Auganti' : 'Kylanti'

  // Margin from latest data. Clamp to ±9999.99 % - anything beyond is a data
  // quality issue (e.g. tiny revenue with large valuation-gain "profit" on
  // financial services entities); the DB column is decimal(10,2) which holds
  // up to ±99_999_999.99 but the signal-level reasoning is useless past 4
  // digits and used to overflow the old decimal(5,2) column.
  const latestProfit = sortedRevRows.length > 0 ? reportedProfit(sortedRevRows[sortedRevRows.length - 1]) : null
  const rawMargin = latestRev > 0 && latestProfit !== null ? Math.round((latestProfit / latestRev) * 1000) / 10 : null
  const margin = rawMargin == null ? null : Math.max(-9999.99, Math.min(9999.99, rawMargin))

  // Consecutive profit years from profitability signal
  const profSig = activeSignals.find(s => s.id === 'profitability_trend')
  const consecutiveProfitYears = (profSig?.details?.consecutiveYears as number) ?? 0

  // EBRS axis aggregation: group signals by axis, compute weighted axis scores
  const ebrsAxes: EbrsAxisScore[] = []
  const axisKeys: EbrsAxis[] = ['continuity', 'financial', 'resilience', 'transparency']
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

  return {
    overall: roundedOverall,
    confidence,
    signals: activeSignals,
    ebrsAxes,
    algorithmVersion: ALGORITHM_VERSION,
    dataYears,
    signalCoverage: Math.round(signalCoverage * 100),
    riskLevel,
    growthTrend,
    marketPosition,
    margin,
    consecutiveProfitYears,
    // v6.0 verdict metadata (derived, not persisted as columns: coverage is
    // recoverable from the signals jsonb, the cap from bankruptcy data)
    scoreState: activeSignals.length < MIN_SIGNALS_FOR_VERDICT ? 'insufficient_data' : 'ok',
    capApplied,
    jurisdiction: 'LT',
  }
}
