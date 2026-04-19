// Auto-Trading Engine for BTC Price-Lag Arbitrage
// Runs periodic scans and places orders when signals meet criteria.
// Supports paper trading (simulated) and live trading (Polymarket CLOB).

import { runBtcArbScan, type BtcSignal, type BtcArbResult } from "./btc-arb";
import { runExpiryConvergenceScan, type ExpirySignal } from "./expiry-convergence";
import { runCorrelationArbScan, type CorrelationSignal } from "./correlation-arb";
import { runWeatherArbScan, type WeatherSignal } from "@/lib/weather/oracle";
import { recordPriceSnapshot } from "@/lib/weather/price-recorder";

// Cloud-friendly fetch
async function cloudGet<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";
const CLOB_PROXY = process.env.CLOB_PROXY_URL || ""; // residential proxy for CLOB orders
const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

// Set HTTPS_PROXY globally at module load time — axios respects this
// Must happen BEFORE any axios import (including from @polymarket/clob-client)
if (CLOB_PROXY) {
  process.env.https_proxy = CLOB_PROXY;
  process.env.http_proxy = CLOB_PROXY;
  process.env.HTTPS_PROXY = CLOB_PROXY;
  process.env.HTTP_PROXY = CLOB_PROXY;
  console.log(`[CLOB] 🌐 Global proxy env set: ${CLOB_PROXY.replace(/:[^:]+@/, ":***@")}`);
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TradingMode = "paper" | "live";

export interface TradeRecord {
  id: string;
  timestamp: string;
  marketId: string;
  marketQuestion: string;
  direction: "BUY_YES" | "BUY_NO";
  tokenId: string;
  entryPrice: number;
  size: number;       // dollar amount
  shares: number;     // shares bought
  theoreticalProb: number;
  edge: number;
  lor: number;
  status: "open" | "won" | "lost" | "pending";
  mode: TradingMode;
  orderId?: string;
  exitPrice?: number;
  pnl?: number;
  expiryDate?: string;
}

export interface AutoTraderState {
  running: boolean;
  mode: TradingMode;
  bankroll: number;
  paperBalance: number;
  scanIntervalSec: number;
  minLor: number;
  minEdge: number;
  maxConcurrentTrades: number;
  trades: TradeRecord[];
  lastScan: BtcArbResult | null;
  lastScanTime: string | null;
  scanCount: number;
  totalPnl: number;
  winRate: number;
  error: string | null;
  lastOrderError: { timestamp: string; market: string; response: string } | null;
}

interface MarketTokenInfo {
  tokenId: string;
  tickSize: string;
  negRisk: boolean;
}

// ── Singleton state ──────────────────────────────────────────────────────────

let state: AutoTraderState = {
  running: false,
  mode: (process.env.TRADING_MODE as TradingMode) || "paper",
  bankroll: parseFloat(process.env.PAPER_BALANCE || "1000"),
  paperBalance: parseFloat(process.env.PAPER_BALANCE || "1000"),
  scanIntervalSec: 60,
  minLor: 1.5,
  minEdge: 0.08,
  maxConcurrentTrades: 5,
  trades: [],
  lastScan: null,
  lastScanTime: null,
  scanCount: 0,
  totalPnl: 0,
  winRate: 0,
  error: null,
  lastOrderError: null,
};

let scanTimer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getMarketTokenInfo(marketId: string, direction: "BUY_YES" | "BUY_NO"): Promise<MarketTokenInfo | null> {
  try {
    const market = await cloudGet<Record<string, unknown>>(
      `${GAMMA_API}/markets/${marketId}`,
      8000
    );
    const tokenIdsRaw = market.clobTokenIds as string | undefined;
    if (!tokenIdsRaw) return null;
    const tokenIds = JSON.parse(tokenIdsRaw) as string[];
    // tokenIds[0] = YES token, tokenIds[1] = NO token
    const tokenId = direction === "BUY_YES" ? tokenIds[0] : tokenIds[1];
    if (!tokenId) return null;
    const tickSize = String(market.orderPriceMinTickSize || "0.01");
    const negRisk = Boolean(market.negRisk ?? false);
    return { tokenId, tickSize, negRisk };
  } catch {
    return null;
  }
}

async function getOrderbookBestPrice(tokenId: string, side: "buy" | "sell"): Promise<number | null> {
  try {
    const book = await cloudGet<{
      bids: { price: string; size: string }[];
      asks: { price: string; size: string }[];
    }>(`${CLOB_API}/book?token_id=${tokenId}`, 6000);
    if (side === "buy" && book.asks.length > 0) {
      return parseFloat(book.asks[0].price);
    }
    if (side === "sell" && book.bids.length > 0) {
      return parseFloat(book.bids[0].price);
    }
    return null;
  } catch {
    return null;
  }
}

function updateStats() {
  const closed = state.trades.filter((t) => t.status === "won" || t.status === "lost");
  state.totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = closed.filter((t) => t.status === "won").length;
  state.winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;
}

// ── Paper Trading ────────────────────────────────────────────────────────────

async function executePaperTrade(signal: BtcSignal): Promise<TradeRecord | null> {
  const betSize = Math.min(signal.recommendedBet, state.paperBalance * 0.2);
  if (betSize < 1) return null;

  const tokenInfo = await getMarketTokenInfo(signal.marketId, signal.direction);
  const entryPrice = signal.direction === "BUY_YES" ? signal.marketPrice : 1 - signal.marketPrice;
  const shares = betSize / entryPrice;

  state.paperBalance -= betSize;

  const trade: TradeRecord = {
    id: genId(),
    timestamp: new Date().toISOString(),
    marketId: signal.marketId,
    marketQuestion: signal.marketQuestion,
    direction: signal.direction,
    tokenId: tokenInfo?.tokenId || "paper_" + signal.marketId,
    entryPrice: Math.round(entryPrice * 1000) / 1000,
    size: Math.round(betSize * 100) / 100,
    shares: Math.round(shares * 100) / 100,
    theoreticalProb: signal.theoreticalProb,
    edge: signal.edge,
    lor: signal.lor,
    status: "open",
    mode: "paper",
  };

  return trade;
}

// ── Live Trading (CLOB) ──────────────────────────────────────────────────────

const POLYMARKET_PROXY = process.env.POLYMARKET_PROXY || "0x999c4Ca086561914928F423090ac2A218f125A61";
const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";

// Cache the authenticated CLOB client to avoid re-deriving keys every trade
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedClobClient: any = null;
let cachedClobClientTimestamp = 0;
const CLOB_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Install proxy for axios (used by @polymarket/clob-client internally)
// Must patch BEFORE and AFTER CLOB client import since it uses static axios import
let proxyInstalled = false;
async function installAxiosProxy() {
  if (proxyInstalled || !CLOB_PROXY) return;
  proxyInstalled = true;

  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const agent = new HttpsProxyAgent(CLOB_PROXY);

    // Patch axios defaults - this patches the shared singleton
    const axios = (await import("axios")).default;
    axios.defaults.httpsAgent = agent;
    axios.defaults.httpAgent = agent;
    axios.defaults.proxy = false;

    // Also add an axios interceptor to force the agent on every request
    axios.interceptors.request.use((config) => {
      if (config.url?.includes("clob.polymarket.com")) {
        config.httpsAgent = agent;
        config.httpAgent = agent;
        config.proxy = false;
      }
      return config;
    });

    // ALSO patch via require cache to get the same instance the CLOB client uses
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const axiosFromRequire = require("axios");
      if (axiosFromRequire?.default) {
        axiosFromRequire.default.defaults.httpsAgent = agent;
        axiosFromRequire.default.defaults.httpAgent = agent;
        axiosFromRequire.default.defaults.proxy = false;
        axiosFromRequire.default.interceptors.request.use((config: { url?: string; httpsAgent?: unknown; httpAgent?: unknown; proxy?: boolean }) => {
          if (config.url?.includes("clob.polymarket.com")) {
            config.httpsAgent = agent;
            config.httpAgent = agent;
            config.proxy = false;
          }
          return config;
        });
      }
    } catch { /* require fallback failed, ESM-only */ }

    const proxyUrl = new URL(CLOB_PROXY);
    console.log(`[CLOB] ✅ Axios proxy installed: ${proxyUrl.host} (user: ${proxyUrl.username})`);
  } catch (e) {
    console.error("[CLOB] ❌ Axios proxy setup failed:", e instanceof Error ? e.message : e);
  }
}

