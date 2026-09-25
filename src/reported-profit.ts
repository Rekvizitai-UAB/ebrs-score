/** Net profit is the public profitability measure; pre-tax profit is a fallback.
 * Missing filings remain unknown, never a zero or a loss. */
export function reportedProfit(row: { profit: number | null; netProfit: number | null }): number | null {
  return row.netProfit ?? row.profit;
}
