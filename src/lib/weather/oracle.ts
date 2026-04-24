// Weather Oracle — fetches real forecasts from Open-Meteo (free, no API key)
// and compares to Polymarket temperature markets to find mispricings

const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

// City coordinates for Open-Meteo
const CITIES: Record<string, { lat: number; lon: number; unit: "C" | "F" }> = {
  "seoul":       { lat: 37.57, lon: 126.98, unit: "C" },
  "hong kong":   { lat: 22.32, lon: 114.17, unit: "C" },
  "shanghai":    { lat: 31.23, lon: 121.47, unit: "C" },
  "new york":    { lat: 40.71, lon: -74.01, unit: "F" },
  "new york city": { lat: 40.71, lon: -74.01, unit: "F" },
  "toronto":     { lat: 43.65, lon: -79.38, unit: "C" },
  "chicago":     { lat: 41.88, lon: -87.63, unit: "F" },
  "london":      { lat: 51.51, lon: -0.13, unit: "C" },
  "wellington":  { lat: -41.29, lon: 174.78, unit: "C" },
  "tokyo":       { lat: 35.68, lon: 139.69, unit: "C" },
  "taipei":      { lat: 25.03, lon: 121.57, unit: "C" },
  "chongqing":   { lat: 29.56, lon: 106.55, unit: "C" },
  "chengdu":     { lat: 30.57, lon: 104.07, unit: "C" },
  "ankara":      { lat: 39.93, lon: 32.85, unit: "C" },
  "wuhan":       { lat: 30.59, lon: 114.31, unit: "C" },
  "milan":       { lat: 45.46, lon: 9.19, unit: "C" },
  "singapore":   { lat: 1.35, lon: 103.82, unit: "C" },
  "sydney":      { lat: -33.87, lon: 151.21, unit: "C" },
  "mumbai":      { lat: 19.08, lon: 72.88, unit: "C" },
  "bangkok":     { lat: 13.76, lon: 100.50, unit: "C" },
  "beijing":     { lat: 39.90, lon: 116.41, unit: "C" },
  "moscow":      { lat: 55.76, lon: 37.62, unit: "C" },
  "paris":       { lat: 48.86, lon: 2.35, unit: "C" },
  "berlin":      { lat: 52.52, lon: 13.41, unit: "C" },
  "los angeles": { lat: 34.05, lon: -118.24, unit: "F" },
  "miami":       { lat: 25.76, lon: -80.19, unit: "F" },
};

async function httpGet<T>(url: string, timeoutMs = 15000): Promise<T> {
  const https = await import("node:https");
  const dns = await import("node:dns");
  dns.setDefaultResultOrder("ipv4first");

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const req = https.get(url, { family: 4 }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => {
        clearTimeout(timer);
        if (res.statusCode && res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data) as T); } catch { reject(new Error("JSON parse failed")); }
      });
    });
    req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeatherForecast {
  city: string;
  date: string;
  highTempC: number;
  highTempF: number;
  lowTempC: number;
  unit: "C" | "F";
  confidence: number; // 0-1, based on forecast horizon
}

export interface WeatherSignal {
  marketId: string;
  marketQuestion: string;
  city: string;
  date: string;
  targetTemp: number;
  targetType: "exact" | "above" | "below" | "range";
  unit: "C" | "F";
  marketPrice: number;       // current YES price on Polymarket
  forecastProb: number;      // our estimated probability based on forecast
  edge: number;              // forecastProb - marketPrice (or vice versa)
  direction: "BUY_YES" | "BUY_NO";
  confidence: number;
  forecastHigh: number;
  daysToExpiry: number;
  volume24h: number;
}

export interface WeatherArbResult {
  signals: WeatherSignal[];
  citiesScanned: number;
  marketsScanned: number;
  forecastsLoaded: number;
  timestamp: string;
}

// ── Forecast fetcher (with 3-hour cache) ────────────────────────────────────
//
// Open-Meteo free tier = 10,000 API calls/day. Without caching, the bot's
// 60s scan × 26 cities burns through that in ~6 hours.
// Forecasts only update every 3-6 hours upstream, so caching for 3 hours
// is safe and drops our daily call count from ~37k to ~208.

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const forecastCache = new Map<string, { forecasts: WeatherForecast[]; timestamp: number }>();