async function getAuthenticatedClobClient() {
  const now = Date.now();
  if (cachedClobClient && now - cachedClobClientTimestamp < CLOB_CACHE_TTL) {
    return cachedClobClient;
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");

  // Install axios proxy BEFORE importing CLOB client
  await installAxiosProxy();

  const { ClobClient } = await import("@polymarket/clob-client");
  // Use ethers v5 Wallet — proven to work with CLOB SDK signing
  const { Wallet } = await import("ethers");

  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const wallet = new Wallet(normalizedKey);
  console.log(`[CLOB] EOA address: ${wallet.address}`);

  // Derive or use cached API credentials
  // The CLOB SDK's createOrDeriveApiKey can return incomplete objects in webpack
  // so we derive once and cache, or use env var overrides
  let creds: { key: string; secret: string; passphrase: string };

  const envKey = process.env.CLOB_API_KEY;
  const envSecret = process.env.CLOB_API_SECRET;
  const envPassphrase = process.env.CLOB_API_PASSPHRASE;

  if (envKey && envSecret && envPassphrase) {
    creds = { key: envKey, secret: envSecret, passphrase: envPassphrase };
    console.log(`[CLOB] Using env credentials: ${creds.key.slice(0, 8)}...`);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tmpClient = new ClobClient(CLOB_API, 137, wallet as any);
    console.log("[CLOB] Deriving API credentials...");
    const rawCreds = await tmpClient.createOrDeriveApiKey();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rc = rawCreds as any;
    creds = {
      key: rc.key || rc.apiKey || "",
      secret: rc.secret || "",
      passphrase: rc.passphrase || "",
    };
    console.log(`[CLOB] Got key: ${creds.key.slice(0, 8)}... secret=${!!creds.secret} passphrase=${!!creds.passphrase}`);

    if (!creds.secret || !creds.passphrase) {
      console.error("[CLOB] ❌ Credentials incomplete! Set CLOB_API_KEY, CLOB_API_SECRET, CLOB_API_PASSPHRASE in .env.local");
      throw new Error("CLOB credentials incomplete — secret or passphrase missing");
    }
  }

  // Sig type 0 = EOA — funds are in the MetaMask wallet directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authedClient = new ClobClient(CLOB_API, 137, wallet as any, creds as any, 0);

  // Monkey-patch _resolveTickSize to skip network call when tickSize is provided
  // The SDK always fetches getTickSize even when tickSize is passed, causing AggregateError
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (authedClient as any)._resolveTickSize = async function(tokenID: string, tickSize?: string) {
    if (tickSize) return tickSize;
    // Fallback: try network call, default to 0.01 on failure
    try {
      return await this.getTickSize(tokenID);
    } catch {
      return "0.01";
    }
  };

  // Also patch _resolveFeeRateBps to not fail on network errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origResolveFee = (authedClient as any)._resolveFeeRateBps?.bind(authedClient);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (authedClient as any)._resolveFeeRateBps = async function(tokenID: string, feeRateBps?: number) {
    try {
      return origResolveFee ? await origResolveFee(tokenID, feeRateBps) : feeRateBps || 0;
    } catch {
      return feeRateBps || 0;
    }
  };

  cachedClobClient = authedClient;
  cachedClobClientTimestamp = now;
  console.log("[CLOB] ✅ Authenticated client ready (ethers v5, sig type 0, patched)");
  return authedClient;
}

