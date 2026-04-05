// Expiry Convergence Engine
// Finds markets near expiry where the outcome is already near-certain
// but the market price hasn't converged to 0 or 1 yet.

const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

// Cloud-friendly fetch
async function cloudGet<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExpirySignal {
  marketId: string;
  marketQuestion: string;
  marketPrice: number;         // current YES price
  estimatedTrueProb: number;   // our estimate of true probability
  edge: number;                // |trueProb - marketPrice|
  direction: "BUY_YES" | "BUY_NO";
  ev: number;
  confidence: number;          // 0-1
  category: string;
  reason: string;              // why we think outcome is certain
  daysToExpiry: number;
  expiryDate: string;
  annualizedReturn: number;    // edge / daysToExpiry * 365
}

export interface ExpiryConvergenceResult {
  signals: ExpirySignal[];
  marketsScanned: number;
  nearExpiryCount: number;
  timestamp: string;
}

// ── Crypto Price Oracle ──────────────────────────────────────────────────────

interface CryptoPrices {
  btc: number;
  eth: number;
  sol: number;
}

async function fetchCryptoPrices(): Promise<CryptoPrices> {
  try {
    const data = await cloudGet<Record<string, { usd: number }>>(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd",
      8000
    );
    return {
      btc: data.bitcoin?.usd || 0,
      eth: data.ethereum?.usd || 0,
      sol: data.solana?.usd || 0,
    };
  } catch {
    // Fallback to Coinbase for BTC only
    try {
      const cb = await cloudGet<{ data: { amount: string } }>(
        "https://api.coinbase.com/v2/prices/BTC-USD/spot", 8000
      );
      return { btc: parseFloat(cb.data.amount), eth: 0, sol: 0 };
    } catch {
      return { btc: 0, eth: 0, sol: 0 };
    }
  }
}

// ── Market Parsing & Oracle Logic ────────────────────────────────────────────

interface ParsedMarket {
  type: "crypto_above" | "crypto_below" | "date_passed" | "crypto_range";
  asset?: string;
  strike?: number;
  strikeLow?: number;
  strikeHigh?: number;
  deadlineDate?: string;
}