async function getForecast(city: string): Promise<WeatherForecast[]> {
  const info = CITIES[city.toLowerCase()];
  if (!info) return [];

  // Cache hit? Return immediately, no API call.
  const cached = forecastCache.get(city.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    // Recompute confidence since "days ahead" shifts as time passes
    return cached.forecasts.map(f => {
      const daysAhead = Math.max(0, Math.ceil((new Date(f.date).getTime() - Date.now()) / 86_400_000));
      const confidence = daysAhead === 0 ? 0.95 : daysAhead === 1 ? 0.85 : 0.70;
      return { ...f, confidence };
    });
  }

  try {
    const data = await httpGet<{
      daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
      error?: boolean;
      reason?: string;
    }>(`https://api.open-meteo.com/v1/forecast?latitude=${info.lat}&longitude=${info.lon}&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`);

    // Rate limit or API error — keep stale cache if we have it, else empty
    if (data.error || !data.daily || !Array.isArray(data.daily.time)) {
      if (data.reason) console.error(`[Oracle] Open-Meteo error for ${city}: ${data.reason}`);
      return cached ? cached.forecasts : [];
    }

    const forecasts = data.daily.time.map((date, i) => {
      const highC = data.daily.temperature_2m_max[i];
      const lowC = data.daily.temperature_2m_min[i];
      const daysAhead = Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000));
      const confidence = daysAhead === 0 ? 0.95 : daysAhead === 1 ? 0.85 : 0.70;

      return {
        city,
        date,
        highTempC: Math.round(highC * 10) / 10,
        highTempF: Math.round(highC * 9 / 5 + 32),
        lowTempC: Math.round(lowC * 10) / 10,
        unit: info.unit,
        confidence,
      };
    });

    // Only cache fresh data if we actually got values
    if (forecasts.length > 0 && forecasts.every(f => typeof f.highTempC === "number" && !isNaN(f.highTempC))) {
      forecastCache.set(city.toLowerCase(), { forecasts, timestamp: Date.now() });
    }
    return forecasts;
  } catch (e) {
    console.error(`[Oracle] getForecast(${city}) failed:`, e instanceof Error ? e.message : e);
    // Fall back to stale cache if available (better than nothing)
    return cached ? cached.forecasts : [];
  }
}

// ── Probability model ───────────────────────────────────────────────────────

// Given a forecast high of X°C, what's the probability the actual high will be exactly T°C?
// We model forecast error as a normal distribution with σ ≈ 1.5°C for day-of, 2.5°C for tomorrow
function tempProbability(forecastHigh: number, targetTemp: number, type: "exact" | "above" | "below" | "range", sigma: number, rangeLow?: number, rangeHigh?: number): number {
  // Normal PDF approximation
  const normPdf = (x: number, mean: number, s: number) =>
    Math.exp(-0.5 * ((x - mean) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));

  // Normal CDF approximation
  const normCdf = (x: number, mean: number, s: number) => {
    const z = (x - mean) / s;
    const t = 1 / (1 + 0.3275911 * Math.abs(z));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  };

  switch (type) {
    case "exact":
      // P(actual rounds to targetTemp) = P(target-0.5 < actual < target+0.5)
      return normCdf(targetTemp + 0.5, forecastHigh, sigma) - normCdf(targetTemp - 0.5, forecastHigh, sigma);
    case "above":
      return 1 - normCdf(targetTemp - 0.5, forecastHigh, sigma);
    case "below":
      return normCdf(targetTemp + 0.5, forecastHigh, sigma);
    case "range":
      if (rangeLow !== undefined && rangeHigh !== undefined) {
        return normCdf(rangeHigh + 0.5, forecastHigh, sigma) - normCdf(rangeLow - 0.5, forecastHigh, sigma);
      }
      return 0;
  }
}

// ── Market parser ───────────────────────────────────────────────────────────