async function executeLiveTrade(signal: BtcSignal): Promise<TradeRecord | null> {
  const tokenInfo = await getMarketTokenInfo(signal.marketId, signal.direction);
  if (!tokenInfo) {
    console.error(`[AutoTrader] No token info for market ${signal.marketId}`);
    return null;
  }

  // ── STEP 1: PRICE ANALYSIS ──
  // Use the signal's market price as reference (from Gamma API — reliable)
  // Orderbook can be misleading for negRisk/weather markets
  const marketYesPrice = signal.marketPrice || 0;
  const entryEstimate = signal.direction === "BUY_YES" ? marketYesPrice : 1 - marketYesPrice;

  // Try orderbook for spread check, but don't require it
  let bestAsk: number | null = null;
  let bestBid: number | null = null;
  let spreadOk = true;
  try {
    bestAsk = await getOrderbookBestPrice(tokenInfo.tokenId, "buy");
    bestBid = await getOrderbookBestPrice(tokenInfo.tokenId, "sell");
    if (bestAsk && bestBid) {
      const mid = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;
      const spreadPct = mid > 0 ? spread / mid : 1;
      // Only block on spread if it's a non-negRisk market (weather markets have weird orderbooks)
      if (!tokenInfo.negRisk && spreadPct > 0.12) {
        console.log(`[SKIP] ${signal.marketId} spread too wide: ${(spreadPct * 100).toFixed(1)}%`);
        spreadOk = false;
      }
    }
  } catch { /* orderbook fetch failed — proceed with signal price */ }
  if (!spreadOk) return null;

  // ── STEP 2: PAYOFF RATIO CHECK ──
  const potentialProfit = 1 - entryEstimate;
  const potentialLoss = entryEstimate;
  const payoffRatio = potentialLoss > 0 ? potentialProfit / potentialLoss : 0;

  if (payoffRatio < 0.5) {
    console.log(`[SKIP] ${signal.marketId} payoff ratio too low: ${payoffRatio.toFixed(2)}x (entry ~${(entryEstimate * 100).toFixed(0)}¢)`);
    return null;
  }

  // ── STEP 3: PRICE ZONE CHECK ──
  if (entryEstimate > 0.65) {
    console.log(`[SKIP] ${signal.marketId} entry too high: ${(entryEstimate * 100).toFixed(1)}¢`);
    return null;
  }
  if (entryEstimate < 0.03) {
    console.log(`[SKIP] ${signal.marketId} entry too low: ${(entryEstimate * 100).toFixed(1)}¢`);
    return null;
  }

  const betSize = Math.min(signal.recommendedBet, state.bankroll * 0.08);
  if (betSize < 5) return null;

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("[AutoTrader] PRIVATE_KEY not set");
    return null;
  }

  try {
    const authedClient = await getAuthenticatedClobClient();

    // ── STEP 5: SMART LIMIT PRICING (Weather-optimized) ──
    const theoreticalPrice = signal.theoreticalProb || 0;
    const tick = parseFloat(tokenInfo.tickSize);
    let limitPrice: number;

    // Weather markets have thin orderbooks — the ask is often 90-99¢
    // which is meaningless. Use model price instead of orderbook.
    const isWeather = signal.marketQuestion?.toLowerCase().includes("temperature") ||
                      signal.marketQuestion?.toLowerCase().includes("highest");

    if (signal.direction === "BUY_YES") {
      if (theoreticalPrice > marketYesPrice && theoreticalPrice > 0) {
        // Place at 25-30% between market and model for weather (tighter = better entry)
        // Place at 40% for other markets
        const aggression = isWeather ? 0.25 : 0.40;
        limitPrice = marketYesPrice + (theoreticalPrice - marketYesPrice) * aggression;
      } else {
        // No model edge — bid 15-20% below market
        limitPrice = marketYesPrice * (isWeather ? 0.80 : 0.85);
      }
      // Only use orderbook ask if it's a real price (not 90¢+ nonsense on weather)
      if (bestAsk && (!isWeather || bestAsk < limitPrice * 1.5)) {
        limitPrice = Math.min(limitPrice, bestAsk);
      }
    } else {
      // BUY NO
      const noMarketPrice = 1 - marketYesPrice;
      const noModelPrice = theoreticalPrice > 0 ? 1 - theoreticalPrice : 0;
      if (noModelPrice > noMarketPrice && noModelPrice > 0) {
        const aggression = isWeather ? 0.25 : 0.40;
        limitPrice = noMarketPrice + (noModelPrice - noMarketPrice) * aggression;
      } else {
        limitPrice = noMarketPrice * (isWeather ? 0.80 : 0.85);
      }
      if (bestAsk && (!isWeather || bestAsk < limitPrice * 1.5)) {
        limitPrice = Math.min(limitPrice, bestAsk);
      }
    }

    // Hard ceiling: 55¢ for weather (tighter), 60¢ for others
    const priceCeiling = isWeather ? 0.55 : 0.60;
    limitPrice = Math.min(limitPrice, priceCeiling);
    limitPrice = Math.max(limitPrice, 0.03);

    const roundedPrice = Math.round(limitPrice / tick) * tick;
    const finalPrice = Math.max(tick, Math.min(priceCeiling, Math.round(roundedPrice * 1000) / 1000));

    console.log(`[CLOB] Placing GTC order: BUY ${tokenInfo.tokenId.slice(0, 12)}... @ ${finalPrice} (mktYes=${(marketYesPrice*100).toFixed(1)}c model=${(theoreticalPrice*100).toFixed(1)}c) size=$${betSize.toFixed(2)} tick=${tokenInfo.tickSize} negRisk=${tokenInfo.negRisk}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = await (authedClient as any).createAndPostOrder(
      {
        tokenID: tokenInfo.tokenId,
        price: finalPrice,
        side: "BUY",
        size: betSize,
      },
      { tickSize: tokenInfo.tickSize, negRisk: tokenInfo.negRisk },
      "GTC"
    );

    const orderResponseStr = JSON.stringify(order).slice(0, 400);
    console.log(`[CLOB] Order response:`, orderResponseStr);

    const orderStatus = order?.status || order?.orderStatus || "unknown";
    const orderId = order?.orderID || order?.id || order?.order_id || "";

    // Phantom-trade guard: if CLOB didn't return an orderId, the order did NOT post.
    // Record the rejection reason for diagnostics and skip adding to state (avoids
    // consuming daily cap on orders that never executed).
    if (!orderId) {
      const reason = order?.errorMsg || order?.error || order?.message || orderStatus || "no orderId returned";
      state.lastOrderError = {
        timestamp: new Date().toISOString(),
        market: signal.marketQuestion.slice(0, 80),
        response: orderResponseStr,
      };
      console.error(`[AutoTrader] ❌ CLOB rejected order on "${signal.marketQuestion.slice(0, 50)}": ${reason}`);
      return null;
    }

    const shares = betSize / finalPrice;
    const trade: TradeRecord = {
      id: genId(),
      timestamp: new Date().toISOString(),
      marketId: signal.marketId,
      marketQuestion: signal.marketQuestion,
      direction: signal.direction,
      tokenId: tokenInfo.tokenId,
      entryPrice: Math.round(finalPrice * 1000) / 1000,
      size: Math.round(betSize * 100) / 100,
      shares: Math.round(shares * 100) / 100,
      theoreticalProb: signal.theoreticalProb,
      edge: signal.edge,
      lor: signal.lor,
      status: orderStatus === "matched" || orderStatus === "live" ? "open" : "pending",
      mode: "live",
      orderId: orderId,
    };

    console.log(`[AutoTrader] ✅ LIVE order placed: ${orderId} status=${orderStatus} on "${signal.marketQuestion.slice(0, 50)}"`);
    return trade;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AutoTrader] ❌ Live trade FAILED: ${errMsg}`);
    console.error(`[AutoTrader] Market: ${signal.marketId} Token: ${tokenInfo.tokenId}`);
    // Don't return null silently — log the full error
    if (err instanceof Error && err.stack) {
      console.error(err.stack.split("\n").slice(0, 5).join("\n"));
    }
    return null;
  }
}

