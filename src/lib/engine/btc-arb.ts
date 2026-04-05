// BTC Price-Lag Arbitrage Engine
// Compare live BTC price (Binance) to Polymarket's implied probability
// using a log-normal options model to find mispriced markets.

import { httpsGet } from "@/lib/utils/https-get";
import type { PolymarketMarket } from "@/lib/polymarket/types";

// Cloud-friendly fetch with fallback to native https
async function cloudGet<T>(url: string, timeoutMs = 10000): Promise<T> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch {
    // Fallback to httpsGet (works better locally with IPv4 forcing)
    return httpsGet<T>(url, timeoutMs);
  }
}

const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

const ANNUAL_VOL = 0.72;  // BTC annualized vol ~72%
const MIN_EDGE   = 0.05;  // 5% minimum edge
const MAX_KELLY  = 0.20;  // cap at 20% of bankroll

export interface BtcSignal {
  marketId: string;
  marketQuestion: string;
  marketPrice: number;
  theoreticalProb: number;
  edge: number;
  lagPct: number;
  direction: "BUY_YES" | "BUY_NO";
  ev: number;
  lor: number;
  significance: 1 | 2 | 3 | 4;
  kellyFraction: number;
  recommendedBet: number;
  strikePrice: number;
  strikeType: "above" | "below" | "range";
  strikeLow?: number;
  strikeHigh?: number;
  daysToExpiry: number;
  expiryDate: string;
  liveBtcPrice: number;
  distancePct: number;
}

export interface BtcArbResult {
  liveBtcPrice: number;
  btcChange24h: number;
  btcChange1h: number;
  signals: BtcSignal[];
  marketsScanned: number;
  btcMarketsFound: number;
  timestamp: string;
}

interface BinanceTicker24h {
  lastPrice: string;
  priceChangePercent: string;
}

interface BinanceKline {
  0: number; 1: string; 2: string; 3: string; 4: string; 5: string;
}

export async function fetchLiveBtcPrice(): Promise<{ price: number; change24h: number; change1h: number }> {
  const [ticker24h, klines] = await Promise.all([
    cloudGet<BinanceTicker24h>("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", 6000),
    cloudGet<BinanceKline[]>("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=2", 6000),
  ]);
  const price = parseFloat(ticker24h.lastPrice);
  const change24h = parseFloat(ticker24h.priceChangePercent);
  let change1h = 0;
  if (klines.length >= 2) {
    const prevOpen = parseFloat(klines[0][1]);
    if (prevOpen > 0) change1h = Math.round((price / prevOpen - 1) * 10000) / 100;
  }
  return { price, change24h: Math.round(change24h * 100) / 100, change1h };
}

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function probAbove(spot: number, strike: number, vol: number, days: number): number {
  if (days <= 0) return spot > strike ? 1 : 0;
  const T = days / 365;
  const d2 = (Math.log(spot / strike) - 0.5 * vol * vol * T) / (vol * Math.sqrt(T));
  return Math.max(0.001, Math.min(0.999, normalCDF(d2)));
}

function probBelow(spot: number, strike: number, vol: number, days: number): number {
  return 1 - probAbove(spot, strike, vol, days);
}

function probInRange(spot: number, lo: number, hi: number, vol: number, days: number): number {
  return Math.max(0.001, probAbove(spot, lo, vol, days) - probAbove(spot, hi, vol, days));
}

interface ParsedBtcMarket {
  strikePrice: number;
  strikeType: "above" | "below" | "range";
  strikeLow?: number;
  strikeHigh?: number;
  expiryDate: string;
  daysToExpiry: number;
}

function parseDollarAmount(raw: string, suffix?: string): number {
  let n = parseFloat(raw.replace(/,/g, ""));
  if (suffix === "k" || suffix === "K") n *= 1000;
  return n;
}

function parseBtcMarket(question: string, endDate: string): ParsedBtcMarket | null {
  const q = question.toLowerCase().replace(/,/g, "");
  if (!/bitcoin|btc/.test(q)) return null;
  if (!/\$\d|\d+k\b|above|below|exceed|reach|higher|lower|between/.test(q)) return null;

  const now = new Date();
  const expiry = new Date(endDate);
  const daysToExpiry = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
  if (daysToExpiry <= 0 || daysToExpiry > 365) return null;
  const expiryDate = expiry.toISOString().split("T")[0];

  const rangeMatch =
    q.match(/between\s+\$?([\d.]+)(k?)\s+and\s+\$?([\d.]+)(k?)/) ||
    q.match(/\$?([\d.]+)(k?)\s*[-–]\s*\$?([\d.]+)(k?)\s*(?:range|by|on|at|or)/);
  if (rangeMatch) {
    const lo = parseDollarAmount(rangeMatch[1], rangeMatch[2]);
    const hi = parseDollarAmount(rangeMatch[3], rangeMatch[4]);
    if (lo > 1000 && hi > lo && hi < 1_000_000) {
      return { strikePrice: (lo + hi) / 2, strikeType: "range", strikeLow: lo, strikeHigh: hi, expiryDate, daysToExpiry };
    }
  }

  const abovePatterns = [
    /(?:above|exceed|over|reach|hit|at least|higher than|more than|close above|end above)\s+\$?([\d.]+)(k?)/,
    /\$?([\d.]+)(k?)\s+or\s+(?:higher|above|more)/,
    /price\s+(?:of\s+)?\$?([\d.]+)(k?)\s+or\s+more/,
  ];
  for (const pat of abovePatterns) {
    const m = q.match(pat);
    if (m) {
      const strike = parseDollarAmount(m[1], m[2]);
      if (strike > 1000 && strike < 1_000_000)
        return { strikePrice: strike, strikeType: "above", expiryDate, daysToExpiry };
    }
  }

  const belowPatterns = [
    /(?:below|under|less than|lower than|close below|end below|not exceed|drop below|fall below)\s+\$?([\d.]+)(k?)/,
    /\$?([\d.]+)(k?)\s+or\s+(?:lower|below|less)/,
  ];
  for (const pat of belowPatterns) {
    const m = q.match(pat);
    if (m) {
      const strike = parseDollarAmount(m[1], m[2]);
      if (strike > 1000 && strike < 1_000_000)
        return { strikePrice: strike, strikeType: "below", expiryDate, daysToExpiry };
    }
  }

  return null;
}

