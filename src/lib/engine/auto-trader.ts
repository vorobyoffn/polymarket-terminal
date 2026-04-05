// Auto-Trading Engine for BTC Price-Lag Arbitrage
// Runs periodic scans and places orders when signals meet criteria.
// Supports paper trading (simulated) and live trading (Polymarket CLOB).

import { runBtcArbScan, type BtcSignal, type BtcArbResult } from "./btc-arb";
import { runExpiryConvergenceScan, type ExpirySignal } from "./expiry-convergence";
import { runCorrelationArbScan, type CorrelationSignal } from "./correlation-arb";

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
const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

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

async function getAuthenticatedClobClient() {
  const now = Date.now();
  if (cachedClobClient && now - cachedClobClientTimestamp < CLOB_CACHE_TTL) {
    return cachedClobClient;
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");

  const { ClobClient } = await import("@polymarket/clob-client");
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { polygon } = await import("viem/chains");

  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(normalizedKey as `0x${string}`);
  console.log(`[CLOB] EOA address: ${account.address}`);
  console.log(`[CLOB] Proxy/funder: ${POLYMARKET_PROXY}`);

  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(POLYGON_RPC),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tmpClient = new ClobClient(CLOB_API, 137, walletClient as any);
  console.log("[CLOB] Deriving API credentials...");
  const creds = await tmpClient.createOrDeriveApiKey();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log(`[CLOB] Got API key: ${((creds as any).key || (creds as any).apiKey || "").slice(0, 8)}...`);

  // Signature type 2 = GNOSIS_SAFE (Polymarket proxy wallets)
  // Pass the funder address (proxy wallet) as the 6th argument
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authedClient = new ClobClient(
    CLOB_API, 137, walletClient as any, creds, 2, POLYMARKET_PROXY
  );

  cachedClobClient = authedClient;
  cachedClobClientTimestamp = now;
  console.log("[CLOB] Authenticated client ready");
  return authedClient;
}

async function executeLiveTrade(signal: BtcSignal): Promise<TradeRecord | null> {
  const tokenInfo = await getMarketTokenInfo(signal.marketId, signal.direction);
  if (!tokenInfo) {
    console.error(`[AutoTrader] No token info for market ${signal.marketId}`);
    return null;
  }

  const bestAsk = await getOrderbookBestPrice(tokenInfo.tokenId, "buy");
  if (!bestAsk) {
    console.error(`[AutoTrader] No orderbook for token ${tokenInfo.tokenId}`);
    return null;
  }

  const betSize = Math.min(signal.recommendedBet, state.bankroll * 0.2);
  if (betSize < 5) return null;

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("[AutoTrader] PRIVATE_KEY not set — cannot place live trades");
    return null;
  }

  try {
    const authedClient = await getAuthenticatedClobClient();

    // Use GTC (Good-Til-Cancelled) limit order for better fill rates
    // FOK cancels immediately if not filled — GTC rests on the book
    const limitPrice = Math.min(bestAsk, 0.99);
    const roundedPrice = Math.round(limitPrice / parseFloat(tokenInfo.tickSize)) * parseFloat(tokenInfo.tickSize);
    const finalPrice = Math.round(roundedPrice * 100) / 100;

    console.log(`[CLOB] Placing GTC order: BUY ${tokenInfo.tokenId.slice(0, 12)}... @ ${finalPrice} size=$${betSize.toFixed(2)} tick=${tokenInfo.tickSize} negRisk=${tokenInfo.negRisk}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = await (authedClient as any).createAndPostOrder(
      {
        tokenID: tokenInfo.tokenId,
        price: finalPrice,
        side: "BUY",
        size: betSize,
      },
      { tickSize: tokenInfo.tickSize, negRisk: tokenInfo.negRisk },
      "GTC" // Good-Til-Cancelled instead of FOK
    );

    console.log(`[CLOB] Order response:`, JSON.stringify(order).slice(0, 300));

    const orderStatus = order?.status || order?.orderStatus || "unknown";
    const orderId = order?.orderID || order?.id || order?.order_id || "";

    const shares = betSize / bestAsk;
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

    // ── Strategy 1: BTC Arb ──────────────────────────────────────────────
    let btcSignals: BtcSignal[] = [];
    try {
      const btcResult = await runBtcArbScan(state.bankroll);
      state.lastScan = btcResult;
      btcSignals = btcResult.signals
        .filter((s) => s.lor >= state.minLor && s.edge >= state.minEdge)
        .filter((s) => !tradedMarkets.has(s.marketId));
    } catch (e) {
      console.error("[AutoTrader] BTC scan error:", e instanceof Error ? e.message : e);
    }

    // ── Strategy 2: Expiry Convergence ───────────────────────────────────
    let expirySignals: BtcSignal[] = [];
    try {
      const expiryResult = await runExpiryConvergenceScan(state.bankroll);
      expirySignals = expiryResult.signals
        .filter((s) => s.edge >= 0.05 && s.confidence >= 0.70)
        .filter((s) => !tradedMarkets.has(s.marketId))
        .map((s) => {
          const t = expirySignalToTradeable(s);
          t.recommendedBet = Math.min(state.bankroll * t.kellyFraction, state.bankroll * 0.10);
          return t;
        });
      console.log(`[AutoTrader] Expiry scan: ${expiryResult.signals.length} signals, ${expirySignals.length} qualifying`);
    } catch (e) {
      console.error("[AutoTrader] Expiry scan error:", e instanceof Error ? e.message : e);
    }

    // ── Strategy 3: Correlation Arb ──────────────────────────────────────
    let corrSignals: BtcSignal[] = [];
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

    // ── Merge & Execute ──────────────────────────────────────────────────
    // Priority: Expiry (highest edge, shortest time) > Corr Arb > BTC Arb
    const allSignals = [
      ...expirySignals.map(s => ({ ...s, _strategy: "expiry" })),
      ...corrSignals.map(s => ({ ...s, _strategy: "correlation" })),
      ...btcSignals.map(s => ({ ...s, _strategy: "btc" })),
    ];

    // Sort by edge descending
    allSignals.sort((a, b) => b.edge - a.edge);

    let executed = 0;
    for (const signal of allSignals) {
      if (executed >= slotsAvailable) break;
      if (tradedMarkets.has(signal.marketId)) continue;

      // Risk check: max 40% of bankroll in any single strategy
      const stratTrades = state.trades.filter(t => t.status === "open");
      const stratAlloc = stratTrades.reduce((s, t) => s + t.size, 0);
      if (stratAlloc >= state.bankroll * 0.40) continue;

      // Compute bet size if not set
      if (!signal.recommendedBet || signal.recommendedBet <= 0) {
        signal.recommendedBet = Math.min(state.bankroll * signal.kellyFraction, state.bankroll * 0.10);
      }

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
  if (!trade || trade.mode !== "paper") return;

  trade.status = outcome;
  if (outcome === "won") {
    // Won: get back shares * $1 (binary payout)
    const payout = trade.shares * 1;
    trade.exitPrice = 1;
    trade.pnl = Math.round((payout - trade.size) * 100) / 100;
    state.paperBalance += payout;
  } else {
    // Lost: shares worth $0
    trade.exitPrice = 0;
    trade.pnl = -trade.size;
  }

  updateStats();
}