// ── Core Scan Loop ───────────────────────────────────────────────────────────

// Convert expiry signal to BtcSignal-like format for unified execution
function expirySignalToTradeable(sig: ExpirySignal): BtcSignal {
  return {
    marketId: sig.marketId,
    marketQuestion: sig.marketQuestion,
    marketPrice: sig.marketPrice,
    theoreticalProb: sig.estimatedTrueProb,
    edge: sig.edge,
    lagPct: 0,
    direction: sig.direction,
    ev: sig.ev,
    lor: sig.edge * 10, // synthetic LOR from edge
    significance: sig.confidence >= 0.9 ? 4 : sig.confidence >= 0.7 ? 3 : 2,
    kellyFraction: Math.min(sig.edge * 0.5, 0.15),
    recommendedBet: 0, // computed below
    strikePrice: 0,
    strikeType: "above",
    daysToExpiry: sig.daysToExpiry,
    expiryDate: sig.expiryDate,
    liveBtcPrice: 0,
    distancePct: 0,
  };
}

// Convert correlation signal into individual market trades
function correlationSignalToTradeables(sig: CorrelationSignal, bankroll: number): BtcSignal[] {
  if (sig.deviation < 0.05 || sig.marketCount < 2 || sig.marketCount > 10) return [];

  // For OVERPRICED (sum > 1): buy NO on the most overpriced markets
  // For UNDERPRICED (sum < 1): buy YES on the most underpriced markets
  const signals: BtcSignal[] = [];
  const betPerMarket = Math.min(bankroll * 0.05, 30); // max $30 per market in a corr arb

  for (const mkt of sig.markets) {
    // Find the most mispriced markets
    const fairPrice = mkt.yesPrice / sig.sumYesPrices; // each market's fair share
    const edge = Math.abs(mkt.yesPrice - fairPrice);
    if (edge < 0.03) continue;

    const direction: "BUY_YES" | "BUY_NO" = sig.type === "OVERPRICED" ? "BUY_NO" : "BUY_YES";

    signals.push({
      marketId: mkt.id,
      marketQuestion: mkt.question,
      marketPrice: mkt.yesPrice,
      theoreticalProb: fairPrice,
      edge,
      lagPct: 0,
      direction,
      ev: edge / (direction === "BUY_YES" ? mkt.yesPrice : 1 - mkt.yesPrice),
      lor: edge * 5,
      significance: edge >= 0.15 ? 4 : edge >= 0.10 ? 3 : 2,
      kellyFraction: Math.min(edge * 0.3, 0.10),
      recommendedBet: betPerMarket,
      strikePrice: 0,
      strikeType: "above",
      daysToExpiry: sig.daysToExpiry,
      expiryDate: "",
      liveBtcPrice: 0,
      distancePct: 0,
    });
  }

  return signals.slice(0, 3); // max 3 trades per corr arb event
}