function parseYesPrice(market: PolymarketMarket): number | null {
  try {
    const raw = market.outcomePrices as unknown as string;
    const prices = JSON.parse(raw || "[]") as string[];
    const p = parseFloat(prices[0] || "0");
    return p > 0.005 && p < 0.995 ? p : null;
  } catch { return null; }
}

export async function runBtcArbScan(bankroll: number): Promise<BtcArbResult> {
  const [btcData, rawEvents] = await Promise.all([
    fetchLiveBtcPrice(),
    cloudGet<Record<string, unknown>[]>(`${GAMMA_API}/events?active=true&closed=false&limit=300`, 15000),
  ]);

  const { price: liveBtcPrice, change24h: btcChange24h, change1h: btcChange1h } = btcData;

  const allMarkets: (PolymarketMarket & { endDate: string })[] = [];
  for (const event of rawEvents || []) {
    const markets = (event.markets as Record<string, unknown>[]) || [];
    for (const m of markets) {
      const endDate = (m.endDate as string) || (event.endDate as string) || "";
      if (!endDate) continue;
      const active = Boolean(m.active ?? true);
      const closed = Boolean(m.closed ?? false);
      if (!active || closed) continue;
      allMarkets.push({ ...(m as unknown as PolymarketMarket), endDate });
    }
  }

  const btcMarkets: { market: PolymarketMarket & { endDate: string }; parsed: ParsedBtcMarket; yesPrice: number }[] = [];
  for (const market of allMarkets) {
    const q = market.question || "";
    if (!/bitcoin|btc/i.test(q)) continue;
    const parsed = parseBtcMarket(q, market.endDate);
    if (!parsed) continue;
    const yesPrice = parseYesPrice(market);
    if (yesPrice === null) continue;
    btcMarkets.push({ market, parsed, yesPrice });
  }

  const signals: BtcSignal[] = [];
  for (const { market, parsed, yesPrice } of btcMarkets) {
    let theoreticalProb: number;
    if (parsed.strikeType === "above")
      theoreticalProb = probAbove(liveBtcPrice, parsed.strikePrice, ANNUAL_VOL, parsed.daysToExpiry);
    else if (parsed.strikeType === "below")
      theoreticalProb = probBelow(liveBtcPrice, parsed.strikePrice, ANNUAL_VOL, parsed.daysToExpiry);
    else
      theoreticalProb = probInRange(liveBtcPrice, parsed.strikeLow!, parsed.strikeHigh!, ANNUAL_VOL, parsed.daysToExpiry);

    const edge = Math.abs(theoreticalProb - yesPrice);
    if (edge < MIN_EDGE) continue;

    const direction: BtcSignal["direction"] = theoreticalProb > yesPrice ? "BUY_YES" : "BUY_NO";
    const rawKelly = direction === "BUY_YES"
      ? (theoreticalProb - yesPrice) / (1 - yesPrice)
      : ((1 - theoreticalProb) - (1 - yesPrice)) / yesPrice;
    const kellyFraction = Math.min(Math.max(rawKelly * 0.5, 0), MAX_KELLY);

    const ev = direction === "BUY_YES"
      ? Math.round((theoreticalProb / yesPrice - 1) * 10000) / 10000
      : Math.round(((1 - theoreticalProb) / (1 - yesPrice) - 1) * 10000) / 10000;

    const cf = Math.max(0.001, Math.min(0.999, theoreticalProb));
    const cm = Math.max(0.001, Math.min(0.999, yesPrice));
    const lor = Math.round(Math.abs(Math.log(cf / (1 - cf)) - Math.log(cm / (1 - cm))) * 100) / 100;
    const significance: BtcSignal["significance"] = lor >= 3 ? 4 : lor >= 2 ? 3 : lor >= 1 ? 2 : 1;
    const distancePct = Math.round((liveBtcPrice - parsed.strikePrice) / parsed.strikePrice * 10000) / 100;
    const lagPct = Math.round((theoreticalProb - yesPrice) / theoreticalProb * 10000) / 100;

    signals.push({
      marketId: market.id,
      marketQuestion: market.question || "Unknown",
      marketPrice: Math.round(yesPrice * 1000) / 1000,
      theoreticalProb: Math.round(theoreticalProb * 1000) / 1000,
      edge: Math.round(edge * 1000) / 1000,
      lagPct, direction, ev, lor, significance,
      kellyFraction: Math.round(kellyFraction * 1000) / 1000,
      recommendedBet: Math.round(bankroll * kellyFraction * 100) / 100,
      strikePrice: parsed.strikePrice,
      strikeType: parsed.strikeType,
      strikeLow: parsed.strikeLow,
      strikeHigh: parsed.strikeHigh,
      daysToExpiry: parsed.daysToExpiry,
      expiryDate: parsed.expiryDate,
      liveBtcPrice,
      distancePct,
    });
  }

  signals.sort((a, b) => b.lor - a.lor);
  return { liveBtcPrice, btcChange24h, btcChange1h, signals, marketsScanned: allMarkets.length, btcMarketsFound: btcMarkets.length, timestamp: new Date().toISOString() };
}
