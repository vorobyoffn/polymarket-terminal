// Weather Arbitrage Backtester
// Uses historical weather data from Open-Meteo to validate our probability model.
// Compares model predictions against actual outcomes to measure calibration and P&L.

// ── Cities ──────────────────────────────────────────────────────────────────

const CITIES: Record<string, { lat: number; lon: number; unit: "C" | "F" }> = {
  "Seoul":       { lat: 37.57, lon: 126.98, unit: "C" },
  "Tokyo":       { lat: 35.68, lon: 139.69, unit: "C" },
  "London":      { lat: 51.51, lon: -0.13, unit: "C" },
  "New York":    { lat: 40.71, lon: -74.01, unit: "F" },
  "Singapore":   { lat: 1.35, lon: 103.82, unit: "C" },
  "Paris":       { lat: 48.86, lon: 2.35, unit: "C" },
  "Moscow":      { lat: 55.76, lon: 37.62, unit: "C" },
  "Toronto":     { lat: 43.65, lon: -79.38, unit: "C" },
  "Chicago":     { lat: 41.88, lon: -87.63, unit: "F" },
  "Milan":       { lat: 45.46, lon: 9.19, unit: "C" },
  "Sydney":      { lat: -33.87, lon: 151.21, unit: "C" },
  "Hong Kong":   { lat: 22.32, lon: 114.17, unit: "C" },
  "Berlin":      { lat: 52.52, lon: 13.41, unit: "C" },
  "Mumbai":      { lat: 19.08, lon: 72.88, unit: "C" },
  "Ankara":      { lat: 39.93, lon: 32.85, unit: "C" },
};

async function httpGet<T>(url: string): Promise<T> {
  const https = await import("node:https");
  const dns = await import("node:dns");
  dns.setDefaultResultOrder("ipv4first");

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 20000);
    const req = https.get(url, { family: 4 }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data) as T); } catch { reject(new Error("parse")); }
      });
    });
    req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
  });
}

// ── Normal distribution functions ───────────────────────────────────────────

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function probExactTemp(forecast: number, target: number, sigma: number): number {
  return normalCDF((target + 0.5 - forecast) / sigma) - normalCDF((target - 0.5 - forecast) / sigma);
}

function probAboveTemp(forecast: number, target: number, sigma: number): number {
  return 1 - normalCDF((target - 0.5 - forecast) / sigma);
}

function probBelowTemp(forecast: number, target: number, sigma: number): number {
  return normalCDF((target + 0.5 - forecast) / sigma);
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  city: string;
  date: string;
  targetTemp: number;
  targetType: "exact" | "above" | "below";
  forecastHigh: number;
  actualHigh: number;
  modelProb: number;
  simulatedMarketPrice: number;
  direction: "BUY_YES" | "BUY_NO";
  entryPrice: number;
  edge: number;
  outcome: "won" | "lost";
  pnl: number;
  betSize: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  calibration: { bucket: string; predicted: number; actual: number; count: number }[];
  byCity: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
  bySigma: { sigma: string; trades: number; wins: number; pnl: number }[];
  daysAnalyzed: number;
  citiesAnalyzed: number;
  edgeDistribution: { range: string; count: number; avgPnl: number; winRate: number }[];
}

// ── Backtest Engine ─────────────────────────────────────────────────────────