async function scanAndTrade() {
  try {
    state.error = null;
    state.lastScanTime = new Date().toISOString();
    state.scanCount++;

    const openTrades = state.trades.filter((t) => t.status === "open" || t.status === "pending");
    const slotsAvailable = state.maxConcurrentTrades - openTrades.length;
    if (slotsAvailable <= 0) return;
    const tradedMarkets = new Set(openTrades.map((t) => t.marketId));

    // Record price snapshot for historical data
    try { await recordPriceSnapshot(); } catch (e) {
      console.error("[AutoTrader] Price recording failed:", e instanceof Error ? e.message : e);
    }

    // Auto-resolve any trades whose markets have settled
    try { await autoResolveTrades(); } catch { /* silent */ }

    // Auto-redeem: claim winnings when Polymarket marks positions as redeemable
    try { await autoRedeemPositions(); } catch (e) {
      console.error("[AutoTrader] Auto-redeem error:", e instanceof Error ? e.message : e);
    }

    // Run strategies SEQUENTIALLY to avoid DNS overload
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // ── Strategy 1: Weather Arbitrage (highest priority — daily resolution) ──
    let weatherSignals: BtcSignal[] = [];
    try {
      const weatherResult = await runWeatherArbScan();
      weatherSignals = weatherResult.signals
        .filter((s: WeatherSignal) => s.edge >= 0.10 && s.confidence >= 0.70)
        .filter((s: WeatherSignal) => !tradedMarkets.has(s.marketId))
        .map((s: WeatherSignal): BtcSignal => ({
          marketId: s.marketId,
          marketQuestion: s.marketQuestion,
          marketPrice: s.marketPrice,
          theoreticalProb: s.forecastProb,
          edge: s.edge,
          lagPct: 0,
          direction: s.direction,
          ev: s.direction === "BUY_YES"
            ? s.forecastProb / s.marketPrice - 1
            : (1 - s.forecastProb) / (1 - s.marketPrice) - 1,
          lor: Math.abs(Math.log(Math.max(0.001, s.forecastProb) / (1 - Math.max(0.001, s.forecastProb))) - Math.log(Math.max(0.001, s.marketPrice) / (1 - Math.max(0.001, s.marketPrice)))),
          significance: s.edge >= 0.30 ? 4 : s.edge >= 0.20 ? 3 : s.edge >= 0.10 ? 2 : 1,
          kellyFraction: Math.min(s.edge * s.confidence * 0.5, 0.15),
          recommendedBet: Math.min(state.bankroll * s.edge * s.confidence * 0.5, state.bankroll * 0.10),
          strikePrice: s.targetTemp,
          strikeType: s.targetType === "above" ? "above" : s.targetType === "below" ? "below" : "range",
          daysToExpiry: s.daysToExpiry,
          expiryDate: s.date,
          liveBtcPrice: 0,
          distancePct: 0,
        }));
      console.log(`[AutoTrader] Weather scan: ${weatherResult.signals.length} signals, ${weatherSignals.length} qualifying`);
    } catch (e) {
      console.error("[AutoTrader] Weather scan error:", e instanceof Error ? e.message : e);
    }

    await delay(3000); // 3s pause between strategies

    // ── Strategy 2: BTC Arb (disabled unless ENABLE_BTC_ARB=true) ─────────
    let btcSignals: BtcSignal[] = [];
    if (process.env.ENABLE_BTC_ARB === "true") {
      try {
        const btcResult = await runBtcArbScan(state.bankroll);
        state.lastScan = btcResult;
        btcSignals = btcResult.signals
          .filter((s) => s.lor >= state.minLor && s.edge >= state.minEdge)
          .filter((s) => !tradedMarkets.has(s.marketId));
      } catch (e) {
        console.error("[AutoTrader] BTC scan error:", e instanceof Error ? e.message : e);
      }
      await delay(3000);
    }

    // ── Strategy 3: Correlation Arb (disabled unless ENABLE_CORRELATION_ARB=true) ─
    let corrSignals: BtcSignal[] = [];
    if (process.env.ENABLE_CORRELATION_ARB === "true") {
      try {
        const corrResult = await runCorrelationArbScan();
        for (const sig of corrResult.signals.slice(0, 10)) {
          const trades = correlationSignalToTradeables(sig, state.bankroll)
            .filter((s) => !tradedMarkets.has(s.marketId));
          corrSignals.push(...trades);
        }
        console.log(`[AutoTrader] Corr scan: ${corrResult.signals.length} events, ${corrSignals.length} trade signals`);
      } catch (e) {
        console.error("[AutoTrader] Correlation scan error:", e instanceof Error ? e.message : e);
      }
    }

    // ── Merge & Execute ──────────────────────────────────────────────────
    const allSignals = [
      ...weatherSignals.map(s => ({ ...s, _strategy: "weather" })),
      ...btcSignals.map(s => ({ ...s, _strategy: "btc" })),
      ...corrSignals.map(s => ({ ...s, _strategy: "correlation" })),
    ];

    // ══════════════════════════════════════════════════════════════════
    // MULTI-LAYER SIGNAL FILTER — each layer eliminates bad trades
    // ══════════════════════════════════════════════════════════════════

    let preFilter = allSignals.length;

    // ── Layer 1: TIME FILTER ──
    // Only trade markets that resolve soon. Long-dated = dead capital.
    const layer1 = allSignals.filter(s => {
      if (s.daysToExpiry > 14) return false;  // 14 days max (was 30)
      if (s.daysToExpiry < 0) return false;    // already expired
      return true;
    });

    // ── Layer 2: EDGE QUALITY ──
    // Edge must be real, not noise. Higher bar for longer-dated.
    const layer2 = layer1.filter(s => {
      const minEdge = s.daysToExpiry <= 1 ? 0.08 : s.daysToExpiry <= 3 ? 0.10 : 0.15;
      if (s.edge < minEdge) return false;
      // Edge should also be significant relative to the price
      // 10% edge on a 5¢ market = noise. 10% edge on a 40¢ market = real.
      if (s.marketPrice > 0 && s.edge / s.marketPrice < 0.15) return false;
      return true;
    });

    // ── Layer 3: PRICE ZONE ──
    // Only trade in the sweet spot: 8¢-60¢ for YES, 40¢-92¢ for NO
    // This ensures minimum 1.5:1 payoff ratio
    const layer3 = layer2.filter(s => {
      if (s.direction === "BUY_YES") {
        // We pay marketPrice for YES. Sweet spot: 8¢-60¢
        if (s.marketPrice < 0.08 || s.marketPrice > 0.60) return false;
      } else {
        // We buy NO token. NO price = 1 - yesPrice. Sweet spot: YES at 40¢-92¢
        if (s.marketPrice < 0.40 || s.marketPrice > 0.92) return false;
      }
      return true;
    });

    // ── Layer 4: CONFIDENCE ──
    // Signal must have meaningful statistical significance
    const layer4 = layer3.filter(s => {
      if (s.significance < 2) return false;  // at least 2 stars
      if (s.lor < 0.3) return false;         // LOR too weak
      return true;
    });

    // ── Layer 5: STRATEGY-SPECIFIC RULES ──
    const filtered = layer4.filter(s => {
      const strat = (s as unknown as { _strategy: string })._strategy;

      if (strat === "weather") {
        // Weather: must have high confidence forecast
        if (s.theoreticalProb < 0.05 || s.theoreticalProb > 0.95) return false;
        return true;
      }
      if (strat === "btc") {
        // BTC: only during volatile periods (high LOR)
        if (s.lor < 1.0) return false;
        return true;
      }
      if (strat === "correlation") {
        // Correlation: must be strong deviation (>8%) and not on near-certainty markets
        if (s.edge < 0.08) return false;
        return true;
      }
      return true;
    });

    console.log(`[AutoTrader] Filter: ${preFilter} raw → ${layer1.length} time → ${layer2.length} edge → ${layer3.length} price → ${layer4.length} confidence → ${filtered.length} final`);

    // ── RANKING: Score each signal by expected value per day ──
    // Score = (edge × confidence × payoff_ratio) / days_to_expiry
    const scored = filtered.map(s => {
      const entryPrice = s.direction === "BUY_YES" ? s.marketPrice : 1 - s.marketPrice;
      const payoffRatio = (1 - entryPrice) / entryPrice;
      const confidence = s.significance / 4;  // normalize to 0-1
      const daysToResolve = Math.max(s.daysToExpiry, 0.5); // min half day
      const score = (s.edge * confidence * payoffRatio) / daysToResolve;
      return { ...s, _score: score, _payoffRatio: payoffRatio };
    });

    scored.sort((a, b) => b._score - a._score);

    // ── POSITION LIMITS ──
    let executed = 0;
    const openTrades2 = state.trades.filter(t => t.status === "open" || t.status === "pending");
    const totalAllocated = openTrades2.reduce((s, t) => s + t.size, 0);
    // Rolling 24-hour window — trades age out continuously instead of a calendar-day reset
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const dailySpent = state.trades
      .filter(t => new Date(t.timestamp).getTime() > twentyFourHoursAgo)
      .reduce((s, t) => s + t.size, 0);

    for (const signal of scored) {
      if (executed >= slotsAvailable) break;
      if (tradedMarkets.has(signal.marketId)) continue;

      // Max 50% of bankroll allocated at any time
      if (totalAllocated + (signal.recommendedBet || 0) > state.bankroll * 0.50) {
        console.log(`[AutoTrader] Portfolio limit reached: $${totalAllocated.toFixed(0)} allocated`);
        break;
      }

      // Rolling 24h spend cap: 50% of bankroll
      if (dailySpent > state.bankroll * 0.50) {
        console.log(`[AutoTrader] 24h rolling limit reached: $${dailySpent.toFixed(0)} spent in last 24h`);
        break;
      }

      // Max 3 trades per strategy per cycle
      const strat = (signal as unknown as { _strategy: string })._strategy;
      const stratCount = state.trades.filter(t =>
        t.status === "open" && (t as unknown as { _strategy: string })._strategy === strat
      ).length;
      if (stratCount >= 3) continue;

      // Size: based on edge strength and payoff ratio
      const baseSize = Math.min(state.bankroll * signal.kellyFraction, state.bankroll * 0.10);
      signal.recommendedBet = Math.max(5, Math.min(baseSize, state.bankroll * 0.08));

      const trade = state.mode === "paper"
        ? await executePaperTrade(signal)
        : await executeLiveTrade(signal);

      if (trade) {
        state.trades.push(trade);
        tradedMarkets.add(signal.marketId);
        executed++;
        console.log(
          `[AutoTrader] ${state.mode.toUpperCase()} [${(signal as unknown as { _strategy: string })._strategy}] ${trade.direction} on "${trade.marketQuestion.slice(0, 50)}" — $${trade.size} @ ${trade.entryPrice}`
        );
      }
    }

    updateStats();
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    console.error("[AutoTrader] Scan error:", state.error);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getState(): AutoTraderState {
  return { ...state, trades: [...state.trades] };
}

export function startTrader(config?: Partial<Pick<AutoTraderState, "mode" | "bankroll" | "scanIntervalSec" | "minLor" | "minEdge" | "maxConcurrentTrades">>) {
  if (state.running) return;

  if (config) {
    if (config.mode) state.mode = config.mode;
    if (config.bankroll) { state.bankroll = config.bankroll; state.paperBalance = config.bankroll; }
    if (config.scanIntervalSec) state.scanIntervalSec = Math.max(30, config.scanIntervalSec);
    if (config.minLor !== undefined) state.minLor = config.minLor;
    if (config.minEdge !== undefined) state.minEdge = config.minEdge;
    if (config.maxConcurrentTrades) state.maxConcurrentTrades = config.maxConcurrentTrades;
  }

  state.running = true;
  state.error = null;
  console.log(`[AutoTrader] Started in ${state.mode} mode — scanning every ${state.scanIntervalSec}s`);

  // Run immediately then on interval
  scanAndTrade();
  scanTimer = setInterval(scanAndTrade, state.scanIntervalSec * 1000);
}

export function stopTrader() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  state.running = false;
  console.log("[AutoTrader] Stopped");
}

export function resetTrader() {
  stopTrader();
  state.trades = [];
  state.lastScan = null;
  state.lastScanTime = null;
  state.scanCount = 0;
  state.totalPnl = 0;
  state.winRate = 0;
  state.paperBalance = state.bankroll;
  state.error = null;
  console.log("[AutoTrader] Reset");
}

// Auto-start on server boot if AUTOSTART_TRADER=true
export function autoStartIfConfigured() {
  if (state.running) return;
  const autoStart = process.env.AUTOSTART_TRADER;
  if (autoStart !== "true") return;

  const mode = (process.env.TRADING_MODE as TradingMode) || "paper";
  const bankroll = parseFloat(process.env.AUTO_BANKROLL || "562");
  const interval = parseInt(process.env.AUTO_SCAN_INTERVAL || "60", 10);
  const minLor = parseFloat(process.env.AUTO_MIN_LOR || "1.5");
  const minEdge = parseFloat(process.env.AUTO_MIN_EDGE || "0.08");
  const maxTrades = parseInt(process.env.AUTO_MAX_TRADES || "5", 10);

  console.log(`[AutoTrader] Auto-starting in ${mode} mode (bankroll=$${bankroll}, interval=${interval}s)`);
  startTrader({ mode, bankroll, scanIntervalSec: interval, minLor, minEdge, maxConcurrentTrades: maxTrades });
}

// Run auto-start check on module load
autoStartIfConfigured();

export function closePaperTrade(tradeId: string, outcome: "won" | "lost") {
  const trade = state.trades.find((t) => t.id === tradeId);
  if (!trade) return;

  trade.status = outcome;
  if (outcome === "won") {
    const payout = trade.shares * 1;
    trade.exitPrice = 1;
    trade.pnl = Math.round((payout - trade.size) * 100) / 100;
    if (trade.mode === "paper") state.paperBalance += payout;
  } else {
    trade.exitPrice = 0;
    trade.pnl = -trade.size;
  }

  updateStats();
}

// ── Auto-redeem: claim winnings when Polymarket says redeemable ──────────────

// Track what we've already claimed so we don't retry
const claimedConditionIds = new Set([
  "0xb907f677d1a4574261607573593f9931f0bdcb48dd014d6e4fbc25aa4051904a", // Taipei
  "0xb8433678ecb971f94728c0579c9dd349521567678436daad1471c8f4cb5e033e", // Moscow 9C
  "0xc044c6e20f16903b5d307c786f7900917fdad7db76db0bbf7af15d28ed07c585", // Singapore
  "0x3b856eb1f92b453485bdbe3b9063d067bae3337d60165df145caa2daab7fc81a", // Moscow 11C
]);

async function autoRedeemPositions() {
  // Only check every 5th scan to avoid hammering the API
  if (state.scanCount % 5 !== 0) return;

  try {
    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const EOA = "0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0";
    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15000);
      const req = https.get(
        `https://data-api.polymarket.com/positions?user=${EOA}&sizeThreshold=0`,
        { family: 4 },
        (res) => {
          let d = "";
          res.on("data", (c: Buffer) => { d += c.toString(); });
          res.on("end", () => { clearTimeout(timer); resolve(d); });
        }
      );
      req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const positions = JSON.parse(data) as Array<{
      conditionId: string; title: string; redeemable: boolean;
      currentValue: number; size: number; curPrice: number; negativeRisk: boolean;
    }>;

    // Find redeemable positions we haven't claimed yet
    const toRedeem = positions.filter(p =>
      p.redeemable === true &&
      p.currentValue > 0.01 &&
      !claimedConditionIds.has(p.conditionId)
    );

    if (toRedeem.length === 0) return;

    console.log(`[AutoRedeem] Found ${toRedeem.length} redeemable positions`);

    // For negRisk positions, try selling on CLOB (safer than CTF redeem)
    // For non-negRisk, use CTF redeemPositions
    const { Wallet } = await import("ethers");
    const pk = process.env.PRIVATE_KEY;
    if (!pk) return;

    const normalizedKey = pk.startsWith("0x") ? pk : `0x${pk}`;

    for (const pos of toRedeem) {
      try {
        if (pos.negativeRisk) {
          // NegRisk: try selling on CLOB at 99¢
          console.log(`[AutoRedeem] Selling negRisk position: ${pos.title.slice(0, 40)} (\$${pos.currentValue.toFixed(2)})`);
          // Skip for now — CLOB sell requires token ID which we don't have here
          // Just log it so user knows
          console.log(`[AutoRedeem] ⚠️ NegRisk position needs manual claim or CLOB sell`);
        } else {
          // Standard: use CTF redeemPositions
          const { createWalletClient, createPublicClient, http, parseAbi } = await import("viem");
          const { privateKeyToAccount } = await import("viem/accounts");
          const { polygon } = await import("viem/chains");

          const account = privateKeyToAccount(normalizedKey as `0x${string}`);
          const rpc = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
          const wc = createWalletClient({ account, chain: polygon, transport: http(rpc, { timeout: 30000 }) });
          const pc = createPublicClient({ chain: polygon, transport: http(rpc, { timeout: 30000 }) });

          const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;
          const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
          const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
          const ctfAbi = parseAbi(["function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external"]);

          const hash = await wc.writeContract({
            address: CTF, abi: ctfAbi, functionName: "redeemPositions",
            args: [USDC, ZERO, pos.conditionId as `0x${string}`, [BigInt(1), BigInt(2)]],
          });
          await pc.waitForTransactionReceipt({ hash });
          claimedConditionIds.add(pos.conditionId);
          console.log(`[AutoRedeem] ✅ Claimed: ${pos.title.slice(0, 40)} — TX: ${hash}`);
        }
      } catch (e) {
        console.error(`[AutoRedeem] ❌ Failed: ${pos.title.slice(0, 40)} — ${e instanceof Error ? e.message.slice(0, 80) : e}`);
      }
    }
  } catch (e) {
    // Silent — will retry next cycle
  }
}

