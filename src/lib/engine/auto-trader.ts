// Auto-Trading Engine for BTC Price-Lag Arbitrage
// Runs periodic scans and places orders when signals meet criteria.
// Supports paper trading (simulated) and live trading (Polymarket CLOB).

import { runBtcArbScan, type BtcSignal, type BtcArbResult } from "./btc-arb";
import { httpsGet } from "@/lib/utils/https-get";

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
    const market = await httpsGet<Record<string, unknown>>(
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
    const book = await httpsGet<{
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
  if (betSize < 5) return null; // minimum $5 for live trades

  // For live trading, we need the CLOB client with proper auth.
  // The private key must be set in PRIVATE_KEY env var.
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("[AutoTrader] PRIVATE_KEY not set — cannot place live trades");
    return null;
  }

  try {
    // Dynamic import to avoid loading heavy deps in paper mode
    const { ClobClient } = await import("@polymarket/clob-client");
    const { createWalletClient, http } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { polygon } = await import("viem/chains");

    const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new ClobClient(CLOB_API, 137, walletClient as any);
    const creds = await client.createOrDeriveApiKey();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authedClient = new ClobClient(CLOB_API, 137, walletClient as any, creds, 2);

    // Place FOK (fill-or-kill) market order with 2% slippage tolerance
    const slippagePrice = Math.min(bestAsk * 1.02, 0.99);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = await (authedClient as any).createAndPostOrder(
      {
        tokenID: tokenInfo.tokenId,
        price: Math.round(slippagePrice * 100) / 100,
        side: "BUY",
        size: betSize,
      },
      { tickSize: tokenInfo.tickSize, negRisk: tokenInfo.negRisk },
      "FOK"
    );

    const shares = betSize / bestAsk;
    const trade: TradeRecord = {
      id: genId(),
      timestamp: new Date().toISOString(),
      marketId: signal.marketId,
      marketQuestion: signal.marketQuestion,
      direction: signal.direction,
      tokenId: tokenInfo.tokenId,
      entryPrice: Math.round(bestAsk * 1000) / 1000,
      size: Math.round(betSize * 100) / 100,
      shares: Math.round(shares * 100) / 100,
      theoreticalProb: signal.theoreticalProb,
      edge: signal.edge,
      lor: signal.lor,
      status: order.status === "matched" ? "open" : "pending",
      mode: "live",
      orderId: order.orderID,
    };

    return trade;
  } catch (err) {
    console.error("[AutoTrader] Live trade failed:", err);
    return null;
  }
}

// ── Core Scan Loop ───────────────────────────────────────────────────────────

async function scanAndTrade() {
  try {
    state.error = null;
    const result = await runBtcArbScan(state.bankroll);
    state.lastScan = result;
    state.lastScanTime = new Date().toISOString();
    state.scanCount++;

    // Filter signals that meet our thresholds
    const openTrades = state.trades.filter((t) => t.status === "open" || t.status === "pending");
    const slotsAvailable = state.maxConcurrentTrades - openTrades.length;
    if (slotsAvailable <= 0) return;

    // Already-traded market IDs
    const tradedMarkets = new Set(openTrades.map((t) => t.marketId));

    const qualifying = result.signals
      .filter((s) => s.lor >= state.minLor && s.edge >= state.minEdge)
      .filter((s) => !tradedMarkets.has(s.marketId))
      .slice(0, slotsAvailable);

    for (const signal of qualifying) {
      const trade = state.mode === "paper"
        ? await executePaperTrade(signal)
        : await executeLiveTrade(signal);

      if (trade) {
        state.trades.push(trade);
        console.log(
          `[AutoTrader] ${state.mode.toUpperCase()} trade: ${trade.direction} on "${trade.marketQuestion.slice(0, 60)}" — $${trade.size} @ ${trade.entryPrice}`
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
