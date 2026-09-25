import { RC_LEGAL_STATUS } from './legal-status.js'
/** EBRS v7: 13 registry-data signals across four axes.
 * Publicity, reviews and TOP participation do not establish reliability and
 * do not affect scores, confidence, or coverage. Remaining relative weights
 * are preserved: each former weight is divided by 0.86.
 */

import type { SignalDefinition, SignalResult, CompanySignalData, YearlyRow, ProcurementData, TaxData, LegalData, ReportingData, GovernanceData, OwnershipData } from './types.js'
import { reportedProfit } from './reported-profit.js'
import { resolveInsolvency } from './insolvency.js'

// ── Math Helpers ──

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function sigmoid(x: number, center: number, steepness: number): number {
  return 10 / (1 + Math.exp(-steepness * (x - center)))
}

/**
 * Percentile rank against [P10,P25,P50,P75,P90] breakpoints → 0-10
 * Breakpoints are from actual dataset distribution (78,850 company-year records)
 */
function percentileScore(value: number, breakpoints: number[]): number {
  const [p10, p25, p50, p75, p90] = breakpoints
  if (value <= p10) return clamp(value / p10, 0, 1)
  if (value <= p25) return 1 + ((value - p10) / (p25 - p10)) * 1.5
  if (value <= p50) return 2.5 + ((value - p25) / (p50 - p25)) * 2.5
  if (value <= p75) return 5 + ((value - p50) / (p75 - p50)) * 2.5
  if (value <= p90) return 7.5 + ((value - p75) / (p90 - p75)) * 1.5
  return clamp(9 + ((value - p90) / (p90 * 0.5)), 9, 10)
}

// Fixed in v7 to preserve the existing ten-year history window without linking scores to TOP seasons.
const FINANCIAL_HISTORY_WINDOW = 10

// ── Dataset Percentiles ──
// Source: SELECT percentile_cont(array[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY X)
// FROM company_yearly_data WHERE X > 0
// Last computed: 2026-03-10 from 78,850 company-year records

const REV_LOG_MIN = Math.log10(11504)      // min revenue in dataset
const REV_LOG_MAX = Math.log10(4625124000)  // max revenue in dataset
const SALARY_BREAKPOINTS = [834, 1038, 1383, 1979, 2821] // P10,P25,P50,P75,P90
const MARGIN_BREAKPOINTS = [0.6, 2.3, 6.2, 13.2, 24.4]  // P10,P25,P50,P75,P90

// ════════════════════════════════════════════════════
// SIGNAL 1: Financial Strength
// ════════════════════════════════════════════════════

