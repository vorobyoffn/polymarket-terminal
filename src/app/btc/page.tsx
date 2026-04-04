"use client";

import Header from "@/components/layout/Header";
import {
  Bitcoin, RefreshCw, TrendingUp, TrendingDown, Zap,
  BarChart2, ArrowUp, ArrowDown, Clock, Target,
  Play, Square, RotateCcw, ChevronDown, ChevronUp,
  Activity, DollarSign, Percent, AlertTriangle,
  CheckCircle, XCircle,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import type { BtcSignal, BtcArbResult } from "@/lib/engine/btc-arb";
import type { AutoTraderState, TradeRecord } from "@/lib/engine/auto-trader";

// ── Sub-components ─────────────────────────────────────────────────────────────

function SignificanceStars({ sig, lor }: { sig: BtcSignal["significance"]; lor: number }) {
  const oddsRatio = Math.exp(lor);
  const label =
    oddsRatio >= 20 ? `${oddsRatio.toFixed(0)}×` :
    oddsRatio >= 7  ? `${oddsRatio.toFixed(1)}×` :
                      `${oddsRatio.toFixed(2)}×`;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`text-[10px] ${i <= sig ? "text-accent-yellow" : "text-bg-tertiary"}`}>★</span>
        ))}
      </div>
      <span className="text-[9px] text-text-muted font-mono">{label} odds</span>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: BtcSignal["direction"] }) {
  const isYes = direction === "BUY_YES";
  return (
    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
      isYes
        ? "bg-accent-green/10 text-accent-green border-accent-green/30"
        : "bg-accent-red/10 text-accent-red border-accent-red/30"
    }`}>
      {isYes ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isYes ? "BUY YES" : "BUY NO"}
    </span>
  );
}

function LorBar({ lor }: { lor: number }) {
  const pct = Math.min(lor / 4 * 100, 100);
  const color = lor >= 3 ? "bg-accent-green" : lor >= 2 ? "bg-accent-yellow" : lor >= 1 ? "bg-accent-cyan" : "bg-text-muted";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{lor.toFixed(2)}</span>
    </div>
  );
}

// ── Sort types ─────────────────────────────────────────────────────────────────

type SortKey = "lor" | "edge" | "ev" | "expiry" | "lag";

function sortSignals(signals: BtcSignal[], key: SortKey): BtcSignal[] {
  return [...signals].sort((a, b) => {
    if (key === "expiry") return a.daysToExpiry - b.daysToExpiry;
    if (key === "lag") return Math.abs(b.lagPct) - Math.abs(a.lagPct);
    if (key === "edge") return b.edge - a.edge;
    if (key === "ev") return b.ev - a.ev;
    return b.lor - a.lor;
  });
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BtcArbPage() {
  const [result, setResult]     = useState<BtcArbResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [bankroll, setBankroll] = useState(1000);
  const [sortKey, setSortKey]   = useState<SortKey>("lor");
  const [liveBtc, setLiveBtc]   = useState<{ price: number; change24h: number; change1h: number } | null>(null);
  const [mounted, setMounted]   = useState(false);
  const tickerRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-trader state
  const [trader, setTrader]           = useState<AutoTraderState | null>(null);
  const [traderOpen, setTraderOpen]   = useState(false);
  const [traderLoading, setTraderLoading] = useState(false);
  const traderPollRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-trader config
  const [atMode, setAtMode]           = useState<"paper" | "live">("paper");
  const [atInterval, setAtInterval]   = useState(60);
  const [atMinLor, setAtMinLor]       = useState(1.5);
  const [atMinEdge, setAtMinEdge]     = useState(0.08);
  const [atMaxTrades, setAtMaxTrades] = useState(5);

  useEffect(() => { setMounted(true); }, []);

  // Poll live BTC price every 10s
  const pollBtcPrice = useCallback(async () => {
    try {
      const res = await fetch("/api/btc-arb?bankroll=0");
      if (!res.ok) return;
      const data = (await res.json()) as BtcArbResult;
      setLiveBtc({ price: data.liveBtcPrice, change24h: data.btcChange24h, change1h: data.btcChange1h });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    pollBtcPrice();
    tickerRef.current = setInterval(pollBtcPrice, 10_000);
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  }, [pollBtcPrice]);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/btc-arb?bankroll=${bankroll}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BtcArbResult;
      if ("error" in data) throw new Error(String((data as { error: string }).error));
      setResult(data);
      setLiveBtc({ price: data.liveBtcPrice, change24h: data.btcChange24h, change1h: data.btcChange1h });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bankroll]);

  // Poll auto-trader state
  const pollTrader = useCallback(async () => {
    try {
      const res = await fetch("/api/auto-trade");
      if (res.ok) setTrader(await res.json() as AutoTraderState);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    pollTrader();
    traderPollRef.current = setInterval(pollTrader, 5000);
    return () => { if (traderPollRef.current) clearInterval(traderPollRef.current); };
  }, [pollTrader]);

  const traderAction = async (action: string, extra?: Record<string, unknown>) => {
    setTraderLoading(true);
    try {
      const res = await fetch("/api/auto-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        const data = await res.json() as { state: AutoTraderState };
        setTrader(data.state);
      }
    } catch { /* silent */ }
    setTraderLoading(false);
  };

  const sorted = result ? sortSignals(result.signals, sortKey) : [];
  const totalEv = result?.signals.reduce((s, x) => s + x.ev, 0) ?? 0;
  const avgLor  = result?.signals.length ? result.signals.reduce((s, x) => s + x.lor, 0) / result.signals.length : 0;
  const totalAlloc = result?.signals.reduce((s, x) => s + x.recommendedBet, 0) ?? 0;

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="BTC Price-Lag Arbitrage"
        subtitle="Log-normal model vs. Polymarket implied probability — surface mispriced binary markets"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-text-muted text-[10px]">Bankroll $</span>
            <input
              type="number"
              value={bankroll}
              onChange={(e) => setBankroll(parseFloat(e.target.value) || 1000)}
              className="w-20 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-cyan"
            />
            <button
              onClick={runScan}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {loading ? "Scanning…" : "Scan Markets"}
            </button>
          </div>
        }
      />

      {/* BTC Ticker */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Bitcoin className="w-4 h-4 text-accent-orange" />
          <span className="text-text-muted text-[10px] uppercase tracking-wider">BTC/USDT</span>
        </div>
        {liveBtc ? (
          <>
            <span className="text-text-primary text-lg font-mono font-bold">
              ${liveBtc.price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
            <div className={`flex items-center gap-1 text-xs font-mono ${liveBtc.change24h >= 0 ? "text-accent-green" : "text-accent-red"}`}>
              {liveBtc.change24h >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(liveBtc.change24h).toFixed(2)}% 24h
            </div>
            <div className={`flex items-center gap-1 text-xs font-mono ${liveBtc.change1h >= 0 ? "text-accent-green" : "text-accent-red"}`}>
              {liveBtc.change1h >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(liveBtc.change1h).toFixed(2)}% 1h
            </div>
            <span className="ml-auto text-text-muted text-[10px]">Live · updates every 10s</span>
          </>
        ) : (
          <span className="text-text-muted text-xs">Loading BTC price…</span>
        )}
      </div>

      {/* Auto-Trader Panel */}
      <div className="border-b border-border bg-bg-secondary">
        <button
          onClick={() => setTraderOpen((p) => !p)}
          className="w-full px-6 py-2 flex items-center gap-2 hover:bg-bg-tertiary/30 transition-colors"
        >
          <Activity className={`w-3.5 h-3.5 ${trader?.running ? "text-accent-green animate-pulse" : "text-text-muted"}`} />
          <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">Auto-Trader</span>
          {trader?.running && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/30 uppercase">
              {trader.mode} · Running
            </span>
          )}
          {trader && !trader.running && trader.trades.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted uppercase">
              Stopped · {trader.trades.length} trades
            </span>
          )}
          {trader?.running && (
            <span className="text-[10px] text-text-muted ml-auto mr-2">
              Scan #{trader.scanCount} · {trader.trades.filter(t => t.status === "open").length} open
            </span>
          )}
          {traderOpen ? <ChevronUp className="w-3 h-3 text-text-muted ml-auto" /> : <ChevronDown className="w-3 h-3 text-text-muted ml-auto" />}
        </button>

        {traderOpen && (
          <div className="px-6 pb-4 space-y-3">
            {/* Controls row */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Mode toggle */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted uppercase">Mode:</span>
                <button
                  onClick={() => setAtMode("paper")}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${atMode === "paper" ? "bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/30" : "text-text-muted hover:text-text-secondary"}`}
                >Paper</button>
                <button
                  onClick={() => setAtMode("live")}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${atMode === "live" ? "bg-accent-red/20 text-accent-red border border-accent-red/30" : "text-text-muted hover:text-text-secondary"}`}
                >Live</button>
              </div>

              {/* Interval */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted uppercase">Scan:</span>
                <input type="number" value={atInterval} onChange={(e) => setAtInterval(Math.max(30, parseInt(e.target.value) || 60))}
                  className="w-12 bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-text-primary focus:outline-none focus:border-accent-cyan" />
                <span className="text-[10px] text-text-muted">sec</span>
              </div>

              {/* Min LOR */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted uppercase">Min LOR:</span>
                <input type="number" step="0.1" value={atMinLor} onChange={(e) => setAtMinLor(parseFloat(e.target.value) || 1.5)}
                  className="w-12 bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-text-primary focus:outline-none focus:border-accent-cyan" />
              </div>

              {/* Min Edge */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted uppercase">Min Edge:</span>
                <input type="number" step="0.01" value={atMinEdge} onChange={(e) => setAtMinEdge(parseFloat(e.target.value) || 0.08)}
                  className="w-12 bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-text-primary focus:outline-none focus:border-accent-cyan" />
              </div>

              {/* Max Trades */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted uppercase">Max:</span>
                <input type="number" value={atMaxTrades} onChange={(e) => setAtMaxTrades(Math.max(1, parseInt(e.target.value) || 5))}
                  className="w-10 bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-text-primary focus:outline-none focus:border-accent-cyan" />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 ml-auto">
                {!trader?.running ? (
                  <button
                    onClick={() => traderAction("start", {
                      mode: atMode, bankroll, scanIntervalSec: atInterval,
                      minLor: atMinLor, minEdge: atMinEdge, maxConcurrentTrades: atMaxTrades,
                    })}
                    disabled={traderLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs rounded hover:bg-accent-green/20 transition-colors disabled:opacity-40"
                  >
                    <Play className="w-3 h-3" />
                    {atMode === "live" ? "Start Live" : "Start Paper"}
                  </button>
                ) : (
                  <button
                    onClick={() => traderAction("stop")}
                    disabled={traderLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-red/10 border border-accent-red/30 text-accent-red text-xs rounded hover:bg-accent-red/20 transition-colors disabled:opacity-40"
                  >
                    <Square className="w-3 h-3" />
                    Stop
                  </button>
                )}
                <button
                  onClick={() => traderAction("reset")}
                  disabled={traderLoading || trader?.running}
                  className="flex items-center gap-1 px-2 py-1.5 text-text-muted text-[10px] rounded hover:bg-bg-tertiary transition-colors disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
            </div>

            {/* Live mode warning */}
            {atMode === "live" && (
              <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/5 border border-accent-red/20 rounded text-[10px] text-accent-red">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                Live mode places real orders on Polymarket. Requires PRIVATE_KEY in .env.local.
              </div>
            )}

            {/* Trader stats */}
            {trader && (trader.scanCount > 0 || trader.trades.length > 0) && (
              <div className="grid grid-cols-6 gap-3">
                {[
                  { label: "Balance", value: `$${(trader.mode === "paper" ? trader.paperBalance : trader.bankroll).toFixed(0)}`, icon: DollarSign, color: "text-accent-green" },
                  { label: "Scans", value: trader.scanCount, icon: RefreshCw, color: "text-accent-cyan" },
                  { label: "Open", value: trader.trades.filter(t => t.status === "open").length, icon: Activity, color: "text-accent-yellow" },
                  { label: "Total", value: trader.trades.length, icon: BarChart2, color: "text-text-primary" },
                  { label: "P&L", value: `${trader.totalPnl >= 0 ? "+" : ""}$${trader.totalPnl.toFixed(2)}`, icon: TrendingUp, color: trader.totalPnl >= 0 ? "text-accent-green" : "text-accent-red" },
                  { label: "Win Rate", value: `${trader.winRate}%`, icon: Percent, color: "text-accent-cyan" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="flex flex-col">
                    <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5">
                      <Icon className="w-2.5 h-2.5" />{label}
                    </div>
                    <div className={`text-xs font-mono font-semibold ${color}`}>{value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Trade log */}
            {trader && trader.trades.length > 0 && (
              <div className="max-h-48 overflow-y-auto border border-border rounded">
                <div className="px-3 py-1.5 bg-bg-tertiary/50 border-b border-border grid grid-cols-[1fr_2fr_0.5fr_0.5fr_0.5fr_0.5fr_0.7fr] gap-2 text-[9px] text-text-muted uppercase tracking-wider sticky top-0 bg-bg-secondary">
                  <span>Time</span>
                  <span>Market</span>
                  <span>Dir</span>
                  <span>Entry</span>
                  <span>Size</span>
                  <span>LOR</span>
                  <span>Status</span>
                </div>
                {[...trader.trades].reverse().map((trade) => (
                  <TradeRow key={trade.id} trade={trade} onClose={(id, outcome) => traderAction("close_trade", { tradeId: id, outcome })} />
                ))}
              </div>
            )}

            {trader?.error && (
              <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/30 rounded text-[10px] text-accent-red">
                {trader.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats grid */}
      {result && (
        <div className="px-6 py-3 border-b border-border grid grid-cols-6 gap-4 bg-bg-secondary">
          {[
            { label: "Scanned",     value: result.marketsScanned, icon: BarChart2 },
            { label: "BTC Markets", value: result.btcMarketsFound, icon: Bitcoin },
            { label: "Signals",     value: result.signals.length, icon: Zap },
            { label: "Avg LOR",     value: avgLor.toFixed(2), icon: Target },
            { label: "Total EV",    value: `+${(totalEv * 100).toFixed(1)}%`, icon: TrendingUp },
            { label: "Allocation",  value: `$${totalAlloc.toFixed(0)}`, icon: Clock },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex flex-col">
              <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5">
                <Icon className="w-3 h-3" />
                {label}
              </div>
              <div className="text-text-primary text-sm font-mono font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-2 bg-accent-red/10 border border-accent-red/30 rounded text-accent-red text-xs">
          ⚠ {error}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
          <Bitcoin className="w-12 h-12 text-accent-orange/30" />
          <div>
            <div className="text-text-primary text-sm font-semibold mb-1">BTC Price-Lag Arbitrage Scanner</div>
            <div className="text-text-muted text-xs max-w-md">
              Compares live Binance BTC price to Polymarket binary market odds using a log-normal model.
              When Polymarket lags a significant BTC move, the theoretical probability diverges — that gap is your edge.
            </div>
          </div>
          <button
            onClick={runScan}
            className="flex items-center gap-2 px-4 py-2 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-sm rounded hover:bg-accent-cyan/20 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Run First Scan
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <RefreshCw className="w-8 h-8 text-accent-cyan animate-spin" />
          <div className="text-text-secondary text-sm">Fetching BTC price &amp; scanning Polymarket markets…</div>
          <div className="text-text-muted text-xs">This may take a few seconds</div>
        </div>
      )}

      {/* Signals table */}
      {result && result.signals.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <Target className="w-8 h-8 text-text-muted" />
          <div className="text-text-secondary text-sm">No signals above 5% edge threshold</div>
          <div className="text-text-muted text-xs">
            Scanned {result.marketsScanned} markets, found {result.btcMarketsFound} BTC price markets
          </div>
        </div>
      )}

      {result && result.signals.length > 0 && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Sort bar */}
          <div className="px-6 py-2 border-b border-border flex items-center gap-2">
            <span className="text-text-muted text-[10px] uppercase tracking-wider mr-2">Sort:</span>
            {(["lor", "edge", "ev", "lag", "expiry"] as SortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider transition-colors ${
                  sortKey === k
                    ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {k === "lor" ? "LOR" : k === "ev" ? "EV" : k === "lag" ? "Lag %" : k === "expiry" ? "Expiry" : "Edge"}
              </button>
            ))}
            <span className="ml-auto text-text-muted text-[10px]">
              {result.signals.length} signal{result.signals.length !== 1 ? "s" : ""} ·{" "}
              {new Date(result.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {/* Table header */}
          <div className="px-6 py-2 border-b border-border grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_1fr_1fr_1fr] gap-3 text-[10px] text-text-muted uppercase tracking-wider">
            <span>Market</span>
            <span>Strike</span>
            <span>Market P</span>
            <span>Model P</span>
            <span>LOR / Stars</span>
            <span>Direction</span>
            <span>EV</span>
            <span>Bet</span>
          </div>

          {/* Signals */}
          <div className="flex-1 overflow-y-auto">
            {sorted.map((signal) => (
              <SignalRow key={signal.marketId} signal={signal} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Signal row component ───────────────────────────────────────────────────────

function StrikeDisplay({ signal }: { signal: BtcSignal }) {
  const formatK = (n: number) => n >= 10000 ? `$${(n / 1000).toFixed(0)}k` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const label = signal.strikeType === "range"
    ? `${formatK(signal.strikeLow!)} – ${formatK(signal.strikeHigh!)}`
    : formatK(signal.strikePrice);
  const typeLabel = signal.strikeType === "above" ? "↑ above" : signal.strikeType === "below" ? "↓ below" : "↔ range";
  const dist = signal.distancePct;
  const inFavor = (signal.strikeType === "above" && dist > 0) || (signal.strikeType === "below" && dist < 0);
  const distColor = inFavor ? "text-accent-green" : "text-accent-red";
  return (
    <div>
      <div className="text-xs font-mono font-semibold">{label}</div>
      <div className="text-[10px] text-text-muted">{typeLabel}</div>
      <div className={`text-[10px] font-mono ${distColor}`}>
        {dist > 0 ? "+" : ""}{dist.toFixed(1)}% from live
      </div>
    </div>
  );
}

function TradeRow({ trade, onClose }: { trade: TradeRecord; onClose: (id: string, outcome: "won" | "lost") => void }) {
  const time = new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isYes = trade.direction === "BUY_YES";
  return (
    <div className="px-3 py-1.5 border-b border-border grid grid-cols-[1fr_2fr_0.5fr_0.5fr_0.5fr_0.5fr_0.7fr] gap-2 items-center text-[10px] hover:bg-bg-tertiary/30">
      <span className="text-text-muted font-mono">{time}</span>
      <span className="text-text-primary truncate">{trade.marketQuestion}</span>
      <span className={isYes ? "text-accent-green font-bold" : "text-accent-red font-bold"}>
        {isYes ? "YES" : "NO"}
      </span>
      <span className="text-text-primary font-mono">{(trade.entryPrice * 100).toFixed(0)}¢</span>
      <span className="text-text-primary font-mono">${trade.size.toFixed(0)}</span>
      <span className="text-accent-cyan font-mono">{trade.lor.toFixed(1)}</span>
      <div className="flex items-center gap-1">
        {trade.status === "open" && trade.mode === "paper" ? (
          <div className="flex gap-1">
            <button onClick={() => onClose(trade.id, "won")} className="p-0.5 rounded hover:bg-accent-green/20" title="Mark won">
              <CheckCircle className="w-3 h-3 text-accent-green" />
            </button>
            <button onClick={() => onClose(trade.id, "lost")} className="p-0.5 rounded hover:bg-accent-red/20" title="Mark lost">
              <XCircle className="w-3 h-3 text-accent-red" />
            </button>
          </div>
        ) : (
          <span className={`uppercase font-bold ${
            trade.status === "won" ? "text-accent-green" :
            trade.status === "lost" ? "text-accent-red" :
            trade.status === "open" ? "text-accent-yellow" : "text-text-muted"
          }`}>
            {trade.status}
            {trade.pnl !== undefined && ` ${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(0)}`}
          </span>
        )}
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: BtcSignal }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        onClick={() => setExpanded((p) => !p)}
        className="px-6 py-3 border-b border-border grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_1fr_1fr_1fr] gap-3 items-center hover:bg-bg-tertiary/40 cursor-pointer transition-colors"
      >
        {/* Market question */}
        <div className="min-w-0">
          <div className="text-text-primary text-xs font-medium truncate">{signal.marketQuestion}</div>
          <div className="text-text-muted text-[10px] flex items-center gap-2 mt-0.5">
            <Clock className="w-2.5 h-2.5" />
            {signal.daysToExpiry}d · {signal.expiryDate}
          </div>
        </div>

        {/* Strike */}
        <StrikeDisplay signal={signal} />

        {/* Market price */}
        <div>
          <div className="text-xs font-mono font-semibold text-text-primary">
            {(signal.marketPrice * 100).toFixed(1)}¢
          </div>
          <div className="text-[10px] text-text-muted">market</div>
        </div>

        {/* Theoretical prob */}
        <div>
          <div className="text-xs font-mono font-semibold text-accent-cyan">
            {(signal.theoreticalProb * 100).toFixed(1)}¢
          </div>
          <div className="text-[10px] text-text-muted">model</div>
        </div>

        {/* LOR + stars */}
        <div className="flex flex-col gap-1.5">
          <LorBar lor={signal.lor} />
          <SignificanceStars sig={signal.significance} lor={signal.lor} />
        </div>

        {/* Direction */}
        <DirectionBadge direction={signal.direction} />

        {/* EV */}
        <div className={`text-xs font-mono font-semibold ${signal.ev >= 0 ? "text-accent-green" : "text-accent-red"}`}>
          {signal.ev >= 0 ? "+" : ""}{(signal.ev * 100).toFixed(1)}%
        </div>

        {/* Bet */}
        <div>
          <div className="text-xs font-mono font-semibold text-text-primary">
            ${signal.recommendedBet.toFixed(2)}
          </div>
          <div className="text-[10px] text-text-muted">
            {(signal.kellyFraction * 100).toFixed(1)}% Kelly
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-6 py-3 bg-bg-tertiary/20 border-b border-border">
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Edge</div>
              <div className="font-mono text-accent-yellow">{(signal.edge * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Lag</div>
              <div className="font-mono text-text-primary">{signal.lagPct > 0 ? "+" : ""}{signal.lagPct.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Live BTC</div>
              <div className="font-mono text-text-primary">${signal.liveBtcPrice.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Market ID</div>
              <div className="font-mono text-text-muted truncate">{signal.marketId}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
