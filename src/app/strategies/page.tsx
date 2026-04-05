"use client";

import Header from "@/components/layout/Header";
import {
  Zap, RefreshCw, Activity, TrendingUp, BarChart2,
  Clock, Target, GitBranch, ArrowUp, ArrowDown,
  CheckCircle, AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface ExpirySignal {
  marketId: string; marketQuestion: string; marketPrice: number;
  estimatedTrueProb: number; edge: number; direction: "BUY_YES" | "BUY_NO";
  ev: number; confidence: number; category: string; reason: string;
  daysToExpiry: number; expiryDate: string; annualizedReturn: number;
}

interface CorrelationSignal {
  eventId: string; eventTitle: string; sumYesPrices: number;
  deviation: number; deviationPct: number; type: "OVERPRICED" | "UNDERPRICED";
  profitPotential: number; marketCount: number; daysToExpiry: number;
}

interface BtcArbResult {
  liveBtcPrice: number; signals: { marketQuestion: string; lor: number; edge: number; direction: string; recommendedBet: number }[];
  marketsScanned: number; btcMarketsFound: number;
}

interface AutoTraderState {
  running: boolean; mode: string; scanCount: number; trades: { status: string; pnl?: number }[];
  totalPnl: number; winRate: number; bankroll: number;
}

interface SpreadOpp {
  marketId: string; marketQuestion: string; spread: number; spreadPct: number;
  midPrice: number; bestBid: number; bestAsk: number; expectedProfit: number; volume24h: number;
}

interface CopyState {
  running: boolean; scanCount: number; wallets: { address: string; label: string }[];
  recentActivity: { walletLabel: string; marketQuestion: string; outcome: string; size: number; price: number }[];
  signals: { shouldCopy: boolean; activity: { walletLabel: string; marketQuestion: string; size: number; outcome: string } }[];
}

export default function StrategiesPage() {
  const [expiry, setExpiry] = useState<{ signals: ExpirySignal[]; marketsScanned: number; nearExpiryCount: number } | null>(null);
  const [correlation, setCorrelation] = useState<{ signals: CorrelationSignal[]; eventsScanned: number; multiOutcomeEvents: number } | null>(null);
  const [btcArb, setBtcArb] = useState<BtcArbResult | null>(null);
  const [autoTrader, setAutoTrader] = useState<AutoTraderState | null>(null);
  const [spreads, setSpreads] = useState<{ opportunities: SpreadOpp[]; marketsScanned: number; wideSpreadCount: number; avgSpread: number } | null>(null);
  const [copyState, setCopyState] = useState<CopyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const scanAll = useCallback(async () => {
    setLoading(true);
    const [exRes, corRes, btcRes, atRes, spRes, cpRes] = await Promise.all([
      fetch("/api/expiry-convergence?bankroll=562").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/correlation-arb").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/btc-arb?bankroll=562").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/auto-trade").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/spread-capture").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/copy-trade").then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (exRes) setExpiry(exRes);
    if (corRes) setCorrelation(corRes);
    if (btcRes) setBtcArb(btcRes);
    if (atRes) setAutoTrader(atRes);
    if (spRes) setSpreads(spRes);
    if (cpRes) setCopyState(cpRes);
    setLoading(false);
  }, []);

  // Auto-poll every 30s
  useEffect(() => {
    scanAll();
    const timer = setInterval(scanAll, 30000);
    return () => clearInterval(timer);
  }, [scanAll]);

  if (!mounted) return null;

  const totalSignals = (expiry?.signals.length || 0) + (correlation?.signals.length || 0) + (btcArb?.signals.length || 0) + (spreads?.wideSpreadCount || 0) + (copyState?.signals.filter(s => s.shouldCopy).length || 0);
  const bestExpiry = expiry?.signals[0];
  const bestCorr = correlation?.signals[0];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Strategy Dashboard"
        subtitle="All automated strategies — scan, analyze, execute"
        actions={
          <button onClick={scanAll} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors disabled:opacity-40">
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {loading ? "Scanning…" : "Scan All"}
          </button>
        }
      />

      {/* Auto-Trader Status Bar */}
      {autoTrader && (
        <div className={`px-6 py-2 border-b border-border flex items-center gap-4 ${autoTrader.running ? "bg-accent-green/5" : "bg-bg-secondary"}`}>
          <div className="flex items-center gap-2">
            <Activity className={`w-3.5 h-3.5 ${autoTrader.running ? "text-accent-green animate-pulse" : "text-text-muted"}`} />
            <span className="text-xs font-semibold text-text-primary uppercase">Auto-Trader</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase ${autoTrader.running ? "bg-accent-green/10 text-accent-green border-accent-green/30" : "bg-bg-tertiary text-text-muted border-border"}`}>
              {autoTrader.running ? `${autoTrader.mode} · Running` : "Stopped"}
            </span>
          </div>
          <span className="text-[10px] text-text-muted">Scans: {autoTrader.scanCount}</span>
          <span className="text-[10px] text-text-muted">Trades: {autoTrader.trades.length}</span>
          <span className={`text-[10px] font-mono ${autoTrader.totalPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
            P&L: {autoTrader.totalPnl >= 0 ? "+" : ""}${autoTrader.totalPnl.toFixed(2)}
          </span>
          <span className="text-[10px] text-text-muted">Win: {autoTrader.winRate}%</span>
        </div>
      )}

      {/* Overview Stats */}
      <div className="px-6 py-3 border-b border-border grid grid-cols-5 gap-4 bg-bg-secondary">
        {[
          { label: "Total Signals", value: totalSignals, icon: Zap, color: "text-accent-yellow" },
          { label: "Expiry Opps", value: expiry?.signals.length || 0, icon: Clock, color: "text-accent-cyan" },
          { label: "Corr Arbs", value: correlation?.signals.length || 0, icon: GitBranch, color: "text-accent-green" },
          { label: "BTC Signals", value: btcArb?.signals.length || 0, icon: Target, color: "text-accent-orange" },
          { label: "Markets", value: expiry?.marketsScanned || btcArb?.marketsScanned || 0, icon: BarChart2, color: "text-text-primary" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex flex-col">
            <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5">
              <Icon className="w-2.5 h-2.5" />{label}
            </div>
            <div className={`text-sm font-mono font-semibold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Correlation Arb Section */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-bg-tertiary/50 border-b border-border flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-accent-green" />
            <span className="text-sm font-semibold text-text-primary">Correlation Arbitrage</span>
            <span className="text-[10px] text-text-muted">Multi-outcome events with price deviations from 1.0</span>
            <span className="ml-auto text-[10px] text-accent-green font-mono">{correlation?.signals.length || 0} opportunities</span>
          </div>
          {correlation && correlation.signals.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              <div className="px-4 py-1.5 grid grid-cols-[2fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr] gap-2 text-[9px] text-text-muted uppercase tracking-wider border-b border-border">
                <span>Event</span><span>Markets</span><span>Sum YES</span><span>Dev %</span><span>Type</span><span>Profit</span>
              </div>
              {correlation.signals.slice(0, 15).map((s) => (
                <div key={s.eventId} className="px-4 py-2 grid grid-cols-[2fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr] gap-2 items-center border-b border-border hover:bg-bg-tertiary/30 text-xs">
                  <span className="text-text-primary truncate">{s.eventTitle}</span>
                  <span className="text-text-muted font-mono">{s.marketCount}</span>
                  <span className="text-text-primary font-mono">{s.sumYesPrices.toFixed(3)}</span>
                  <span className="text-accent-yellow font-mono">{s.deviationPct.toFixed(1)}%</span>
                  <span className={`text-[10px] font-bold ${s.type === "OVERPRICED" ? "text-accent-red" : "text-accent-green"}`}>
                    {s.type === "OVERPRICED" ? <ArrowDown className="w-3 h-3 inline" /> : <ArrowUp className="w-3 h-3 inline" />}
                    {s.type === "OVERPRICED" ? "OVER" : "UNDER"}
                  </span>
                  <span className="text-accent-green font-mono">${s.profitPotential.toFixed(0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              {loading ? "Scanning…" : "No correlation arb opportunities found"}
            </div>
          )}
        </div>

        {/* Expiry Convergence Section */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-bg-tertiary/50 border-b border-border flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent-cyan" />
            <span className="text-sm font-semibold text-text-primary">Expiry Convergence</span>
            <span className="text-[10px] text-text-muted">Near-expiry markets with deterministic outcomes</span>
            <span className="ml-auto text-[10px] text-accent-cyan font-mono">{expiry?.signals.length || 0} opportunities</span>
          </div>
          {expiry && expiry.signals.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              <div className="px-4 py-1.5 grid grid-cols-[2fr_0.5fr_0.5fr_0.5fr_0.5fr_1fr] gap-2 text-[9px] text-text-muted uppercase tracking-wider border-b border-border">
                <span>Market</span><span>Mkt P</span><span>True P</span><span>Edge</span><span>Dir</span><span>Reason</span>
              </div>
              {expiry.signals.slice(0, 10).map((s) => (
                <div key={s.marketId} className="px-4 py-2 grid grid-cols-[2fr_0.5fr_0.5fr_0.5fr_0.5fr_1fr] gap-2 items-center border-b border-border hover:bg-bg-tertiary/30 text-xs">
                  <div className="min-w-0">
                    <div className="text-text-primary truncate">{s.marketQuestion}</div>
                    <div className="text-[10px] text-text-muted">{s.daysToExpiry}d · {s.category}</div>
                  </div>
                  <span className="text-text-primary font-mono">{(s.marketPrice * 100).toFixed(0)}¢</span>
                  <span className="text-accent-cyan font-mono">{(s.estimatedTrueProb * 100).toFixed(0)}¢</span>
                  <span className="text-accent-yellow font-mono">{(s.edge * 100).toFixed(1)}%</span>
                  <span className={`text-[10px] font-bold ${s.direction === "BUY_YES" ? "text-accent-green" : "text-accent-red"}`}>
                    {s.direction === "BUY_YES" ? "YES" : "NO"}
                  </span>
                  <span className="text-[10px] text-text-muted truncate">{s.reason}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              {loading ? "Scanning…" : (
                <div className="flex flex-col items-center gap-1">
                  <CheckCircle className="w-4 h-4 text-accent-green" />
                  <span>Markets are correctly priced near expiry — no convergence plays right now</span>
                  <span className="text-[10px]">{expiry?.nearExpiryCount || 0} near-expiry markets checked</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* BTC Arb Section */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-bg-tertiary/50 border-b border-border flex items-center gap-2">
            <Target className="w-4 h-4 text-accent-orange" />
            <span className="text-sm font-semibold text-text-primary">BTC Price-Lag Arb</span>
            <span className="text-[10px] text-text-muted">Log-normal model vs Polymarket implied probability</span>
            {btcArb?.liveBtcPrice && (
              <span className="ml-auto text-[10px] text-accent-orange font-mono">
                BTC ${btcArb.liveBtcPrice.toLocaleString()} · {btcArb.signals.length} signals
              </span>
            )}
          </div>
          {btcArb && btcArb.signals.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              {btcArb.signals.slice(0, 5).map((s, i) => (
                <div key={i} className="px-4 py-2 border-b border-border flex items-center gap-4 hover:bg-bg-tertiary/30 text-xs">
                  <span className="text-text-primary flex-1 truncate">{s.marketQuestion}</span>
                  <span className="text-accent-yellow font-mono">LOR: {s.lor?.toFixed(2) || "—"}</span>
                  <span className="text-accent-cyan font-mono">Edge: {s.edge ? (s.edge * 100).toFixed(1) + "%" : "—"}</span>
                  <span className={`text-[10px] font-bold ${s.direction === "BUY_YES" ? "text-accent-green" : "text-accent-red"}`}>
                    {s.direction === "BUY_YES" ? "YES" : "NO"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              {btcArb ? `${btcArb.btcMarketsFound} BTC markets — no signals above threshold` : "Loading…"}
            </div>
          )}
        </div>

        {/* Spread Capture Section */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-bg-tertiary/50 border-b border-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent-yellow" />
            <span className="text-sm font-semibold text-text-primary">Spread Capture</span>
            <span className="text-[10px] text-text-muted">Wide bid-ask spreads for market making</span>
            <span className="ml-auto text-[10px] text-accent-yellow font-mono">
              {spreads?.wideSpreadCount || 0} wide spreads · avg {spreads?.avgSpread || 0}%
            </span>
          </div>
          {spreads && spreads.opportunities.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              <div className="px-4 py-1.5 grid grid-cols-[2fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr] gap-2 text-[9px] text-text-muted uppercase tracking-wider border-b border-border">
                <span>Market</span><span>Bid</span><span>Ask</span><span>Spread</span><span>Mid</span><span>Profit/$100</span>
              </div>
              {spreads.opportunities.slice(0, 10).map((s) => (
                <div key={s.marketId} className="px-4 py-2 grid grid-cols-[2fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr] gap-2 items-center border-b border-border hover:bg-bg-tertiary/30 text-xs">
                  <span className="text-text-primary truncate">{s.marketQuestion}</span>
                  <span className="text-accent-green font-mono">{(s.bestBid * 100).toFixed(1)}¢</span>
                  <span className="text-accent-red font-mono">{(s.bestAsk * 100).toFixed(1)}¢</span>
                  <span className="text-accent-yellow font-mono">{s.spreadPct.toFixed(1)}%</span>
                  <span className="text-text-primary font-mono">{(s.midPrice * 100).toFixed(1)}¢</span>
                  <span className="text-accent-green font-mono">${s.expectedProfit.toFixed(0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              {loading ? "Scanning orderbooks…" : `${spreads?.marketsScanned || 0} orderbooks checked`}
            </div>
          )}
        </div>

        {/* Copy Trading Section */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-bg-tertiary/50 border-b border-border flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent-cyan" />
            <span className="text-sm font-semibold text-text-primary">Whale Copy Trading</span>
            <span className="text-[10px] text-text-muted">Mirror profitable wallets</span>
            <span className="ml-auto text-[10px] text-accent-cyan font-mono">
              {copyState?.wallets.length || 0} wallets · {copyState?.signals.filter(s => s.shouldCopy).length || 0} signals
            </span>
          </div>
          {copyState && copyState.recentActivity.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              <div className="px-4 py-1.5 grid grid-cols-[0.5fr_2fr_0.5fr_0.5fr] gap-2 text-[9px] text-text-muted uppercase tracking-wider border-b border-border">
                <span>Whale</span><span>Market</span><span>Side</span><span>Size</span>
              </div>
              {copyState.recentActivity.slice(0, 10).map((a, i) => (
                <div key={i} className="px-4 py-2 grid grid-cols-[0.5fr_2fr_0.5fr_0.5fr] gap-2 items-center border-b border-border hover:bg-bg-tertiary/30 text-xs">
                  <span className="text-accent-cyan font-semibold truncate">{a.walletLabel}</span>
                  <span className="text-text-primary truncate">{a.marketQuestion}</span>
                  <span className={`font-bold ${a.outcome === "YES" ? "text-accent-green" : "text-accent-red"}`}>{a.outcome}</span>
                  <span className="text-text-primary font-mono">${a.size.toFixed(0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              {loading ? "Scanning whale wallets…" : `Monitoring ${copyState?.wallets.length || 0} wallets`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
