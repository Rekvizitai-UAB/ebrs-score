/**
 * Reputation Scoring System - Type Definitions (EBRS v7.0)
 *
 * Signal-based architecture: each data source is a "signal" that produces
 * a score + confidence. New signals can be added without changing the core engine.
 *
 * EBRS 4-Axis Model (v7.0):
 *   Tęstinumas (Continuity)         - longevity, data history, legal standing
 *   Finansinė drausmė (Financial)   - revenue, margins, growth, tax discipline
 *   Atsparumas (Resilience)         - volatility resistance, workforce stability
 *   Skaidrumas (Transparency)       - reporting compliance, governance, ownership, procurement
 */

// ── EBRS Axis ──

export type EbrsAxis = 'continuity' | 'financial' | 'resilience' | 'transparency'

export const EBRS_AXES: Record<EbrsAxis, { name: string; description: string; color: string }> = {
  continuity:   { name: 'Tęstinumas',           description: 'Veiklos ilgaamžiškumas ir stabilumas',    color: 'bg-indigo-500' },
  financial:    { name: 'Finansinė drausmė',    description: 'Pajamos, pelningumas, augimo trajektorija', color: 'bg-emerald-500' },
  resilience:   { name: 'Atsparumas',           description: 'Gebėjimas atlaikyti rinkos svyravimus',  color: 'bg-amber-500' },
  transparency: { name: 'Skaidrumas',           description: 'Atskaitomybė, valdymo kokybė, nuosavybė ir viešieji pirkimai', color: 'bg-violet-500' },
}

// ── Signal Types ──

export interface SignalResult {
  score: number           // 0-10
  confidence: number      // 0-1 (how much real data backs this score)
  dataPoints: number      // how many data points contributed
  reasoning: string       // human-readable explanation (Lithuanian)
  details: Record<string, unknown>  // raw sub-scores for transparency
}

export type SignalCategory = 'financial' | 'growth' | 'profitability' | 'workforce' | 'continuity' | 'resilience' | 'transparency'

export interface SignalDefinition {
  id: string
  name: string            // Display name (Lithuanian)
  category: SignalCategory
  ebrsAxis: EbrsAxis      // Which EBRS axis this signal feeds
  defaultWeight: number   // 0-1, normalized across all active signals
  color: string           // Tailwind color class for UI bar
  /** Compute signal from available data. Return null if insufficient data. */
  compute: (data: CompanySignalData) => SignalResult | null
}

// ── Input Data (gathered from DB before scoring) ──

export interface YearlyRow {
  year: number
  revenue: number | null
  profit: number | null
  netProfit: number | null
  employees: number | null
  salary: number | null
  sodraDebt: number | null
}

export interface MentionRow {
  source: string
  sentiment: string | null
  sentimentScore: number | null
  isNews: boolean
  foundAt: Date
}

// ── EBRS v7.0 External Data Interfaces ──

export interface ProcurementData {
  bidsCount: number
  winsCount: number
  totalValueWon: number
  winRate: number | null
  rejectionsCount: number
  rejectionRate: number | null
  avgProcedureScore: number | null
  lastContractDate: Date | null
  isSubcontractor: boolean
  firstBidDate: Date | null
  distinctCpvCategories: number
}

export interface TaxData {
  annualTaxCurrent: number | null
  annualTaxPrevious: number | null
  taxYear: number | null
  hasDebt: boolean
  debtTotal: number
  debtOverdue: number
  debtDeferred: number
}

export interface LegalData {
  registrationDate: Date | null
  deregistrationDate: Date | null
  legalForm: string | null
  status: string | null
  statusDate: Date | null
  isActiveInRc: boolean
}

export interface ReportingData {
  isNonFiler: boolean
  nonFiledYear: number | null
  isLateFiler: boolean
  isMissingAudit: boolean
  missingAuditYear: number | null
}

export interface GovernanceData {
  hasDirector: boolean
  directorSinceDate: Date | null
  hasBoard: boolean
  hasCouncil: boolean
  hasOtherBodies: boolean
}

export interface OwnershipData {
  ltNaturalPersons: number
  ltLegalEntities: number
  foreignNaturalPersons: number
  foreignLegalEntities: number
  hasJadisData: boolean
}

export interface BankruptcyData {
  status: 'bankrupt' | 'restructuring' | 'intentional_bankruptcy' | 'none'
  statusDate: string | null
  intentionalBankruptcyDate: string | null
  /** For restructuring: the explicit successful completion date supplied by AVNT. */
  endDecisionDate?: string | null
  terminationDate?: string | null
  terminationReason?: string | null
}

export interface CompanySignalData {
  companyId: number
  companyName: string
  yearlyRows: YearlyRow[]           // from company_yearly_data
  /** Dated net-overdue input for the current score; annual rows remain historical. */
  currentSodraDebt?: { amount: number | null; date: string | null }
  /** Legacy context accepted for compatibility; excluded from all EBRS calculations. */
  mentions?: MentionRow[]            // from company_mentions
  ratingAverage?: number | null      // from companies.rating_average
  ratingCount?: number               // from companies.rating_count
  topYearsListed?: number            // from companies.top_history
  foundedYear: number | null        // from companies.founded_year
  activationStatus?: string          // from companies.activation_status
  // EBRS v7.0 external data sources
  procurementData: ProcurementData | null
  taxData: TaxData | null
  legalData: LegalData | null
  reportingData: ReportingData | null
  governanceData: GovernanceData | null
  ownershipData: OwnershipData | null
  /** The register's own legal status string, e.g. "Bankrutuojantis". */
  legalStatus?: string | null
  /** Operator-recorded insolvency; outranks every feed. */
  insolvencyOverride?: string | null
  insolvencyOverrideAt?: Date | null
  bankruptcyData: BankruptcyData | null
}

// ── Stored Score ──

export interface StoredSignalScore {
  id: string
  name: string
  score: number
  confidence: number
  weight: number
  dataPoints: number
  reasoning: string
  details: Record<string, unknown>
  ebrsAxis: EbrsAxis
}

export interface EbrsAxisScore {
  axis: EbrsAxis
  name: string
  score: number         // 0-10 (weighted avg of signals in this axis)
  confidence: number    // 0-1
  signalCount: number   // how many signals contributed
}

export interface ReputationScore {
  overall: number                     // 0-10 weighted average
  confidence: number                  // 0-100%
  signals: StoredSignalScore[]        // individual signal breakdowns
  ebrsAxes: EbrsAxisScore[]           // EBRS 4-axis breakdown
  algorithmVersion: string            // e.g., "v5.3.0"
  dataYears: number                   // how many years of financial data
  signalCoverage: number              // 0-100%, how many of 13 signals were computable
  // Derived labels
  riskLevel: string
  growthTrend: string
  marketPosition: string
  margin: number | null
  consecutiveProfitYears: number
  // ── v6.0 verdict metadata ──
  /** 'insufficient_data' when fewer than MIN_SIGNALS_FOR_VERDICT signals
   *  were computable - front-ends render "Nepakanka duomenų", not a band. */
  scoreState: 'ok' | 'insufficient_data'
  /** Terminal-state cap applied to the overall (never silent). */
  capApplied: 'bankruptcy' | 'restructuring' | null
  /** Jurisdiction of the underlying registries (multi-country roadmap). */
  jurisdiction: 'LT' | 'LV' | 'EE' | 'PL'
}