function parseMarketQuestion(question: string, endDate: string): ParsedMarket | null {
  const q = question.toLowerCase().replace(/,/g, "");

  // Crypto price markets: many patterns
  // "Will BTC hit $X", "Bitcoin above $X", "BTC price $X or higher", "Bitcoin to reach $X"
  const cryptoAboveMatch = q.match(
    /(?:will\s+)?(bitcoin|btc|ethereum|eth|ether|solana|sol)\s+(?:hit|reach|exceed|be\s+above|go\s+above|surpass|close\s+above|end\s+above|price\s+above|above|over|at\s+least|higher\s+than|to\s+reach|to\s+hit)\s+\$?([\d.]+)(k?)/
  ) || q.match(
    /\$?([\d.]+)(k?)\s+(?:bitcoin|btc|ethereum|eth|solana|sol)/
  );
  if (cryptoAboveMatch) {
    const asset = cryptoAboveMatch[1].replace("bitcoin", "btc").replace("ethereum", "eth").replace("solana", "sol");
    let strike = parseFloat(cryptoAboveMatch[2]);
    if (cryptoAboveMatch[3] === "k") strike *= 1000;
    return { type: "crypto_above", asset, strike };
  }

  // "BTC above/below $X"
  const cryptoBelowMatch = q.match(
    /(?:will\s+)?(bitcoin|btc|ethereum|eth|solana|sol)\s+(?:fall\s+below|drop\s+below|be\s+below|close\s+below|end\s+below|stay\s+below|under)\s+\$?([\d.]+)(k?)/
  );
  if (cryptoBelowMatch) {
    const asset = cryptoBelowMatch[1].replace("bitcoin", "btc").replace("ethereum", "eth").replace("solana", "sol");
    let strike = parseFloat(cryptoBelowMatch[2]);
    if (cryptoBelowMatch[3] === "k") strike *= 1000;
    return { type: "crypto_below", asset, strike };
  }

  // Date-based markets: "Will X happen by [date that has already passed]?"
  const dateMatch = q.match(/by\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})?,?\s*(\d{4})/);
  if (dateMatch) {
    const months: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
    const month = months[dateMatch[1]];
    const day = dateMatch[2] ? parseInt(dateMatch[2]) : 28;
    const year = parseInt(dateMatch[3]);
    const deadlineDate = new Date(year, month, day).toISOString().split("T")[0];
    return { type: "date_passed", deadlineDate };
  }

  // Also check end date format "YYYY-MM-DD"
  const endDateMatch = q.match(/by\s+(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (endDateMatch) {
    const deadlineDate = `${endDateMatch[1]}-${endDateMatch[2].padStart(2, "0")}-${endDateMatch[3].padStart(2, "0")}`;
    return { type: "date_passed", deadlineDate };
  }

  return null;
}

function evaluateCryptoMarket(
  parsed: ParsedMarket,
  prices: CryptoPrices,
  daysToExpiry: number
): { trueProb: number; confidence: number; reason: string } | null {
  if (!parsed.asset || !parsed.strike) return null;

  const price = parsed.asset === "btc" ? prices.btc
    : parsed.asset === "eth" ? prices.eth
    : parsed.asset === "sol" ? prices.sol : 0;
  if (price <= 0) return null;

  const distancePct = (price - parsed.strike) / parsed.strike;

  if (parsed.type === "crypto_above") {
    // If current price is WAY above strike and expiry is soon → YES is near-certain
    if (distancePct > 0.15 && daysToExpiry <= 3) {
      return { trueProb: 0.98, confidence: 0.95, reason: `${parsed.asset.toUpperCase()} at $${price.toFixed(0)} is ${(distancePct * 100).toFixed(0)}% above $${parsed.strike} with ${daysToExpiry}d left` };
    }
    if (distancePct > 0.25 && daysToExpiry <= 7) {
      return { trueProb: 0.95, confidence: 0.90, reason: `${parsed.asset.toUpperCase()} at $${price.toFixed(0)} is ${(distancePct * 100).toFixed(0)}% above $${parsed.strike} with ${daysToExpiry}d left` };
    }
    // If price is WAY below strike → NO is near-certain
    if (distancePct < -0.30 && daysToExpiry <= 7) {
      return { trueProb: 0.03, confidence: 0.90, reason: `${parsed.asset.toUpperCase()} at $${price.toFixed(0)} is ${(-distancePct * 100).toFixed(0)}% below $${parsed.strike} — unlikely to reach in ${daysToExpiry}d` };
    }
    if (distancePct < -0.50 && daysToExpiry <= 30) {
      return { trueProb: 0.02, confidence: 0.85, reason: `${parsed.asset.toUpperCase()} at $${price.toFixed(0)} is ${(-distancePct * 100).toFixed(0)}% below $${parsed.strike} — very unlikely in ${daysToExpiry}d` };
    }
  }

  if (parsed.type === "crypto_below") {
    if (distancePct < -0.15 && daysToExpiry <= 3) {
      return { trueProb: 0.98, confidence: 0.95, reason: `${parsed.asset.toUpperCase()} at $${price.toFixed(0)} is already ${(-distancePct * 100).toFixed(0)}% below $${parsed.strike}` };
    }
    if (distancePct > 0.30 && daysToExpiry <= 7) {
      return { trueProb: 0.03, confidence: 0.90, reason: `${parsed.asset.toUpperCase()} at $${price.toFixed(0)} is ${(distancePct * 100).toFixed(0)}% above $${parsed.strike} — drop unlikely in ${daysToExpiry}d` };
    }
  }

  return null;
}

function evaluateDateMarket(
  parsed: ParsedMarket,
  yesPrice: number,
): { trueProb: number; confidence: number; reason: string } | null {
  if (!parsed.deadlineDate) return null;

  const now = new Date();
  const deadline = new Date(parsed.deadlineDate);

  // If the deadline has already passed and the market hasn't resolved
  if (deadline < now && yesPrice > 0.10 && yesPrice < 0.90) {
    // The deadline passed — if the event didn't happen, NO should resolve
    // But we can't know for sure without checking resolution
    // Only flag high-confidence cases where the date is significantly past
    const daysPast = Math.ceil((now.getTime() - deadline.getTime()) / 86400000);
    if (daysPast >= 7) {
      return {
        trueProb: 0.05,
        confidence: 0.70,
        reason: `Deadline "${parsed.deadlineDate}" passed ${daysPast} days ago — likely resolves NO`,
      };
    }
  }

  return null;
}

// ── Main Scanner ─────────────────────────────────────────────────────────────

export async function runExpiryConvergenceScan(bankroll: number): Promise<ExpiryConvergenceResult> {
  const [prices, rawEvents] = await Promise.all([
    fetchCryptoPrices(),
    cloudGet<Record<string, unknown>[]>(`${GAMMA_API}/events?active=true&closed=false&limit=500`, 20000),
  ]);

  const now = new Date();
  const signals: ExpirySignal[] = [];
  let totalMarkets = 0;
  let nearExpiryCount = 0;

  for (const event of rawEvents || []) {
    const markets = (event.markets as Record<string, unknown>[]) || [];
    for (const m of markets) {
      totalMarkets++;
      const question = (m.question as string) || "";
      const endDate = (m.endDate as string) || (event.endDate as string) || "";
      if (!endDate || !question) continue;

      const active = Boolean(m.active ?? true);
      const closed = Boolean(m.closed ?? false);
      if (!active || closed) continue;

      const expiry = new Date(endDate);
      const daysToExpiry = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
      if (daysToExpiry > 30 || daysToExpiry < -30) continue; // Only near-expiry or recently passed

      nearExpiryCount++;

      // Parse YES price
      let yesPrice = 0.5;
      try {
        const pricesRaw = JSON.parse((m.outcomePrices as string) || "[]") as string[];
        yesPrice = parseFloat(pricesRaw[0] || "0.5");
      } catch { continue; }
      if (yesPrice <= 0.005 || yesPrice >= 0.995) continue; // Already converged

      // Try to evaluate
      const parsed = parseMarketQuestion(question, endDate);
      if (!parsed) continue;

      let evaluation: { trueProb: number; confidence: number; reason: string } | null = null;

      if (parsed.type === "crypto_above" || parsed.type === "crypto_below") {
        evaluation = evaluateCryptoMarket(parsed, prices, Math.max(daysToExpiry, 0));
      } else if (parsed.type === "date_passed") {
        evaluation = evaluateDateMarket(parsed, yesPrice);
      }

      if (!evaluation) continue;

      const { trueProb, confidence, reason } = evaluation;
      const edge = Math.abs(trueProb - yesPrice);
      if (edge < 0.05) continue; // Min 5% edge

      const direction: ExpirySignal["direction"] = trueProb > yesPrice ? "BUY_YES" : "BUY_NO";
      const buyPrice = direction === "BUY_YES" ? yesPrice : 1 - yesPrice;
      const ev = (trueProb > yesPrice)
        ? trueProb / yesPrice - 1
        : (1 - trueProb) / (1 - yesPrice) - 1;
      const annualizedReturn = daysToExpiry > 0 ? (ev / daysToExpiry) * 365 : ev * 100;

      // Detect category from question
      const q = question.toLowerCase();
      const category = /bitcoin|btc|eth|sol|crypto|token/i.test(q) ? "Crypto"
        : /election|president|congress|vote/i.test(q) ? "Politics"
        : /hurricane|weather|temperature|rain/i.test(q) ? "Weather"
        : "Other";

      signals.push({
        marketId: (m.id as string) || "",
        marketQuestion: question,
        marketPrice: Math.round(yesPrice * 1000) / 1000,
        estimatedTrueProb: Math.round(trueProb * 1000) / 1000,
        edge: Math.round(edge * 1000) / 1000,
        direction,
        ev: Math.round(ev * 10000) / 10000,
        confidence,
        category,
        reason,
        daysToExpiry: Math.max(daysToExpiry, 0),
        expiryDate: expiry.toISOString().split("T")[0],
        annualizedReturn: Math.round(annualizedReturn * 100) / 100,
      });
    }
  }

  signals.sort((a, b) => b.annualizedReturn - a.annualizedReturn);

  return {
    signals,
    marketsScanned: totalMarkets,
    nearExpiryCount,
    timestamp: new Date().toISOString(),
  };
}
