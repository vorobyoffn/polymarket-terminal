// Weather edges dashboard endpoint.
// Runs the same weather scan the bot uses, annotates each signal with
// eligibility (which filter layer it passes/fails), and returns everything
// for the /edges dashboard to display.

import { runWeatherArbScan, type WeatherSignal } from "@/lib/weather/oracle";
import { evaluateSignalEligibility } from "@/lib/engine/filters";

// Compute LOR (log odds ratio) and significance the same way auto-trader does.
function computeDerived(s: WeatherSignal) {
  const logOddsForecast = Math.log(Math.max(0.001, s.forecastProb) / (1 - Math.max(0.001, s.forecastProb)));
  const logOddsMarket = Math.log(Math.max(0.001, s.marketPrice) / (1 - Math.max(0.001, s.marketPrice)));
  const lor = Math.abs(logOddsForecast - logOddsMarket);

  const significance = s.edge >= 0.30 ? 4 : s.edge >= 0.20 ? 3 : s.edge >= 0.10 ? 2 : 1;

  const entryPrice = s.direction === "BUY_YES" ? s.marketPrice : 1 - s.marketPrice;
  const payoffRatio = entryPrice > 0 ? (1 - entryPrice) / entryPrice : 0;

  const confidenceNormalized = significance / 4;
  const daysToResolve = Math.max(s.daysToExpiry, 0.5);
  const score = (s.edge * confidenceNormalized * payoffRatio) / daysToResolve;

  return { lor, significance, payoffRatio, score, entryPrice };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cityFilter = url.searchParams.get("city")?.toLowerCase() || null;

    const result = await runWeatherArbScan();
    const signals = cityFilter
      ? result.signals.filter(s => s.city.toLowerCase() === cityFilter)
      : result.signals;

    const edges = signals.map(s => {
      const derived = computeDerived(s);

      const eligibility = evaluateSignalEligibility({
        edge: s.edge,
        marketPrice: s.marketPrice,
        direction: s.direction,
        daysToExpiry: s.daysToExpiry,
        theoreticalProb: s.forecastProb,
        significance: derived.significance,
        lor: derived.lor,
        _strategy: "weather",
      });

      return {
        // Core signal fields
        city: s.city,
        date: s.date,
        targetTemp: s.targetTemp,
        targetType: s.targetType,
        unit: s.unit,
        marketQuestion: s.marketQuestion,
        marketId: s.marketId,
        marketPrice: Math.round(s.marketPrice * 10000) / 10000,
        forecastProb: Math.round(s.forecastProb * 10000) / 10000,
        forecastHigh: s.forecastHigh,
        edge: Math.round(s.edge * 10000) / 10000,
        direction: s.direction,
        confidence: s.confidence,
        daysToExpiry: s.daysToExpiry,
        volume24h: s.volume24h,

        // Derived metrics
        lor: Math.round(derived.lor * 100) / 100,
        significance: derived.significance,
        payoffRatio: Math.round(derived.payoffRatio * 100) / 100,
        score: Math.round(derived.score * 10000) / 10000,
        entryPrice: Math.round(derived.entryPrice * 10000) / 10000,

        // Eligibility
        eligibility,
      };
    });

    // Sort: tradeable first (by score desc), then blocked (by edge desc)
    edges.sort((a, b) => {
      if (a.eligibility.tradeable && !b.eligibility.tradeable) return -1;
      if (!a.eligibility.tradeable && b.eligibility.tradeable) return 1;
      if (a.eligibility.tradeable) return b.score - a.score;
      return b.edge - a.edge;
    });

    return Response.json({
      scannedAt: new Date().toISOString(),
      citiesScanned: result.citiesScanned,
      marketsScanned: result.marketsScanned,
      forecastsLoaded: result.forecastsLoaded,
      total: edges.length,
      tradeableCount: edges.filter(e => e.eligibility.tradeable).length,
      edges,
    });
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