const financialStrength: SignalDefinition = {
  id: 'financial_strength',
  name: 'Finansinis pajėgumas',
  category: 'financial',
  ebrsAxis: 'financial',
  defaultWeight: 0.08,
  color: 'bg-emerald-500',

  compute(data: CompanySignalData): SignalResult | null {
    const sorted = getSortedRevRows(data.yearlyRows)
    if (sorted.length === 0) return null

    const latest = sorted[sorted.length - 1]
    const rev = latest.revenue!
    const profit = reportedProfit(latest)
    if (profit === null) return null

    // Revenue scale (log-normalized against full dataset range)
    const revLog = Math.log10(rev)
    const revScore = clamp(((revLog - REV_LOG_MIN) / (REV_LOG_MAX - REV_LOG_MIN)) * 10, 0, 10)

    // Profit margin (percentile-based)
    const margin = rev > 0 ? (profit / rev) * 100 : 0
    const marginScore = margin >= 0
      ? percentileScore(margin, MARGIN_BREAKPOINTS)
      : clamp(2 + margin / 10, 0, 2) // negative margins penalized

    // SODRA debt penalty (tax authority debt = red flag)
    // Note: SODRA penalty also applied in workforce_health - intentional double-count
    // because debt affects both financial stability AND employee welfare
    const sodraAmount = data.currentSodraDebt === undefined ? latest.sodraDebt ?? null : data.currentSodraDebt.amount
    const sodraDate = data.currentSodraDebt?.date ?? null
    const sodra = Number(sodraAmount ?? 0)
    const sodraPenalty = sodra > 0 ? -Math.min(3, Math.log10(sodra + 1) / 2) : 0

    // VMI overdue tax debt penalty (v5.0 - from data.gov.lt)
    const vmiDebt = data.taxData?.debtOverdue ?? 0
    const vmiPenalty = vmiDebt > 0 ? -Math.min(3, Math.log10(vmiDebt + 1) / 2) : 0

    // Revenue scale (35%) - size provides resilience but isn't financial health alone
    // Margin (65%) - profitability is the stronger indicator of financial strength
    const score = clamp(revScore * 0.35 + marginScore * 0.65 + sodraPenalty + vmiPenalty, 0, 10)

    // Confidence: based on data freshness and completeness
    const hasProfit = profit !== null
    const hasSodra = sodraAmount !== null
    const hasVmi = data.taxData !== null
    const currentYear = new Date().getFullYear()
    const dataAge = currentYear - latest.year // 0 = current year data
    const freshnessPenalty = dataAge >= 3 ? -0.2 : dataAge >= 2 ? -0.1 : 0
    const confidence = clamp(0.6 + (hasProfit ? 0.20 : 0) + (hasSodra ? 0.10 : 0) + (hasVmi ? 0.10 : 0) + freshnessPenalty, 0, 1)

    return {
      score,
      confidence,
      dataPoints: 1 + (hasProfit ? 1 : 0) + (hasSodra ? 1 : 0) + (hasVmi ? 1 : 0),
      reasoning: `Pajamos: ${formatEur(rev)}, pelno marža: ${margin.toFixed(1)}%${sodra > 0 ? `, SODRA skola: ${formatEur(sodra)}` : ''}${vmiDebt > 0 ? `, VMI skola: ${formatEur(vmiDebt)}` : ''}`,
      details: { revScore, marginScore, sodraPenalty, vmiPenalty, margin, revenue: rev, sodraDebt: sodraAmount, sodraDebtDate: sodraDate, vmiDebt },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 2: Growth Trajectory
// ════════════════════════════════════════════════════

const growthTrajectory: SignalDefinition = {
  id: 'growth_trajectory',
  name: 'Augimo trajektorija',
  category: 'growth',
  ebrsAxis: 'financial',
  defaultWeight: 0.05,
  color: 'bg-blue-500',

  compute(data: CompanySignalData): SignalResult | null {
    const sorted = getSortedRevRows(data.yearlyRows)
    if (sorted.length < 2) return null // Need at least 2 years

    const firstRev = sorted[0].revenue!
    const latestRev = sorted[sorted.length - 1].revenue!
    const yearsSpan = sorted[sorted.length - 1].year - sorted[0].year

    // CAGR (Compound Annual Growth Rate)
    let cagrScore = 5
    let cagr = 0
    if (yearsSpan > 0 && firstRev > 0) {
      cagr = (Math.pow(latestRev / firstRev, 1 / yearsSpan) - 1) * 100
      cagrScore = sigmoid(cagr, 5, 0.15) // 5% CAGR = midpoint
    }

    // Growth consistency: direction-based (not CV, which penalizes variable-but-positive growth)
    const growthRates: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].revenue!
      if (prev > 0) growthRates.push(((sorted[i].revenue! - prev) / prev) * 100)
    }

    let consistencyScore = 5
    let momentumScore = 5

    if (growthRates.length >= 2) {
      const mean = growthRates.reduce((s, v) => s + v, 0) / growthRates.length
      // Direction consistency: what fraction of years maintained growth direction?
      const positiveYears = growthRates.filter(r => r >= -2).length // >-2% = not a real decline
      const directionRatio = positiveYears / growthRates.length
      // Growing consistently = high score, declining consistently = moderate, mixed = low
      if (mean > 0) {
        consistencyScore = clamp(4 + directionRatio * 6, 0, 10) // all positive → 10
      } else {
        consistencyScore = clamp(2 + directionRatio * 4, 0, 6) // declining but consistent → max 6
      }

      // Momentum: recent 2 years vs older average
      if (growthRates.length >= 3) {
        const recentAvg = growthRates.slice(-2).reduce((s, v) => s + v, 0) / 2
        const olderAvg = growthRates.slice(0, -2).reduce((s, v) => s + v, 0) / Math.max(1, growthRates.length - 2)
        momentumScore = clamp(5 + (recentAvg - olderAvg) * 0.2, 0, 10)
      }
    }

    const score = cagrScore * 0.5 + consistencyScore * 0.25 + momentumScore * 0.25

    // Confidence scales with number of data years + freshness
    const yearFactor = Math.min(sorted.length / 9, 1) // max at 9 years
    const rateFactor = Math.min(growthRates.length / 8, 1)
    const currentYear = new Date().getFullYear()
    const latestYear = sorted[sorted.length - 1].year
    const freshnessPenalty = (currentYear - latestYear) >= 3 ? -0.15 : (currentYear - latestYear) >= 2 ? -0.08 : 0
    const confidence = clamp(yearFactor * 0.6 + rateFactor * 0.4 + freshnessPenalty, 0, 1)

    return {
      score,
      confidence,
      dataPoints: sorted.length,
      reasoning: `CAGR: ${cagr.toFixed(1)}% per ${yearsSpan} m., ${growthRates.length} augimo taškų, nuoseklumas: ${consistencyScore.toFixed(1)}/10`,
      details: { cagr, cagrScore, consistencyScore, momentumScore, yearsSpan, growthRates },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 3: Profitability Trend
// ════════════════════════════════════════════════════

const profitabilityTrend: SignalDefinition = {
  id: 'profitability_trend',
  name: 'Pelningumo tendencija',
  category: 'profitability',
  ebrsAxis: 'financial',
  defaultWeight: 0.05,
  color: 'bg-violet-500',

  compute(data: CompanySignalData): SignalResult | null {
    const sorted = getSortedRevRows(data.yearlyRows)
    if (sorted.length === 0) return null

    const latest = sorted[sorted.length - 1]
    const latestProfit = latest.profit
    const latestRev = latest.revenue!

    // Margins over time for regression
    const margins = sorted
      .filter(r => reportedProfit(r) !== null && r.revenue && r.revenue > 0)
      .map(r => ({ year: r.year, margin: (reportedProfit(r)! / r.revenue!) * 100 }))
    if (margins.length === 0) return null

    // Margin trend (linear regression slope)
    let marginTrendScore = 5
    let slope = 0
    if (margins.length >= 2) {
      const n = margins.length
      const xMean = margins.reduce((s, m) => s + m.year, 0) / n
      const yMean = margins.reduce((s, m) => s + m.margin, 0) / n
      const num = margins.reduce((s, m) => s + (m.year - xMean) * (m.margin - yMean), 0)
      const den = margins.reduce((s, m) => s + (m.year - xMean) ** 2, 0)
      slope = den > 0 ? num / den : 0 // percentage points per year
      marginTrendScore = clamp(5 + slope * 2, 0, 10)
    }

    // Consecutive profitable years (backwards from latest)
    let consecutiveYears = 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      // A missing calendar year cannot support a consecutive-year claim.
      if (sorted[i].year !== latest.year - consecutiveYears) break
      const profit = reportedProfit(sorted[i])
      if (profit !== null && profit > 0) consecutiveYears++
      else break
    }
    // 8+ years profitable = 10/10. Each year = 1.25 points.
    const consecutiveProfitScore = Math.min(10, consecutiveYears * 1.25)

    // Net-to-gross profit efficiency
    let efficiencyScore = 5 // neutral if no data
    let hasEfficiency = false
    if (latest.netProfit !== null && latestProfit !== null && latestProfit > 0) {
      efficiencyScore = clamp((latest.netProfit / latestProfit) * 10, 0, 10)
      hasEfficiency = true
    }

    const score = marginTrendScore * 0.5 + consecutiveProfitScore * 0.3 + efficiencyScore * 0.2

    // Confidence based on how many margin data points we have
    const marginFactor = Math.min(margins.length / 8, 1)
    const effFactor = hasEfficiency ? 1 : 0
    const confidence = clamp(marginFactor * 0.5 + (consecutiveYears > 0 ? 0.3 : 0) + effFactor * 0.2, 0, 1)

    return {
      score,
      confidence,
      dataPoints: margins.length + (hasEfficiency ? 1 : 0),
      reasoning: `${margins.length >= 2 ? `Maržos pokytis: ${slope >= 0 ? '+' : ''}${slope.toFixed(2)} pp/m.` : 'Maržos tendencijai nepakanka duomenų'}, patvirtinti pelningi metai iš eilės: ${consecutiveYears}`,
      details: { marginTrendScore, consecutiveProfitScore, efficiencyScore, slope, consecutiveYears, margins: margins.length },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 4: Workforce Health
// ════════════════════════════════════════════════════

const workforceHealth: SignalDefinition = {
  id: 'workforce_health',
  name: 'Darbuotojų gerovė',
  category: 'workforce',
  ebrsAxis: 'resilience',
  defaultWeight: 0.07,
  color: 'bg-amber-500',

  compute(data: CompanySignalData): SignalResult | null {
    const sorted = getSortedRevRows(data.yearlyRows)
    if (sorted.length === 0) return null

    const latest = sorted[sorted.length - 1]
    const sodraAmount = data.currentSodraDebt === undefined ? latest.sodraDebt ?? null : data.currentSodraDebt.amount
    const sodraDate = data.currentSodraDebt?.date ?? null
    const sodra = Number(sodraAmount ?? 0)

    // Use last valid salary row, NOT latest revenue row - the latest revenue row
    // may have missing salary data, which would manufacture a false 0 salary.
    const salaryRows = sorted.filter(r => r.salary && Number(r.salary) > 0)
    const latestSalary = salaryRows.length > 0 ? Number(salaryRows[salaryRows.length - 1].salary!) : 0

    // Salary percentile (against Lithuanian market distribution)
    let salaryScore: number | null = null
    if (latestSalary > 0) {
      salaryScore = percentileScore(latestSalary, SALARY_BREAKPOINTS)
    }

    // Salary growth (CAGR over available salary rows only)
    let salaryGrowthScore: number | null = null
    if (salaryRows.length >= 2) {
      const firstSalary = Number(salaryRows[0].salary!)
      const lastSalaryVal = Number(salaryRows[salaryRows.length - 1].salary!)
      const span = salaryRows[salaryRows.length - 1].year - salaryRows[0].year
      if (span > 0 && firstSalary > 0) {
        const salCagr = (Math.pow(lastSalaryVal / firstSalary, 1 / span) - 1) * 100
        salaryGrowthScore = sigmoid(salCagr, 3, 0.2) // 3% salary CAGR = midpoint
      }
    }

    // Employee stability: measures workforce health direction.
    // Growing = good, shrinking = bad. Consistent direction = best.
    let empStabilityScore: number | null = null
    const empRows = sorted.filter(r => r.employees && r.employees > 0)
    if (empRows.length >= 2) {
      const empChanges: number[] = []
      for (let i = 1; i < empRows.length; i++) {
        const prev = empRows[i - 1].employees!
        if (prev > 0) empChanges.push(((empRows[i].employees! - prev) / prev) * 100)
      }
      if (empChanges.length > 0) {
        const mean = empChanges.reduce((s, v) => s + v, 0) / empChanges.length
        // Count years of growth (>-2% = not a real cut)
        const growthYears = empChanges.filter(c => c >= -2).length
        const directionRatio = growthYears / empChanges.length
        // Net change: first → last employee count
        const netGrowth = ((empRows[empRows.length - 1].employees! - empRows[0].employees!) / empRows[0].employees!) * 100

        if (mean > 2) {
          // Growing workforce: reward consistent direction, not uniform rate
          // directionRatio 1.0 = grew every year → 9-10, 0.7 = mostly grew → 7-8
          empStabilityScore = clamp(5 + directionRatio * 5, 5, 10)
        } else if (mean > -2) {
          // Stable workforce (minimal change) - solid but not exceptional
          empStabilityScore = clamp(6 + directionRatio * 2, 4, 8)
        } else {
          // Shrinking workforce - lower base, direction ratio still helps
          empStabilityScore = clamp(2 + directionRatio * 3, 0, 5)
        }
      }
    }

    // SODRA debt penalty (unpaid social insurance = workforce red flag)
    // Note: also applied in financial_strength - intentional, affects both dimensions
    const sodraPenalty = sodra > 0 ? -Math.min(3, Math.log10(sodra + 1) / 2) : 0

    // Build score from available sub-scores only (no defaults!)
    const subScores: { value: number; weight: number }[] = []
    if (salaryScore !== null) subScores.push({ value: salaryScore, weight: 0.30 })
    if (salaryGrowthScore !== null) subScores.push({ value: salaryGrowthScore, weight: 0.25 })
    if (empStabilityScore !== null) subScores.push({ value: empStabilityScore, weight: 0.45 })

    if (subScores.length === 0) return null // No workforce data at all

    // Normalize weights to sum to 1
    const totalWeight = subScores.reduce((s, ss) => s + ss.weight, 0)
    const weightedScore = subScores.reduce((s, ss) => s + ss.value * (ss.weight / totalWeight), 0)

    const score = clamp(weightedScore + sodraPenalty, 0, 10)
    const confidence = subScores.length / 3 // 1/3, 2/3, or 1

    return {
      score,
      confidence,
      dataPoints: (salaryScore !== null ? 1 : 0) + salaryRows.length + empRows.length,
      reasoning: [
        salaryScore !== null ? `Atlyginimas: ${formatEur(latestSalary)}` : null,
        salaryGrowthScore !== null ? `Atl. augimas: ${salaryGrowthScore.toFixed(1)}/10` : null,
        empStabilityScore !== null ? `Darbuotojų stabilumas: ${empStabilityScore.toFixed(1)}/10` : null,
        sodra > 0 ? `SODRA skola: ${formatEur(sodra)} (bauda)` : null,
      ].filter(Boolean).join(', '),
      details: { salaryScore, salaryGrowthScore, empStabilityScore, sodraPenalty, latestSalary, sodraDebt: sodraAmount, sodraDebtDate: sodraDate },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 7: Continuity Capital (EBRS Tęstinumas)
// ════════════════════════════════════════════════════

const continuityCapital: SignalDefinition = {
  id: 'continuity_capital',
  name: 'Tęstinumo kapitalas',
  category: 'continuity',
  ebrsAxis: 'continuity',
  defaultWeight: 0.08,
  color: 'bg-indigo-500',

  compute(data: CompanySignalData): SignalResult | null {
    const { foundedYear, yearlyRows, legalData } = data
    const currentYear = new Date().getFullYear()

    // Years in business - prefer RC JAR registration date (authoritative)
    let yearsInBusiness: number | null = null
    if (legalData?.registrationDate) {
      yearsInBusiness = currentYear - legalData.registrationDate.getFullYear()
    } else if (foundedYear && foundedYear > 1900 && foundedYear <= currentYear) {
      yearsInBusiness = currentYear - foundedYear
    } else if (yearlyRows.length > 0) {
      const earliest = Math.min(...yearlyRows.map(r => r.year))
      yearsInBusiness = currentYear - earliest
    }

    // Data continuity: how many consecutive years of financial data exist
    const sortedYears = [...yearlyRows]
      .filter(r => r.revenue && r.revenue > 0)
      .map(r => r.year)
      .sort((a, b) => a - b)

    if (yearsInBusiness === null && sortedYears.length === 0) return null

    // Longevity score: 30+ years = 10/10, scaled logarithmically
    // Young companies aren't penalized harshly - 5 years = ~5/10
    let longevityScore = 5
    if (yearsInBusiness !== null) {
      longevityScore = clamp(Math.log2(yearsInBusiness + 1) / Math.log2(32) * 10, 0, 10)
    }

    let maxConsecutive = 0
    let currentStreak = 1
    for (let i = 1; i < sortedYears.length; i++) {
      if (sortedYears[i] === sortedYears[i - 1] + 1) {
        currentStreak++
      } else {
        maxConsecutive = Math.max(maxConsecutive, currentStreak)
        currentStreak = 1
      }
    }
    maxConsecutive = Math.max(maxConsecutive, currentStreak)
    // 9 consecutive years = 10/10
    const dataContinuityScore = sortedYears.length > 0
      ? clamp(maxConsecutive / FINANCIAL_HISTORY_WINDOW * 10, 0, 10)
      : 0

    // v5.1: TOP list removed from continuity - it's a platform metric, not an
    // objective business continuity indicator.
    // at reduced weight (30%). Continuity now measured purely by age + data history.
    const parts: { value: number; weight: number }[] = []
    if (yearsInBusiness !== null) parts.push({ value: longevityScore, weight: 0.55 })
    if (sortedYears.length > 0) parts.push({ value: dataContinuityScore, weight: 0.45 })

    const totalW = parts.reduce((s, p) => s + p.weight, 0)
    const score = totalW > 0 ? parts.reduce((s, p) => s + p.value * (p.weight / totalW), 0) : 0

    const confidence = clamp(
      (yearsInBusiness !== null ? 0.5 : 0) +
      (sortedYears.length >= 3 ? 0.5 : sortedYears.length > 0 ? 0.25 : 0),
      0, 1
    )

    return {
      score,
      confidence,
      dataPoints: (yearsInBusiness !== null ? 1 : 0) + sortedYears.length,
      reasoning: [
        yearsInBusiness !== null ? `Veikla: ${yearsInBusiness} m.` : null,
        sortedYears.length > 0 ? `Finansiniai duomenys: ${maxConsecutive} m. iš eilės` : null,
      ].filter(Boolean).join(', '),
      details: { longevityScore, dataContinuityScore, yearsInBusiness, maxConsecutive },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 8: Resilience (EBRS Atsparumas)
// ════════════════════════════════════════════════════

const resilience: SignalDefinition = {
  id: 'resilience',
  name: 'Verslo atsparumas',
  category: 'resilience',
  ebrsAxis: 'resilience',
  defaultWeight: 0.07,
  color: 'bg-orange-500',

  compute(data: CompanySignalData): SignalResult | null {
    const sorted = getSortedRevRows(data.yearlyRows)
    if (sorted.length < 3) return null // Need 3+ years to assess resilience

    const revenues = sorted.map(r => r.revenue!)

    // Year-over-year growth rates
    const yoyChanges: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].revenue!
      if (prev > 0) yoyChanges.push((sorted[i].revenue! - prev) / prev)
    }

    // Revenue stability: measure consistency of growth DIRECTION, not raw CV.
    // Raw CV of revenue levels penalizes growth (50M→250M = high CV even if steady).
    // Instead: count how many years had positive growth, and measure directional consistency.
    const positiveYears = yoyChanges.filter(c => c >= -0.02).length // >-2% = not a real decline
    const directionRatio = yoyChanges.length > 0 ? positiveYears / yoyChanges.length : 0
    // Also measure smoothness: std of growth rates (lower = more predictable)
    const growthMean = yoyChanges.length > 0 ? yoyChanges.reduce((s, v) => s + v, 0) / yoyChanges.length : 0
    const growthStd = yoyChanges.length > 1
      ? Math.sqrt(yoyChanges.reduce((s, v) => s + (v - growthMean) ** 2, 0) / yoyChanges.length)
      : 0
    // Smoothness: growthStd < 0.05 = very smooth, > 0.3 = volatile
    const smoothnessScore = clamp(10 - growthStd * 20, 2, 10)
    // Combined: direction consistency (60%) + smoothness (40%)
    const stabilityScore = clamp(directionRatio * 10 * 0.6 + smoothnessScore * 0.4, 0, 10)

    // Revenue dips (>5% decline)
    const dips = yoyChanges
      .map((change, idx) => ({ change, idx }))
      .filter(d => d.change < -0.05)

    // Data depth factor: 3 years = 0.33, 6 years = 0.67, 9 years = 1.0
    const depthFactor = Math.min(sorted.length / 9, 1)

    // Recovery speed: after a revenue dip, how quickly does the company recover?
    let recoveryScore = 5 // neutral default
    if (dips.length > 0) {
      let totalRecovery = 0
      let recoveries = 0
      for (const dip of dips) {
        if (dip.idx + 1 < yoyChanges.length) {
          const nextChange = yoyChanges[dip.idx + 1]
          if (nextChange > 0) {
            totalRecovery += nextChange
            recoveries++
          }
        }
      }
      if (recoveries > 0) {
        const avgRecovery = totalRecovery / recoveries
        recoveryScore = clamp(5 + avgRecovery * 30, 2, 10)
      } else {
        recoveryScore = clamp(3 - dips.length * 0.5, 0, 4)
      }
    } else {
      // No dips - scale by data depth (more years without dip = more proven)
      recoveryScore = 5 + depthFactor * 3
    }

    // Never-negative profit bonus
    const profitRows = sorted.filter(r => reportedProfit(r) !== null)
    let neverLossBonus = 0
    if (profitRows.length >= 3) {
      const lossYears = profitRows.filter(r => reportedProfit(r)! < 0).length
      if (lossYears === 0) neverLossBonus = depthFactor * 0.5
      else if (lossYears === 1) neverLossBonus = depthFactor * 0.2
    }

    const score = clamp(stabilityScore * 0.50 + recoveryScore * 0.50 + neverLossBonus, 0, 10)

    const confidence = clamp(
      Math.min(sorted.length / 9, 1) * 0.7 +
      (profitRows.length >= 3 ? 0.3 : profitRows.length > 0 ? 0.15 : 0),
      0, 1
    )

    return {
      score,
      confidence,
      dataPoints: sorted.length,
      reasoning: `Pajamų stabilumas: ${stabilityScore.toFixed(1)}/10, atsigavimas: ${recoveryScore.toFixed(1)}/10` +
        (dips.length > 0 ? `, nuosmukių: ${dips.length}` : ', nuosmukių nebuvo') +
        (neverLossBonus > 0 ? ', nuostolių neturėjo' : ''),
      details: { stabilityScore, recoveryScore, neverLossBonus, smoothnessScore, directionRatio, growthStd, dipsCount: dips.length, yearsAnalyzed: sorted.length },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 9: Transparency (EBRS Skaidrumas)
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// SIGNAL 9: Data Completeness (EBRS v5.0 - replaces old transparency)
// ════════════════════════════════════════════════════
// NOTE: The old transparency signal (v4.0) measured platform engagement
// (activation tier + community engagement). This was unfair - it penalized
// companies for not subscribing to topimones.lt. v5.0 demotes this to a
// low-weight data-quality signal and adds 4 government-verified signals
// for real transparency measurement.

const transparency: SignalDefinition = {
  id: 'transparency',
  name: 'Duomenų pilnumas',
  category: 'transparency',
  ebrsAxis: 'transparency',
  defaultWeight: 0.02,
  color: 'bg-fuchsia-500',

  compute(data: CompanySignalData): SignalResult | null {
    const { yearlyRows } = data

    // v5.0: Returns null if no data (instead of always returning)
    if (yearlyRows.length === 0) return null

    // Data completeness: what % of possible data fields are filled?
    let filledFields = 0
    let totalPossibleFields = 0
    for (const row of yearlyRows) {
      totalPossibleFields += 6
      if (row.revenue !== null && row.revenue > 0) filledFields++
      if (row.profit !== null) filledFields++
      if (row.netProfit !== null) filledFields++
      if (row.employees !== null && row.employees > 0) filledFields++
      if (row.salary !== null && Number(row.salary) > 0) filledFields++
      if (row.sodraDebt !== null) filledFields++
    }
    const completenessRatio = totalPossibleFields > 0 ? filledFields / totalPossibleFields : 0
    const completenessScore = clamp(completenessRatio * 10, 0, 10)

    const yearsReported = yearlyRows.length
    const yearsCoverage = clamp(yearsReported / FINANCIAL_HISTORY_WINDOW * 10, 0, 10)

    // NO activation tier. NO engagement. Just data quality.
    const score = completenessScore * 0.60 + yearsCoverage * 0.40

    const confidence = clamp(Math.min(yearlyRows.length / 5, 1), 0, 1)

    return {
      score,
      confidence,
      dataPoints: yearlyRows.length,
      reasoning: `Duomenų pilnumas: ${(completenessRatio * 100).toFixed(0)}%, metų: ${yearsReported}`,
      details: { completenessScore, yearsCoverage, completenessRatio, yearsReported },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 10: Procurement Integrity (VPT data.gov.lt)
// DIGIWHIST-inspired integrity scoring
// ════════════════════════════════════════════════════

const procurementIntegrity: SignalDefinition = {
  id: 'procurement_integrity',
  name: 'Viešųjų pirkimų patikimumas',
  category: 'transparency',
  ebrsAxis: 'transparency',
  defaultWeight: 0.09,
  color: 'bg-sky-500',

  compute(data: CompanySignalData): SignalResult | null {
    const proc = data.procurementData
    if (!proc || proc.bidsCount === 0) return null

    // Sub-indicator 1: Bid frequency (activity level) - continuous log scale
    // 1 bid = 3, 4 bids = 7, 8 bids = 9, 10+ bids = 9 (capped)
    const bidFreqScore = clamp(3 + Math.log2(proc.bidsCount) * 2, 3, 9)

    // Sub-indicator 2: Win rate (competitiveness)
    const winRate = proc.winRate ?? (proc.bidsCount > 0 ? proc.winsCount / proc.bidsCount : 0)
    const winRateScore = winRate > 0.80 ? 7 // Suspiciously high
      : winRate > 0.50 ? 9
      : winRate > 0.20 ? 8
      : winRate > 0.01 ? 5
      : 2

    // Sub-indicator 3: Procedure type (open = transparent)
    const procedureScore = proc.avgProcedureScore !== null ? clamp(proc.avgProcedureScore, 0, 10) : 7

    // Sub-indicator 4: Rejection rate (clean record)
    const rejRate = proc.rejectionRate ?? (proc.bidsCount > 0 ? proc.rejectionsCount / proc.bidsCount : 0)
    const rejectionScore = rejRate > 0.50 ? 3
      : rejRate > 0.20 ? 5
      : rejRate > 0.01 ? 7
      : 9

    // Sub-indicator 5: Recency (active in procurement)
    let recencyScore = 5
    if (proc.lastContractDate) {
      const yearsAgo = (Date.now() - proc.lastContractDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      recencyScore = yearsAgo < 1 ? 10
        : yearsAgo < 2 ? 7
        : yearsAgo < 3 ? 5
        : yearsAgo < 5 ? 3
        : 1
    }

    // Sub-indicator 6: Subcontractor bonus
    const subcontractorBonus = proc.isSubcontractor ? 0.5 : 0

    const score = clamp(
      bidFreqScore * 0.20 +
      winRateScore * 0.25 +
      procedureScore * 0.20 +
      rejectionScore * 0.20 +
      recencyScore * 0.15 +
      subcontractorBonus,
      0, 10
    )

    const confidence = clamp(proc.bidsCount / 10, 0.3, 1.0)

    return {
      score,
      confidence,
      dataPoints: proc.bidsCount,
      reasoning: `${proc.bidsCount} dalyvavimų, ${proc.winsCount} laimėjimų (${(winRate * 100).toFixed(0)}%), vertė: ${formatEur(proc.totalValueWon)}`,
      details: { bidFreqScore, winRateScore, procedureScore, rejectionScore, recencyScore, subcontractorBonus, ...proc },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 11: Tax Discipline (VMI data.gov.lt)
// ════════════════════════════════════════════════════

const taxDiscipline: SignalDefinition = {
  id: 'tax_discipline',
  name: 'Mokestinė drausmė',
  category: 'financial',
  ebrsAxis: 'financial',
  defaultWeight: 0.06,
  color: 'bg-lime-500',

  compute(data: CompanySignalData): SignalResult | null {
    const tax = data.taxData
    if (!tax) return null

    // Base score from debt status - continuous, not stepped
    // Clean record = 9.5 (near-perfect), debt penalized logarithmically
    let base: number
    if (!tax.hasDebt || tax.debtOverdue === 0) {
      base = 9.5
    } else {
      // Defensive: treat negative debt as zero (no debt)
      const debt = Math.max(tax.debtOverdue, 0)
      if (debt === 0) {
        base = 9.5
      } else {
      // Continuous log penalty, shifted so small debts are moderate:
      // €1K → ~7.5, €10K → ~5.5, €100K → ~3.5, €1M → ~1.5
      // The (log10 - 2) shift means debts under ~€100 barely register.
      base = clamp(9.5 - (Math.log10(debt) - 2) * 2, 0, 9.5)
      }
    }

    // Tax growth comparison REMOVED in v5.2.
    // VMI "sumokėti mokesčiai" publishes cumulative YTD values updated monthly.
    // Comparing annualTaxCurrent (YTD) to annualTaxPrevious (full year) produces
    // meaningless ratios unless the ETL aligns same-month periods. Since we cannot
    // guarantee period alignment, we score only on debt status (objective, binary).
    const growthBonus = 0

    const score = clamp(base + growthBonus, 0, 10)
    const confidence = 0.7 // debt-only, no YoY comparison

    return {
      score,
      confidence,
      dataPoints: 1,
      reasoning: tax.hasDebt && tax.debtOverdue > 0
        ? `Pradelsta mokestinė skola: ${formatEur(tax.debtOverdue)}`
        : `Mokestinių skolų nėra`,
      details: { base, growthBonus, ...tax },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 12: Legal Standing (RC JAR + VMI)
// ════════════════════════════════════════════════════

// RC JAR classifier UUID → Lithuanian label mappings
// Source: https://get.data.gov.lt/datasets/gov/rc/jar/formos_statusai/
const RC_STATUS_MAP = RC_LEGAL_STATUS
const RC_FORM_MAP: Record<string, string> = {
  '5c444113-5081-4d88-b94d-782c0779bb89': 'UAB',
  'd272e72b-1ac8-45a5-9742-24470bdf52eb': 'AB',
  'cc5df44f-de10-47c4-a2b7-36191f606f26': 'MB',
  'b5bb0de5-88ab-47d8-86c3-d0391e3c45b3': 'VšĮ',
  'c06e2c5e-bbc3-4654-82c7-6fd326316feb': 'Asociacija',
  'af7cdb06-dc03-4d56-b96c-91392d1e0a03': 'Kooperatinė bendrovė',
  '2cff0970-76ca-46d2-9bd6-425d1f7745bd': 'ŽŪB',
  '8712b5b4-7934-407b-b48b-1026c87fed2f': 'IĮ',
  'f7c04aa0-a7d1-4690-a386-149f02fdb910': 'Užsienio JA filialas',
  'c7fda07b-1689-42d3-8412-24d375f01bcb': 'Biudžetinė įstaiga',
  'd28464c9-c8e8-4405-ae82-d492fedc7257': 'TŪB',
  '39c102dd-d267-43cd-8a51-a09f0c89a94e': 'KŪB',
  'a788ac4d-782c-45cb-be8b-15a11409e14a': 'Labdaros ir paramos fondas',
  '3ea86c95-ee10-4167-a22b-30d7c1ffa670': 'Valstybės įmonė',
  '09bf45e2-a98d-4af5-af37-68ffc88868cb': 'Kredito unija',
  'ca85a63f-f6ab-4e61-8982-0438f1f092aa': 'Spec. paskirties UAB',
  '44bf9462-9805-4979-badd-624812a546df': 'Spec. paskirties AB',
  'cc8c8e1a-e309-42ea-aea5-ab0af7777e1e': 'Kooperacijos UAB',
}

// Resolve UUID to label. Unknown UUIDs → 'Nežinomas', not 'Veikianti'.
// Treating unknown future classifier IDs as active is unsafe - unknown should stay unknown.
function resolveStatus(uuid: string | null): string {
  if (!uuid) return 'Nežinomas'
  return RC_STATUS_MAP[uuid] ?? 'Nežinomas'
}
function resolveForm(uuid: string | null): string {
  if (!uuid) return ''
  return RC_FORM_MAP[uuid] ?? ''
}

const legalStanding: SignalDefinition = {
  id: 'legal_standing',
  name: 'Teisinis statusas',
  category: 'continuity',
  ebrsAxis: 'continuity',
  defaultWeight: 0.08,
  color: 'bg-teal-500',

  compute(data: CompanySignalData): SignalResult | null {
    const legal = data.legalData
    const insolvency = resolveInsolvency(data)
    if (insolvency.cap) {
      const sourceLabels = { operator: 'Dokumentu pagrįsta patikslinta informacija', register: 'Juridinių asmenų registras', avnt: 'AVNT duomenys' }
      const source = sourceLabels[insolvency.source!]
      return {
        score: insolvency.cap === 'bankruptcy' ? 0 : 2,
        confidence: 1.0,
        dataPoints: 1,
        reasoning: `${source}: ${insolvency.label}.`,
        details: { source: insolvency.source, status: insolvency.cap, legalStatus: data.legalStatus ?? null },
      }
    }

    if (!legal) return null

    const statusLabel = resolveStatus(legal.status)
    const formLabel = resolveForm(legal.legalForm)

    // Company age from authoritative RC JAR registration date
    let ageScore = 5
    const currentYear = new Date().getFullYear()
    if (legal.registrationDate) {
      const age = currentYear - legal.registrationDate.getFullYear()
      ageScore = clamp(Math.log2(Math.max(age, 1) + 1) / Math.log2(50) * 8, 0, 8)
    }

    // Active status bonus - only if status is known (not 'Nežinomas')
    const statusKnown = statusLabel !== 'Nežinomas'
    const activeBonus = legal.isActiveInRc ? 2.0 : (statusKnown ? 1.0 : 0)

    // Status stability: no status change in last 2 years
    let stabilityBonus = 0
    if (legal.statusDate) {
      const yearsSinceChange = (Date.now() - legal.statusDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      if (yearsSinceChange >= 2) stabilityBonus = 0.5
    }

    const score = clamp(ageScore + activeBonus + stabilityBonus, 0, 10)
    // Lower confidence when status UUID is unknown - we can't be sure it's healthy
    const confidence = statusKnown ? 0.9 : 0.6

    return {
      score,
      confidence,
      dataPoints: 1,
      reasoning: [
        legal.registrationDate ? `Registracija: ${legal.registrationDate.getFullYear()} m.` : null,
        `Statusas: ${statusLabel}`,
        formLabel ? `Forma: ${formLabel}` : null,
      ].filter(Boolean).join(', '),
      details: { ageScore, activeBonus, stabilityBonus, ...legal },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 13: Reporting Compliance (RC JAR blacklists)
// Government-published lists of non-compliant companies
// ════════════════════════════════════════════════════

const reportingCompliance: SignalDefinition = {
  id: 'reporting_compliance',
  name: 'Atskaitomybės drausmė',
  category: 'transparency',
  ebrsAxis: 'transparency',
  defaultWeight: 0.10,
  color: 'bg-red-400',

  compute(data: CompanySignalData): SignalResult | null {
    const reporting = data.reportingData
    if (!reporting) return null

    let score = 10 // Start clean, penalize for violations
    const currentYear = new Date().getFullYear()

    // Non-filing is the worst violation - but recovery matters
    if (reporting.isNonFiler) {
      const yearsAgo = currentYear - (reporting.nonFiledYear ?? currentYear)
      if (yearsAgo <= 1) score = 0        // Didn't file THIS/last year - critical
      else if (yearsAgo <= 2) score = 2   // Recent non-filing
      else if (yearsAgo <= 3) score = 4   // Recovering
      else if (yearsAgo <= 5) score = 6   // Historical, been clean since
      else score = 7                       // Long-ago non-filing, largely recovered
    }

    // Late filing is moderate but CURRENT, so worse than historical non-filing recovery
    if (reporting.isLateFiler && !reporting.isNonFiler) {
      score = 4
    }

    // Missing audit when required
    if (reporting.isMissingAudit) {
      const auditYearsAgo = currentYear - (reporting.missingAuditYear ?? currentYear)
      if (auditYearsAgo <= 2) score = Math.min(score, 2)
      else score = Math.min(score, 5)
    }

    const confidence = 0.9 // Government data is highly reliable

    return {
      score,
      confidence,
      dataPoints: 3, // checked against 3 blacklists
      reasoning: reporting.isNonFiler
        ? `Nepateikė finansinių ataskaitų (${reporting.nonFiledYear} m.)`
        : reporting.isLateFiler
        ? `Vėluoja pateikti finansines ataskaitas`
        : reporting.isMissingAudit
        ? `Nepateikė auditoriaus išvados (${reporting.missingAuditYear} m.)`
        : `Finansinės ataskaitos pateiktos laiku`,
      details: { ...reporting },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 14: Governance Quality (RC JAR valdymo_organai)
// ════════════════════════════════════════════════════

const governanceQuality: SignalDefinition = {
  id: 'governance_quality',
  name: 'Valdymo kokybė',
  category: 'transparency',
  ebrsAxis: 'transparency',
  defaultWeight: 0.06,
  color: 'bg-purple-400',

  compute(data: CompanySignalData): SignalResult | null {
    const gov = data.governanceData
    if (!gov) return null

    // Governance scoring: measure quality of governance that EXISTS,
    // not penalize absence of bodies not required by law.
    // Most Lithuanian UABs only need a director - a board/council is optional.
    // Score: base from director presence + bonus for additional governance layers.
    let structureScore = 0
    const bodies: string[] = []
    if (gov.hasDirector) { structureScore += 6; bodies.push('Vadovas') }
    if (gov.hasBoard) { structureScore += 2; bodies.push('Valdyba') }
    if (gov.hasCouncil) { structureScore += 1.5; bodies.push('Stebėtojų taryba') }
    if (gov.hasOtherBodies) { structureScore += 0.5; bodies.push('Kiti organai') }
    // A UAB with just a director = 6/10 structure (not penalized)
    // AB with full governance (director+board+council+other) = 10/10

    // Director tenure stability (leadership continuity)
    let tenureScore = 5
    if (gov.directorSinceDate) {
      const yearsAsTenure = (Date.now() - gov.directorSinceDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      // Continuous instead of step: log-scaled, 5+ years → 9-10
      tenureScore = clamp(4 + Math.log2(Math.max(yearsAsTenure, 0.25) + 1) * 2, 3, 10)
    }

    const score = clamp(structureScore * 0.60 + tenureScore * 0.40, 0, 10)
    const confidence = 0.85

    return {
      score,
      confidence,
      dataPoints: 1,
      reasoning: bodies.length > 0 ? bodies.join(' + ') : 'Nėra valdymo organų duomenų',
      details: { structureScore, tenureScore, ...gov },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL 15: Ownership Transparency (JADIS)
// ════════════════════════════════════════════════════

const ownershipTransparency: SignalDefinition = {
  id: 'ownership_transparency',
  name: 'Nuosavybės skaidrumas',
  category: 'transparency',
  ebrsAxis: 'transparency',
  defaultWeight: 0.05,
  color: 'bg-pink-400',

  compute(data: CompanySignalData): SignalResult | null {
    const owner = data.ownershipData
    if (!owner || !owner.hasJadisData) return null

    // ── v6.0 rewrite: DECLARATION COMPLETENESS, not owner nationality ──
    // The v5.x ladder penalized foreign legal entities per se, which (a)
    // conflates jurisdiction with opacity and (b) is politically and
    // analytically indefensible in an EU context - a German GmbH parent is
    // not less transparent than a Vilnius holding. v6.0 scores what the
    // JADIS declaration actually evidences: is ownership declared, and how
    // directly are ultimate beneficial owners traceable from it? Natural
    // persons (any country) are terminal UBO entries; legal entities (any
    // country) add a lookup layer. Nationality never changes the score.
    const naturalPersons = owner.ltNaturalPersons + owner.foreignNaturalPersons
    const legalEntities = owner.ltLegalEntities + owner.foreignLegalEntities
    const totalOwners = naturalPersons + legalEntities

    let score: number
    let structure: string
    if (totalOwners === 0) {
      score = 3 // Declaration record exists but names no owners
      structure = 'deklaracija be dalyvių'
    } else if (legalEntities === 0) {
      score = 9 // All owners are natural persons - UBO directly traceable
      structure = 'tiesioginė fizinių asmenų nuosavybė'
    } else if (naturalPersons > 0) {
      score = 8 // Mixed - part of the structure resolves to persons directly
      structure = 'mišri struktūra (fiziniai ir juridiniai asmenys)'
    } else {
      score = 7 // Only legal entities - UBO requires a further layer lookup
      structure = 'daugiapakopė struktūra (tik juridiniai asmenys)'
    }

    const confidence = 0.80

    return {
      score,
      confidence,
      dataPoints: 1,
      reasoning: `JADIS deklaracija: ${totalOwners} ${totalOwners === 1 ? 'dalyvis' : 'dalyviai'} - ${structure}`,
      details: { ...owner, totalOwners, naturalPersons, legalEntities, structure },
    }
  },
}

// ════════════════════════════════════════════════════
// SIGNAL REGISTRY: published weights sum to 1 after proportional rescaling.
// Four axes: continuity 16/86, financial 24/86, resilience 14/86,
// transparency 32/86. No unvalidated new weighting choices in this revision.

const REGISTRY_SIGNALS: SignalDefinition[] = [
  // Tęstinumas (Continuity) - 16/86
  continuityCapital,
  legalStanding,
  // Finansinė drausmė (Financial Discipline) - 24/86
  financialStrength,
  growthTrajectory,
  profitabilityTrend,
  taxDiscipline,
  // Atsparumas (Resilience) - 14/86
  resilience,
  workforceHealth,
  // Skaidrumas (Transparency) - 32/86
  transparency,
  procurementIntegrity,
  reportingCompliance,
  governanceQuality,
  ownershipTransparency,
]

export const SIGNAL_REGISTRY: SignalDefinition[] = REGISTRY_SIGNALS.map((signal) => ({
  ...signal,
  defaultWeight: signal.defaultWeight / 0.86,
}))

// ── Helpers ──

function getSortedRevRows(rows: YearlyRow[]): YearlyRow[] {
  return [...rows]
    .filter(r => r.revenue && r.revenue > 0)
    .sort((a, b) => a.year - b.year)
}

function formatEur(v: number): string {
  return v.toLocaleString('lt-LT', { maximumFractionDigits: 0 }) + ' €'
}
