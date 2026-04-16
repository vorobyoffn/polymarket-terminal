// Report Data Collector — fetches real execution data for PDF reports
// METHODOLOGY:
// 1. Get trade history from CLOB (getTrades) → exact execution time + price
// 2. Get position data from data-api.polymarket.com → market names, outcomes, P&L
// 3. Get price history from CLOB (prices-history) → real market price over time
// 4. Get related outcomes from gamma-api → other bets in same event
// 5. Combine all into structured data for chart generation
//
// This ensures reports use REAL data, not estimates.

export interface TradeExecution {
  name: string;
  outcome: string;
  assetId: string;
  won: boolean;
  lost: boolean;
  cost: number;
  avgPrice: number;
  entryPrice: number;     // REAL entry price from CLOB trade
  entryTime: number;      // REAL Unix timestamp of our trade
  entrySize: number;
  totalTrades: number;
  priceHistory: { t: number; p: number }[];  // REAL price history from CLOB
  endDate: string;
  eventSlug: string;
  relatedOutcomes?: { label: string; history: { t: number; p: number }[] }[];
}

// Data files are saved to /tmp/ during collection:
// - /tmp/apr14_real_data.json — execution data
// - /tmp/apr14_related.json — related outcomes
// These are consumed by the Python PDF generator.