export async function runWeatherBacktest(daysBack = 30): Promise<BacktestResult> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 86_400_000);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  const trades: BacktestTrade[] = [];
  const cityNames = Object.keys(CITIES);
  let citiesLoaded = 0;

  // Fetch historical data for each city
  for (const cityName of cityNames) {
    const city = CITIES[cityName];
    try {
      // Open-Meteo historical API — gives actual recorded temperatures
      const histData = await httpGet<{
        daily: { time: string[]; temperature_2m_max: number[] };
      }>(`https://archive-api.open-meteo.com/v1/archive?latitude=${city.lat}&longitude=${city.lon}&start_date=${startStr}&end_date=${endStr}&daily=temperature_2m_max&timezone=auto`);

      if (!histData.daily?.time) continue;
      citiesLoaded++;

      // For each historical day, simulate what our model would have predicted
      // using the PREVIOUS day's actual high as a "forecast" (conservative — real forecasts are better)
      for (let i = 1; i < histData.daily.time.length; i++) {
        const date = histData.daily.time[i];
        const actualHighC = histData.daily.temperature_2m_max[i];
        const prevDayHighC = histData.daily.temperature_2m_max[i - 1];

        // Use previous day's high as forecast proxy (real forecast would be more accurate)
        const forecastHigh = city.unit === "F"
          ? Math.round(prevDayHighC * 9 / 5 + 32)
          : Math.round(prevDayHighC);
        const actualHigh = city.unit === "F"
          ? Math.round(actualHighC * 9 / 5 + 32)
          : Math.round(actualHighC);

        // Sigma for "tomorrow" forecast
        const sigma = city.unit === "F" ? 3.5 : 2.0;

        // Generate temperature bins to test
        const bins = city.unit === "F"
          ? [-4, -2, 0, 2, 4, 6, 8].map(d => forecastHigh + d)
          : [-3, -2, -1, 0, 1, 2, 3].map(d => forecastHigh + d);

        for (const target of bins) {
          // Our model's probability for this exact temperature
          const modelProb = probExactTemp(forecastHigh, target, sigma);

          // Simulate what the market price might be
          // Markets are noisy — add random noise to the true probability
          const noise = (Math.random() - 0.5) * 0.25;
          const simulatedMarketPrice = Math.max(0.02, Math.min(0.98, modelProb + noise));

          const edge = Math.abs(modelProb - simulatedMarketPrice);
          if (edge < 0.08) continue; // minimum 8% edge

          // Determine direction
          const direction: "BUY_YES" | "BUY_NO" = modelProb > simulatedMarketPrice ? "BUY_YES" : "BUY_NO";

          // Entry price (with our limit order logic — 40% between market and model)
          let entryPrice: number;
          if (direction === "BUY_YES") {
            entryPrice = simulatedMarketPrice + (modelProb - simulatedMarketPrice) * 0.4;
            if (entryPrice > 0.60) continue; // price zone filter
          } else {
            const noMarketPrice = 1 - simulatedMarketPrice;
            const noModelPrice = 1 - modelProb;
            entryPrice = noMarketPrice + (noModelPrice - noMarketPrice) * 0.4;
            if (entryPrice > 0.60) continue;
          }

          if (entryPrice < 0.05 || entryPrice > 0.60) continue;

          // Did the actual temperature match?
          const actuallyHappened = actualHigh === target;

          // Determine if we won
          const won = direction === "BUY_YES" ? actuallyHappened : !actuallyHappened;

          const betSize = 10; // $10 per trade
          const pnl = won ? betSize * (1 / entryPrice - 1) : -betSize;

          trades.push({
            city: cityName,
            date,
            targetTemp: target,
            targetType: "exact",
            forecastHigh,
            actualHigh,
            modelProb: Math.round(modelProb * 1000) / 1000,
            simulatedMarketPrice: Math.round(simulatedMarketPrice * 1000) / 1000,
            direction,
            entryPrice: Math.round(entryPrice * 1000) / 1000,
            edge: Math.round(edge * 1000) / 1000,
            outcome: won ? "won" : "lost",
            pnl: Math.round(pnl * 100) / 100,
            betSize,
          });
        }

        // Also test "above X" markets
        for (const offset of [-2, -1, 0, 1, 2, 3]) {
          const target = forecastHigh + offset;
          const modelProb = probAboveTemp(forecastHigh, target, sigma);
          const noise = (Math.random() - 0.5) * 0.20;
          const simulatedMarketPrice = Math.max(0.02, Math.min(0.98, modelProb + noise));
          const edge = Math.abs(modelProb - simulatedMarketPrice);
          if (edge < 0.08) continue;

          const direction: "BUY_YES" | "BUY_NO" = modelProb > simulatedMarketPrice ? "BUY_YES" : "BUY_NO";
          let entryPrice: number;
          if (direction === "BUY_YES") {
            entryPrice = simulatedMarketPrice + (modelProb - simulatedMarketPrice) * 0.4;
          } else {
            entryPrice = (1 - simulatedMarketPrice) + ((1 - modelProb) - (1 - simulatedMarketPrice)) * 0.4;
          }
          if (entryPrice < 0.05 || entryPrice > 0.60) continue;

          const actuallyAbove = actualHigh >= target;
          const won = direction === "BUY_YES" ? actuallyAbove : !actuallyAbove;
          const betSize = 10;
          const pnl = won ? betSize * (1 / entryPrice - 1) : -betSize;

          trades.push({
            city: cityName,
            date,
            targetTemp: target,
            targetType: "above",
            forecastHigh,
            actualHigh,
            modelProb: Math.round(modelProb * 1000) / 1000,
            simulatedMarketPrice: Math.round(simulatedMarketPrice * 1000) / 1000,
            direction,
            entryPrice: Math.round(entryPrice * 1000) / 1000,
            edge: Math.round(edge * 1000) / 1000,
            outcome: won ? "won" : "lost",
            pnl: Math.round(pnl * 100) / 100,
            betSize,
          });
        }
      }

      // Small delay between cities to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`Backtest: ${cityName} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // ── Compute Statistics ──

  const wins = trades.filter(t => t.outcome === "won").length;
  const losses = trades.filter(t => t.outcome === "lost").length;
  const pnls = trades.map(t => t.pnl);
  const totalPnl = pnls.reduce((s, p) => s + p, 0);
  const avgPnl = pnls.length > 0 ? totalPnl / pnls.length : 0;

  // Sharpe ratio (daily)
  const mean = avgPnl;
  const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / Math.max(1, pnls.length - 1);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = 0;
  let maxDD = 0;
  let cumPnl = 0;
  for (const p of pnls) {
    cumPnl += p;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Profit factor
  const grossProfit = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Calibration buckets
  const calBuckets = [
    { min: 0, max: 0.1, label: "0-10%" },
    { min: 0.1, max: 0.2, label: "10-20%" },
    { min: 0.2, max: 0.3, label: "20-30%" },
    { min: 0.3, max: 0.4, label: "30-40%" },
    { min: 0.4, max: 0.5, label: "40-50%" },
    { min: 0.5, max: 0.6, label: "50-60%" },
    { min: 0.6, max: 0.7, label: "60-70%" },
    { min: 0.7, max: 0.8, label: "70-80%" },
    { min: 0.8, max: 0.9, label: "80-90%" },
    { min: 0.9, max: 1.0, label: "90-100%" },
  ];
  const calibration = calBuckets.map(b => {
    const bucket = trades.filter(t => {
      const prob = t.direction === "BUY_YES" ? t.modelProb : 1 - t.modelProb;
      return prob >= b.min && prob < b.max;
    });
    const actualWins = bucket.filter(t => t.outcome === "won").length;
    return {
      bucket: b.label,
      predicted: (b.min + b.max) / 2,
      actual: bucket.length > 0 ? actualWins / bucket.length : 0,
      count: bucket.length,
    };
  });

  // By city
  const byCity: Record<string, { trades: number; wins: number; pnl: number; winRate: number }> = {};
  for (const t of trades) {
    if (!byCity[t.city]) byCity[t.city] = { trades: 0, wins: 0, pnl: 0, winRate: 0 };
    byCity[t.city].trades++;
    if (t.outcome === "won") byCity[t.city].wins++;
    byCity[t.city].pnl += t.pnl;
  }
  for (const c of Object.values(byCity)) {
    c.winRate = c.trades > 0 ? Math.round(c.wins / c.trades * 100) : 0;
    c.pnl = Math.round(c.pnl * 100) / 100;
  }

  // Edge distribution
  const edgeBuckets = [
    { min: 0.08, max: 0.15, label: "8-15%" },
    { min: 0.15, max: 0.25, label: "15-25%" },
    { min: 0.25, max: 0.40, label: "25-40%" },
    { min: 0.40, max: 1.0, label: "40%+" },
  ];
  const edgeDistribution = edgeBuckets.map(b => {
    const bucket = trades.filter(t => t.edge >= b.min && t.edge < b.max);
    const bWins = bucket.filter(t => t.outcome === "won").length;
    const bPnl = bucket.reduce((s, t) => s + t.pnl, 0);
    return {
      range: b.label,
      count: bucket.length,
      avgPnl: bucket.length > 0 ? Math.round(bPnl / bucket.length * 100) / 100 : 0,
      winRate: bucket.length > 0 ? Math.round(bWins / bucket.length * 100) : 0,
    };
  });

  return {
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? Math.round(wins / trades.length * 100) : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgPnl: Math.round(avgPnl * 100) / 100,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    calibration,
    byCity,
    bySigma: [],
    daysAnalyzed: daysBack,
    citiesAnalyzed: citiesLoaded,
    edgeDistribution,
  };
}