// ── Auto-resolve: check if markets have resolved ────────────────────────────

async function autoResolveTrades() {
  const openTrades = state.trades.filter(t => t.status === "open");
  if (openTrades.length === 0) return;

  for (const trade of openTrades) {
    try {
      // Check if market has resolved by fetching current price
      // Price of 0 or 1 (within tolerance) means resolved
      const tokenInfo = await getMarketTokenInfo(trade.marketId, trade.direction);
      if (!tokenInfo) continue;

      const price = await getOrderbookBestPrice(tokenInfo.tokenId, "buy");
      const bidPrice = await getOrderbookBestPrice(tokenInfo.tokenId, "sell");

      // Market resolved if: price >= 0.99 (YES won) or price <= 0.01 (NO won)
      // Or if no orderbook at all and expiry has passed
      let resolved = false;
      let won = false;

      if (price !== null && price >= 0.99) {
        // YES token is worth $1 = YES won
        resolved = true;
        won = trade.direction === "BUY_YES";
      } else if (price !== null && bidPrice !== null && bidPrice <= 0.01 && price <= 0.05) {
        // YES token worthless = NO won
        resolved = true;
        won = trade.direction === "BUY_NO";
      } else if (trade.expiryDate) {
        // Check if past expiry
        const expiry = new Date(trade.expiryDate);
        if (expiry.getTime() < Date.now() - 86_400_000) {
          // Past expiry by >1 day — try to determine outcome from price
          if (price !== null) {
            resolved = true;
            if (trade.direction === "BUY_YES") {
              won = price > 0.5;
            } else {
              won = price < 0.5;
            }
          }
        }
      }

      if (resolved) {
        closePaperTrade(trade.id, won ? "won" : "lost");
        console.log(`[AutoTrader] Auto-resolved: ${won ? "WON" : "LOST"} "${trade.marketQuestion.slice(0, 50)}" | P&L: $${trade.pnl?.toFixed(2)}`);
      }
    } catch {
      // Silent — will retry next cycle
    }
  }
}

