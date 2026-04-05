// Correlation Arbitrage Engine
// Finds multi-outcome events where YES prices don't sum to 1.0
// (pure mathematical arbitrage — no external data needed).

const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

async function cloudGet<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface MarketInGroup {
  id: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
}

export interface CorrelationSignal {
  eventId: string;
  eventTitle: string;
  markets: MarketInGroup[];
  sumYesPrices: number;
  deviation: number;         // |sum - 1.0|
  deviationPct: number;      // as percentage
  type: "OVERPRICED" | "UNDERPRICED"; // sum > 1 = overpriced, sum < 1 = underpriced
  profitPotential: number;   // estimated $ profit per $100 wagered
  marketCount: number;
  avgVolume: number;
  expiryDate: string;
  daysToExpiry: number;
}

export interface CorrelationArbResult {
  signals: CorrelationSignal[];
  eventsScanned: number;
  multiOutcomeEvents: number;
  timestamp: string;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

export async function runCorrelationArbScan(): Promise<CorrelationArbResult> {
  const rawEvents = await cloudGet<Record<string, unknown>[]>(
    `${GAMMA_API}/events?active=true&closed=false&limit=500`,
    20000
  );

  const now = new Date();
  const signals: CorrelationSignal[] = [];
  let multiOutcomeCount = 0;

  for (const event of rawEvents || []) {
    const eventMarkets = (event.markets as Record<string, unknown>[]) || [];
    if (eventMarkets.length < 2) continue; // Need multiple outcomes

    // Filter to active, non-closed markets
    const activeMarkets: MarketInGroup[] = [];
    for (const m of eventMarkets) {
      if (m.closed || !m.active) continue;

      let yesPrice = 0;
      try {
        const pricesRaw = JSON.parse((m.outcomePrices as string) || "[]") as string[];
        yesPrice = parseFloat(pricesRaw[0] || "0");
      } catch { continue; }

      if (yesPrice <= 0 || yesPrice >= 1) continue;

      activeMarkets.push({
        id: (m.id as string) || "",
        question: (m.question as string) || "",
        yesPrice: Math.round(yesPrice * 1000) / 1000,
        noPrice: Math.round((1 - yesPrice) * 1000) / 1000,
        volume: (m.volumeNum as number) || (m.volume as number) || 0,
      });
    }

    if (activeMarkets.length < 2) continue;
    multiOutcomeCount++;

    // Sum all YES prices — for mutually exclusive outcomes, should = 1.0
    const sumYes = activeMarkets.reduce((s, m) => s + m.yesPrice, 0);
    const deviation = Math.abs(sumYes - 1.0);

    // Minimum 3% deviation to account for fees + spread
    if (deviation < 0.03) continue;

    const endDate = (event.endDate as string) || eventMarkets[0]?.endDate as string || "";
    const expiry = new Date(endDate);
    const daysToExpiry = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);

    const type: CorrelationSignal["type"] = sumYes > 1.0 ? "OVERPRICED" : "UNDERPRICED";

    // Profit potential: if sum = 1.08, buying all NOs costs sum(1-p) = N-sum_yes
    // and one NO will pay $1, so profit ≈ deviation * 100 / N for equal weighting
    const profitPotential = Math.round(deviation * 100 * 100) / 100;

    const avgVolume = activeMarkets.reduce((s, m) => s + m.volume, 0) / activeMarkets.length;

    signals.push({
      eventId: (event.id as string) || "",
      eventTitle: (event.title as string) || (event.slug as string) || "Unknown Event",
      markets: activeMarkets,
      sumYesPrices: Math.round(sumYes * 1000) / 1000,
      deviation: Math.round(deviation * 1000) / 1000,
      deviationPct: Math.round(deviation * 10000) / 100,
      type,
      profitPotential,
      marketCount: activeMarkets.length,
      avgVolume: Math.round(avgVolume),
      expiryDate: endDate ? expiry.toISOString().split("T")[0] : "—",
      daysToExpiry: Math.max(daysToExpiry, 0),
    });
  }

  // Sort by deviation (biggest arb opportunity first)
  signals.sort((a, b) => b.deviation - a.deviation);

  return {
    signals,
    eventsScanned: rawEvents?.length || 0,
    multiOutcomeEvents: multiOutcomeCount,
    timestamp: new Date().toISOString(),
  };
}