interface ParsedWeatherMarket {
  city: string;
  date: string;
  targetTemp: number;
  targetType: "exact" | "above" | "below" | "range";
  rangeLow?: number;
  rangeHigh?: number;
  unit: "C" | "F";
}

function parseWeatherMarket(question: string, endDate: string): ParsedWeatherMarket | null {
  const q = question.toLowerCase();

  // Must be a temperature market
  if (!/highest temperature|lowest temperature/.test(q)) return null;

  // Extract city
  let city = "";
  for (const c of Object.keys(CITIES)) {
    if (q.includes(c)) { city = c; break; }
  }
  if (!city) return null;

  // Extract date from question (e.g., "on April 14?" or from endDate)
  const dateMatch = q.match(/on\s+(\w+\s+\d+)/);
  const date = dateMatch ? parseDateStr(dateMatch[1]) : endDate.split("T")[0];

  // Determine unit
  const unit = q.includes("°f") || q.includes("f ") || /\d+°f/.test(q) ? "F" : "C";

  // Parse temperature target
  // "be 22°C on" → exact 22
  const exactMatch = q.match(/be\s+(?:between\s+)?(\d+)[°]?[cf]?\s+on/);
  // "be between 72-73°F" → range 72-73
  const rangeMatch = q.match(/between\s+(\d+)[-–](\d+)[°]?[cf]?/);
  // "be 24°C or higher" → above 24
  const aboveMatch = q.match(/(\d+)[°]?[cf]?\s+or\s+higher/);
  // "be 14°C or below" → below 14
  const belowMatch = q.match(/(\d+)[°]?[cf]?\s+or\s+below/);

  if (rangeMatch) {
    return { city, date, targetTemp: (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2, targetType: "range", rangeLow: parseInt(rangeMatch[1]), rangeHigh: parseInt(rangeMatch[2]), unit };
  } else if (aboveMatch) {
    return { city, date, targetTemp: parseInt(aboveMatch[1]), targetType: "above", unit };
  } else if (belowMatch) {
    return { city, date, targetTemp: parseInt(belowMatch[1]), targetType: "below", unit };
  } else if (exactMatch) {
    return { city, date, targetTemp: parseInt(exactMatch[1]), targetType: "exact", unit };
  }

  return null;
}

function parseDateStr(s: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const d = new Date(`${s} ${year}`);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

// ── Main scanner ────────────────────────────────────────────────────────────

export async function runWeatherArbScan(): Promise<WeatherArbResult> {
  // 1. Fetch weather markets from Polymarket
  // Fetch all active events — weather markets aren't tagged separately
  const rawEvents = await httpGet<Record<string, unknown>[]>(
    `${GAMMA_API}/events?active=true&closed=false&limit=500&order=volume24hr&ascending=false`,
    45000
  );

  const allEvents = rawEvents || [];
  const seenIds = new Set<string>();

  // 2. Parse weather markets
  const weatherMarkets: { market: Record<string, unknown>; parsed: ParsedWeatherMarket; yesPrice: number }[] = [];
  let marketsScanned = 0;

  for (const event of allEvents) {
    const markets = (event.markets as Record<string, unknown>[]) || [];
    for (const m of markets) {
      if (m.closed || !m.active) continue;
      const id = m.id as string;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      marketsScanned++;

      const question = (m.question as string) || "";
      const endDate = (m.endDate as string) || (event.endDate as string) || "";
      const parsed = parseWeatherMarket(question, endDate);
      if (!parsed) continue;

      try {
        const prices = JSON.parse((m.outcomePrices as string) || "[]") as string[];
        const yesPrice = parseFloat(prices[0] || "0");
        if (yesPrice < 0.005 || yesPrice > 0.995) continue;
        weatherMarkets.push({ market: m, parsed, yesPrice });
      } catch { continue; }
    }
  }

  // 3. Fetch forecasts for all needed cities/dates
  const neededCities = [...new Set(weatherMarkets.map(w => w.parsed.city))];
  const forecasts = new Map<string, WeatherForecast[]>();
  let forecastsLoaded = 0;

  // Fetch in batches of 5
  for (let i = 0; i < neededCities.length; i += 5) {
    const batch = neededCities.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(c => getForecast(c)));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled" && r.value.length > 0) {
        forecasts.set(batch[idx], r.value);
        forecastsLoaded++;
      }
    });
  }

  // 4. Generate signals
  const signals: WeatherSignal[] = [];

  for (const { market, parsed, yesPrice } of weatherMarkets) {
    const cityForecasts = forecasts.get(parsed.city);
    if (!cityForecasts) continue;

    // Find matching date forecast
    const forecast = cityForecasts.find(f => f.date === parsed.date);
    if (!forecast) continue;

    // Convert forecast to market's unit
    const forecastHigh = parsed.unit === "F" ? forecast.highTempF : forecast.highTempC;

    // Forecast error σ depends on horizon
    const daysAhead = Math.max(0, Math.ceil((new Date(parsed.date).getTime() - Date.now()) / 86_400_000));
    const sigma = parsed.unit === "F"
      ? (daysAhead === 0 ? 2.0 : daysAhead === 1 ? 3.5 : 5.0)  // °F
      : (daysAhead === 0 ? 1.2 : daysAhead === 1 ? 2.0 : 3.0);  // °C

    const forecastProb = tempProbability(forecastHigh, parsed.targetTemp, parsed.targetType, sigma, parsed.rangeLow, parsed.rangeHigh);

    // Strategy fix: raised from 5% to 12% minimum edge. Only take highest-
    // conviction signals. Historical 10-20¢ entries had 5.7% WR (needed 15%
    // to break even), meaning small-edge trades are losing systematically.
    const edge = Math.abs(forecastProb - yesPrice);
    if (edge < 0.12) continue;

    const direction: "BUY_YES" | "BUY_NO" = forecastProb > yesPrice ? "BUY_YES" : "BUY_NO";

    // ── Tiered filter for EXACT bands (historical 13% WR → use high-conviction only) ──
    // Trade exact-band only when we're highly confident in what the forecast says.
    // Same-day/next-day forecasts only; forecast must clearly match (for YES) or
    // clearly miss (for NO) the target — no middle ground where we're just guessing.
    if (parsed.targetType === "exact") {
      const tempGap = Math.abs(forecastHigh - parsed.targetTemp);  // in market's unit
      const gapC = parsed.unit === "F" ? tempGap / 1.8 : tempGap;
      const highConfidenceHorizon = daysAhead <= 1;  // only today/tomorrow

      if (!highConfidenceHorizon) continue;  // >1 day out = too uncertain for exact

      if (direction === "BUY_YES") {
        // BUY_YES on exact = we're confident temp will hit this band.
        // Require forecast within ±0.6°C of target (so rounds cleanly to this band).
        if (gapC > 0.6) continue;
      } else {
        // BUY_NO on exact = we're confident temp will miss this band.
        // Require forecast at least 1.5°C away (so it clearly rounds elsewhere).
        if (gapC < 1.5) continue;
      }
    }
    const daysToExpiry = Math.max(0, Math.ceil((new Date(parsed.date).getTime() - Date.now()) / 86_400_000));
    const vol24h = (market.volume24hr as number) || 0;

    signals.push({
      marketId: (market.id as string) || "",
      marketQuestion: (market.question as string) || "",
      city: parsed.city,
      date: parsed.date,
      targetTemp: parsed.targetTemp,
      targetType: parsed.targetType,
      unit: parsed.unit,
      marketPrice: Math.round(yesPrice * 1000) / 1000,
      forecastProb: Math.round(forecastProb * 1000) / 1000,
      edge: Math.round(edge * 1000) / 1000,
      direction,
      confidence: forecast.confidence,
      forecastHigh,
      daysToExpiry,
      volume24h: vol24h,
    });
  }

  // Sort by edge * confidence (best risk-adjusted signals first)
  signals.sort((a, b) => (b.edge * b.confidence) - (a.edge * a.confidence));

  return {
    signals,
    citiesScanned: neededCities.length,
    marketsScanned,
    forecastsLoaded,
    timestamp: new Date().toISOString(),
  };
}