// ── Stats export for Obsidian ───────────────────────────────────────────────

export interface TradeStats {
  mode: string;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
  totalInvested: number;
  currentBalance: number;
  byStrategy: Record<string, { trades: number; wins: number; losses: number; pnl: number }>;
  recentTrades: Array<{
    market: string;
    direction: string;
    entry: number;
    size: number;
    status: string;
    pnl: number | null;
    timestamp: string;
    strategy: string;
  }>;
}

export function getTradeStats(): { paper: TradeStats; live: TradeStats } {
  const buildStats = (mode: string): TradeStats => {
    const trades = state.trades.filter(t => mode === "all" || t.mode === mode);
    const closed = trades.filter(t => t.status === "won" || t.status === "lost");
    const wins = closed.filter(t => t.status === "won");
    const losses = closed.filter(t => t.status === "lost");
    const open = trades.filter(t => t.status === "open" || t.status === "pending");

    const pnls = closed.map(t => t.pnl || 0);

    const byStrategy: Record<string, { trades: number; wins: number; losses: number; pnl: number }> = {};
    for (const t of trades) {
      const strat = (t as unknown as { _strategy?: string })._strategy || "unknown";
      if (!byStrategy[strat]) byStrategy[strat] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
      byStrategy[strat].trades++;
      if (t.status === "won") byStrategy[strat].wins++;
      if (t.status === "lost") byStrategy[strat].losses++;
      byStrategy[strat].pnl += t.pnl || 0;
    }

    return {
      mode,
      totalTrades: trades.length,
      openTrades: open.length,
      closedTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? Math.round(wins.length / closed.length * 100) : 0,
      totalPnl: Math.round(pnls.reduce((s, p) => s + p, 0) * 100) / 100,
      avgPnl: pnls.length > 0 ? Math.round(pnls.reduce((s, p) => s + p, 0) / pnls.length * 100) / 100 : 0,
      bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
      worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
      totalInvested: Math.round(open.reduce((s, t) => s + t.size, 0) * 100) / 100,
      currentBalance: mode === "paper" ? state.paperBalance : state.bankroll,
      byStrategy,
      recentTrades: trades.slice(-20).reverse().map(t => ({
        market: t.marketQuestion,
        direction: t.direction,
        entry: t.entryPrice,
        size: t.size,
        status: t.status,
        pnl: t.pnl ?? null,
        timestamp: t.timestamp,
        strategy: (t as unknown as { _strategy?: string })._strategy || "unknown",
      })),
    };
  };

  return {
    paper: buildStats("paper"),
    live: buildStats("live"),
  };
}
