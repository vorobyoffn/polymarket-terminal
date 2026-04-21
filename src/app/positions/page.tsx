"use client";

import Header from "@/components/layout/Header";
import {
  BarChart3, RefreshCw, DollarSign, Clock, Target, Activity,
  Layers, AlertTriangle, CheckCircle, XCircle, TrendingUp,
  TrendingDown, ChevronUp, ChevronDown, Search, ExternalLink,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { formatDistanceToNowStrict, format, differenceInHours } from "date-fns";
import { useAccount } from "wagmi";
import { useRedeem } from "@/lib/web3/useRedeem";

// ── Types ────────────────────────────────────────────────────────────────────

interface LivePosition {
  tokenId: string;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  negativeRisk: boolean;
  conditionId: string;
  redeemable: boolean;
}

interface OpenOrder {
  id: string;
  side: string;
  price: number;
  originalSize: number;
  sizeMatched: number;
  sizeRemaining: number;
  tokenId: string;
  status: string;
  createdAt: string;
  type: string;
}

interface TradeHistoryItem {
  id: string;
  side: string;
  size: number;
  price: number;
  tokenId: string;
  marketName: string;
  outcome: string;
  status: string;
  matchTime: string;
}

interface LiveStats {
  totalPositions: number;
  totalInitial: number;
  totalCurrent: number;
  totalPnl: number;
  totalPnlPct: number;
  totalRealized: number;
  winners: number;
  losers: number;
  openOrderCount: number;
  totalTradeCount: number;
}

interface LiveData {
  positions: LivePosition[];
  openOrders: OpenOrder[];
  tradeHistory: TradeHistoryItem[];
  stats: LiveStats;
}

interface PaperTrade {
  id: string;
  timestamp: string;
  marketId: string;
  marketQuestion: string;
  direction: "BUY_YES" | "BUY_NO";
  tokenId: string;
  entryPrice: number;
  size: number;
  shares: number;
  theoreticalProb: number;
  edge: number;
  lor: number;
  status: "open" | "won" | "lost" | "pending";
  mode: string;
  orderId?: string;
  pnl?: number;
}

interface AutoTraderState {
  running: boolean;
  mode: string;
  scanCount: number;
  trades: PaperTrade[];
  totalPnl: number;
  winRate: number;
  paperBalance: number;
  bankroll: number;
}

type TabKey = "live" | "orders" | "history" | "paper";
type SortKey = "pnl" | "value" | "size" | "price" | "name";
type SortDir = "asc" | "desc";

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: string): string {
  if (!ts) return "—";
  const d = ts.includes("T") ? new Date(ts) : new Date(parseInt(ts) * 1000);
  if (isNaN(d.getTime())) return "—";
  return differenceInHours(new Date(), d) < 24
    ? formatDistanceToNowStrict(d, { addSuffix: false })
    : format(d, "MMM d");
}

function daysUntil(endDate: string): number {
  const d = new Date(endDate);
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
}

function pnlColor(pnl: number): string {
  return pnl > 0 ? "text-accent-green" : pnl < 0 ? "text-accent-red" : "text-text-muted";
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PositionsPage() {
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [paperState, setPaperState] = useState<AutoTraderState | null>(null);
  const [walletUsdc, setWalletUsdc] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("live");
  const [mounted, setMounted] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("pnl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<{ running: boolean; done: number; total: number; log: string[] }>({ running: false, done: 0, total: 0, log: [] });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    setTimeout(() => {
      fetch("/api/live-positions").then(r => r.ok ? r.json() : null).then(d => { if (d) setLiveData(d as LiveData); });
      fetch("/api/auto-trade").then(r => r.ok ? r.json() : null).then(d => { if (d) setPaperState(d as AutoTraderState); });
      fetch("/api/wallet-balance").then(r => r.ok ? r.json() : null).then((d: { totalUsdc?: number } | null) => { if (d && typeof d.totalUsdc === "number") setWalletUsdc(d.totalUsdc); });
    }, 300);
  }, []);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [liveRes, traderRes, walletRes] = await Promise.all([
        fetch("/api/live-positions"),
        fetch("/api/auto-trade"),
        fetch("/api/wallet-balance"),
      ]);
      if (liveRes.ok) setLiveData(await liveRes.json() as LiveData);
      if (traderRes.ok) setPaperState(await traderRes.json() as AutoTraderState);
      if (walletRes.ok) {
        const w = await walletRes.json() as { totalUsdc?: number };
        if (typeof w.totalUsdc === "number") setWalletUsdc(w.totalUsdc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    refresh(true);
    const id = setInterval(() => refresh(false), 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const closeAllNonWeather = useCallback(async () => {
    // Must confirm with full list first — user authorizes the batch
    const positions = liveData?.positions || [];
    const nonWeather = positions.filter(p =>
      !p.title.toLowerCase().includes("temperature") &&
      p.curPrice > 0.01 && p.curPrice < 0.99
    );
    if (nonWeather.length === 0) {
      alert("No non-weather open positions to close.");
      return;
    }
    const totalValue = nonWeather.reduce((s, p) => s + p.currentValue, 0);
    const list = nonWeather.map(p => `• ${p.outcome} @ ${(p.curPrice * 100).toFixed(1)}¢ — $${p.currentValue.toFixed(2)} — ${p.title.slice(0, 55)}`).join("\n");
    const confirmText = `Sell ALL non-weather positions at best bid?\n\nPositions: ${nonWeather.length}\nTotal value: ~$${totalValue.toFixed(2)}\n\n${list}\n\nThis will place ${nonWeather.length} SELL orders on CLOB, one per position.`;
    if (!window.confirm(confirmText)) return;

    setBulkStatus({ running: true, done: 0, total: nonWeather.length, log: [] });
    let done = 0;
    const log: string[] = [];
    for (const p of nonWeather) {
      try {
        const res = await fetch("/api/close-position", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenId: p.tokenId,
            conditionId: p.conditionId,
            outcomeIndex: p.outcomeIndex,
            size: p.size,
            title: p.title,
            negRisk: p.negativeRisk,
            currentPrice: p.curPrice,
            entryPrice: p.avgPrice,
            // No limitPrice → defaults to best bid (market sell, fast fill)
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          log.push(`✓ ${p.title.slice(0, 40)} — sold at ${((body.price ?? 0) * 100).toFixed(1)}¢`);
        } else {
          log.push(`✗ ${p.title.slice(0, 40)} — ${body.detail || body.error || "failed"}`);
        }
      } catch (e) {
        log.push(`✗ ${p.title.slice(0, 40)} — ${e instanceof Error ? e.message : "error"}`);
      }
      done++;
      setBulkStatus({ running: true, done, total: nonWeather.length, log: [...log] });
    }
    setBulkStatus({ running: false, done, total: nonWeather.length, log });
    refresh(true);
  }, [liveData, refresh]);

  const closeTrade = useCallback(async (tradeId: string, outcome: "won" | "lost") => {
    await fetch("/api/auto-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close_trade", tradeId, outcome }),
    });
    refresh(false);
  }, [refresh]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") {
        if (e.key === "Escape") { (target as HTMLInputElement).blur(); setSearchQuery(""); }
        return;
      }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "1") setTab("live");
      if (e.key === "2") setTab("orders");
      if (e.key === "3") setTab("history"); // closed trades
      if (e.key === "4") setTab("paper");
      if (e.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (!mounted) return null;

  const stats = liveData?.stats;
  const positions = liveData?.positions || [];
  const filtered = positions.filter(p =>
    !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "pnl": cmp = a.cashPnl - b.cashPnl; break;
      case "value": cmp = a.currentValue - b.currentValue; break;
      case "size": cmp = a.size - b.size; break;
      case "price": cmp = a.curPrice - b.curPrice; break;
      case "name": cmp = a.title.localeCompare(b.title); break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const paperTrades = paperState?.trades || [];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Portfolio"
        subtitle="Live positions with real-time P&L from Polymarket"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={closeAllNonWeather} disabled={bulkStatus.running || loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-red/10 border border-accent-red/30 text-accent-red text-xs rounded hover:bg-accent-red/20 transition-colors disabled:opacity-40"
              title="Place SELL orders for all non-weather positions at best bid"
            >
              <XCircle className="w-3 h-3" />
              {bulkStatus.running ? `Selling ${bulkStatus.done}/${bulkStatus.total}` : "Close Non-Weather"}
            </button>
            <button onClick={() => refresh(true)} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors disabled:opacity-40"
            >
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
          </div>
        }
      />

      {/* Bulk sell log */}
      {(bulkStatus.running || bulkStatus.log.length > 0) && (
        <div className="px-6 py-2 border-b border-border bg-bg-tertiary/30">
          <div className="text-[10px] text-text-muted uppercase mb-1">
            Bulk close: {bulkStatus.done} of {bulkStatus.total} {bulkStatus.running ? "(in progress...)" : "(done)"}
            {!bulkStatus.running && bulkStatus.log.length > 0 && (
              <button onClick={() => setBulkStatus({ running: false, done: 0, total: 0, log: [] })}
                className="ml-2 text-text-muted hover:text-text-primary">× clear</button>
            )}
          </div>
          <div className="space-y-0.5 max-h-24 overflow-y-auto">
            {bulkStatus.log.map((line, i) => (
              <div key={i} className={`text-[10px] font-mono ${line.startsWith("✓") ? "text-accent-green" : "text-accent-red"}`}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── P&L Summary Banner ── */}
      {stats && (
        <div className="px-6 py-4 border-b border-border bg-bg-secondary">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <div className="col-span-2">
              <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Total Portfolio</div>
              <div className="text-2xl font-mono font-bold text-text-primary tnum">${(walletUsdc + stats.totalCurrent).toFixed(2)}</div>
              <div className={`text-xs font-mono tnum ${pnlColor(stats.totalPnl)}`}>
                {stats.totalPnl >= 0 ? "+" : ""}{stats.totalPnl.toFixed(2)} ({stats.totalPnlPct >= 0 ? "+" : ""}{stats.totalPnlPct.toFixed(1)}%) unrealized
              </div>
            </div>
            <Stat icon={DollarSign} label="Cash (USDC)" value={`$${walletUsdc.toFixed(2)}`} color="text-accent-green" />
            <Stat icon={Layers} label="Positions Value" value={`$${stats.totalCurrent.toFixed(2)}`} color="text-text-primary" />
            <Stat icon={DollarSign} label="Cost Basis" value={`$${stats.totalInitial.toFixed(2)}`} color="text-text-muted" />
            <Stat icon={TrendingUp} label="Winners" value={stats.winners} color="text-accent-green" />
            <Stat icon={TrendingDown} label="Losers" value={stats.losers} color="text-accent-red" />
            <Stat icon={Activity} label="# Positions" value={stats.totalPositions} color="text-accent-cyan" />
          </div>
        </div>
      )}

      {/* ── Tabs + Search ── */}
      <div className="px-4 md:px-6 py-2 border-b border-border flex items-center gap-2 overflow-x-auto">
        {([
          { key: "live" as TabKey, label: "Positions", count: positions.length, icon: Layers },
          { key: "orders" as TabKey, label: "Open Orders", count: liveData?.openOrders?.length || 0, icon: Clock },
          { key: "history" as TabKey, label: "Closed Trades", count: liveData?.tradeHistory?.filter((t: TradeHistoryItem) => t.status === "CONFIRMED").length || 0, icon: CheckCircle },
          { key: "paper" as TabKey, label: "Paper Lab", count: paperTrades.length, icon: BarChart3 },
        ]).map(({ key, label, count, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded uppercase tracking-wider font-semibold transition-colors ${
              tab === key ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30" : "text-text-muted hover:text-text-secondary border border-transparent"
            }`}
          >
            <Icon className="w-3 h-3" />
            {label} ({count})
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1.5 bg-bg-tertiary border border-border rounded px-2 py-1">
          <Search className="w-3 h-3 text-text-muted" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search… ( / )"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none w-40"
          />
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 px-4 py-2 bg-accent-red/10 border border-accent-red/30 rounded text-accent-red text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />{error}
        </div>
      )}

      {loading && !liveData && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-accent-cyan animate-spin" />
          <div className="text-text-secondary text-sm">Loading positions...</div>
        </div>
      )}

      {/* ════════════════ LIVE POSITIONS ════════════════ */}
      <div className="flex-1 overflow-y-auto relative">
        {tab === "live" && (
          sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <Layers className="w-10 h-10 text-text-muted/30" />
              <div className="text-text-muted text-sm">{searchQuery ? "No positions match" : "No open positions"}</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <>
              {/* Header */}
              <div className="grid grid-cols-[minmax(0,3fr)_64px_64px_64px_56px_72px_72px_56px] gap-2 px-4 py-2 border-b border-border sticky top-0 z-10 bg-bg-secondary text-[10px] text-text-muted uppercase tracking-wider min-w-[700px]">
                <SortBtn label="Market" k="name" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <span className="text-center">Outcome</span>
                <SortBtn label="Odds" k="price" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                <span className="text-right">Bought At</span>
                <SortBtn label="Shares" k="size" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                <SortBtn label="Value" k="value" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                <SortBtn label="P&L" k="pnl" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                <span className="text-right">Expires</span>
              </div>

              {/* Rows */}
              {sorted.map((pos, idx) => (
                <PositionRow
                  key={pos.tokenId}
                  pos={pos}
                  isExpanded={expandedId === pos.tokenId}
                  isOdd={idx % 2 === 1}
                  onToggle={() => setExpandedId(prev => prev === pos.tokenId ? null : pos.tokenId)}
                  onRefresh={() => refresh(false)}
                />
              ))}

              {/* Totals */}
              <div className="grid grid-cols-[minmax(0,3fr)_64px_64px_64px_56px_72px_72px_56px] gap-2 px-4 py-2 border-t border-border sticky bottom-0 bg-bg-secondary z-10 text-xs font-mono font-bold min-w-[700px]">
                <span className="text-text-muted text-[10px] uppercase">Total ({sorted.length})</span>
                <span />
                <span />
                <span />
                <span />
                <span className="text-right text-text-primary tnum">${(stats?.totalCurrent || 0).toFixed(2)}</span>
                <span className={`text-right tnum ${pnlColor(stats?.totalPnl || 0)}`}>
                  {(stats?.totalPnl || 0) >= 0 ? "+" : ""}${(stats?.totalPnl || 0).toFixed(2)}
                </span>
                <span />
              </div>
            </>
            </div>
          )
        )}

        {/* ════════════════ OPEN ORDERS ════════════════ */}
        {tab === "orders" && (
          (liveData?.openOrders || []).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <Clock className="w-10 h-10 text-text-muted/30" />
              <div className="text-text-muted text-sm">No open orders</div>
              <div className="text-text-muted text-[10px]">Orders placed by the bot will appear here until filled or cancelled</div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_64px_72px_72px_72px_64px_80px] gap-2 px-4 py-2 border-b border-border sticky top-0 z-10 bg-bg-secondary text-[10px] text-text-muted uppercase tracking-wider">
                <span>Token</span><span>Side</span><span>Price</span><span>Size</span><span>Filled</span><span>Type</span><span>Status</span>
              </div>
              {(liveData?.openOrders || []).map((order, i) => (
                <div key={order.id || i} className={`grid grid-cols-[minmax(0,1fr)_64px_72px_72px_72px_64px_80px] gap-2 px-4 py-2 border-b border-border items-center text-xs ${i % 2 === 1 ? "bg-bg-tertiary/10" : ""}`}>
                  <span className="text-text-primary font-mono text-[10px] truncate">{order.tokenId}...</span>
                  <span className={`font-bold ${order.side === "BUY" ? "text-accent-green" : "text-accent-red"}`}>{order.side}</span>
                  <span className="text-right font-mono text-text-primary tnum">{(order.price * 100).toFixed(1)}¢</span>
                  <span className="text-right font-mono text-text-primary tnum">${order.originalSize.toFixed(2)}</span>
                  <span className="text-right font-mono text-accent-cyan tnum">${order.sizeMatched.toFixed(2)}</span>
                  <span className="text-text-muted text-[10px] uppercase">{order.type}</span>
                  <span className="text-right">
                    {order.status === "LIVE" ? (
                      <span className="text-accent-yellow text-[10px] font-bold">Active</span>
                    ) : (
                      <span className="text-text-muted text-[10px]">{order.status}</span>
                    )}
                  </span>
                </div>
              ))}
            </>
          )
        )}

        {/* ════════════════ CLOSED TRADES ════════════════ */}
        {tab === "history" && (() => {
          const closed = (liveData?.tradeHistory || []).filter(t => t.status === "CONFIRMED");
          const totalSpent = closed.reduce((s, t) => s + t.size, 0);
          const buys = closed.filter(t => t.side === "BUY");
          const sells = closed.filter(t => t.side === "SELL");

          return closed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <CheckCircle className="w-10 h-10 text-text-muted/30" />
              <div className="text-text-muted text-sm">No closed trades yet</div>
            </div>
          ) : (
            <>
              {/* Summary bar */}
              <div className="px-4 py-3 border-b border-border bg-bg-tertiary/20 grid grid-cols-4 gap-4">
                <Stat icon={CheckCircle} label="Filled Trades" value={closed.length} color="text-accent-green" />
                <Stat icon={TrendingUp} label="Buys" value={buys.length} color="text-accent-green" />
                <Stat icon={TrendingDown} label="Sells" value={sells.length} color="text-accent-red" />
                <Stat icon={DollarSign} label="Total Volume" value={`$${totalSpent.toFixed(2)}`} color="text-text-primary" />
              </div>

              <div className="grid grid-cols-[72px_minmax(0,2fr)_56px_56px_64px_64px] gap-2 px-4 py-2 border-b border-border sticky top-0 z-10 bg-bg-secondary text-[10px] text-text-muted uppercase tracking-wider">
                <span>Time</span><span>Market</span><span>Side</span><span>Outcome</span><span className="text-right">Price</span><span className="text-right">Cost</span>
              </div>
              {closed.map((trade, i) => {
                const time = trade.matchTime
                  ? (differenceInHours(new Date(), new Date(parseInt(trade.matchTime) * 1000)) < 24
                    ? formatDistanceToNowStrict(new Date(parseInt(trade.matchTime) * 1000), { addSuffix: false })
                    : format(new Date(parseInt(trade.matchTime) * 1000), "MMM d HH:mm"))
                  : "—";
                return (
                  <div key={trade.id || i} className={`grid grid-cols-[72px_minmax(0,2fr)_56px_56px_64px_64px] gap-2 px-4 py-2 border-b border-border items-center text-xs ${i % 2 === 1 ? "bg-bg-tertiary/10" : ""}`}>
                    <span className="text-text-muted font-mono text-[10px] tnum">{time}</span>
                    <span className="text-text-primary text-xs truncate leading-tight">{trade.marketName}</span>
                    <span className={`font-bold text-[10px] ${trade.side === "BUY" ? "text-accent-green" : "text-accent-red"}`}>{trade.side}</span>
                    <span className={`text-[10px] font-bold ${trade.outcome === "Yes" ? "text-accent-green" : trade.outcome === "No" ? "text-accent-red" : "text-text-muted"}`}>{trade.outcome || "—"}</span>
                    <span className="text-right font-mono text-text-primary tnum">{(trade.price * 100).toFixed(1)}¢</span>
                    <span className="text-right font-mono text-text-primary tnum">${trade.size.toFixed(2)}</span>
                  </div>
                );
              })}
            </>
          );
        })()}

        {/* ════════════════ PAPER LAB ════════════════ */}
        {tab === "paper" && (
          <div>
            {paperState && (
              <div className="px-6 py-3 border-b border-border bg-bg-tertiary/20 grid grid-cols-5 gap-4">
                <Stat icon={DollarSign} label="Balance" value={`$${paperState.paperBalance.toFixed(2)}`} color="text-accent-green" />
                <Stat icon={Activity} label="Open" value={paperTrades.filter(t => t.status === "open").length} color="text-accent-yellow" />
                <Stat icon={CheckCircle} label="Won" value={paperTrades.filter(t => t.status === "won").length} color="text-accent-green" />
                <Stat icon={XCircle} label="Lost" value={paperTrades.filter(t => t.status === "lost").length} color="text-accent-red" />
                <Stat icon={Target} label="P&L" value={`${paperState.totalPnl >= 0 ? "+" : ""}$${paperState.totalPnl.toFixed(2)}`} color={pnlColor(paperState.totalPnl)} />
              </div>
            )}
            {paperTrades.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <BarChart3 className="w-10 h-10 text-text-muted/30" />
                <div className="text-text-muted text-sm">No paper trades yet</div>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {[...paperTrades].reverse().map((t) => (
                  <PaperRow key={t.id} trade={t} onClose={closeTrade} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Position Row (Polymarket-style) ─────────────────────────────────────────

function PositionRow({ pos, isExpanded, isOdd, onToggle, onRefresh }: {
  pos: LivePosition; isExpanded: boolean; isOdd: boolean; onToggle: () => void; onRefresh: () => void;
}) {
  const days = daysUntil(pos.endDate);
  const priceChange = pos.curPrice - pos.avgPrice;
  const isUp = priceChange >= 0;
  const isResolved = pos.redeemable || pos.curPrice >= 0.99 || pos.curPrice <= 0.01;
  const isWinner = pos.curPrice >= 0.99;
  const [action, setAction] = useState<{ status: "idle" | "submitting" | "success" | "error"; msg?: string }>({ status: "idle" });

  const { isConnected } = useAccount();
  const { redeem: walletRedeem } = useRedeem();

  const isLive = !isResolved && pos.curPrice > 0.01 && pos.curPrice < 0.99;

  // Sell form state
  const [sellFormOpen, setSellFormOpen] = useState(false);
  const [orderbook, setOrderbook] = useState<{
    bid: number | null; ask: number | null; bidSize: number; askSize: number; spread: number | null; mid: number | null;
  } | null>(null);
  const [limitPriceCents, setLimitPriceCents] = useState<string>("");
  const [sellShares, setSellShares] = useState<string>("");

  const openSellForm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSellFormOpen(true);
    setSellShares(pos.size.toFixed(2));
    setAction({ status: "idle" });
    // Fetch orderbook depth
    try {
      const res = await fetch(`/api/orderbook?tokenId=${pos.tokenId}`);
      if (res.ok) {
        const ob = await res.json() as typeof orderbook;
        setOrderbook(ob);
        // Default: best ask (top of book — save the spread); fallback to bid+1tick; fallback to curPrice
        const defaultCents = ob?.ask !== null && ob?.ask !== undefined
          ? (ob.ask * 100).toFixed(1)
          : ob?.bid !== null && ob?.bid !== undefined
            ? ((ob.bid + 0.01) * 100).toFixed(1)
            : (pos.curPrice * 100).toFixed(1);
        setLimitPriceCents(defaultCents);
      } else {
        setLimitPriceCents((pos.curPrice * 100).toFixed(1));
      }
    } catch {
      setLimitPriceCents((pos.curPrice * 100).toFixed(1));
    }
  };

  const closeSellForm = () => {
    setSellFormOpen(false);
    setOrderbook(null);
    setLimitPriceCents("");
    setSellShares("");
  };

  const submitSell = async (mode: "limit" | "market") => {
    const sharesNum = parseFloat(sellShares);
    if (!Number.isFinite(sharesNum) || sharesNum <= 0 || sharesNum > pos.size + 0.01) {
      setAction({ status: "error", msg: `Invalid size (max ${pos.size.toFixed(2)})` });
      setTimeout(() => setAction({ status: "idle" }), 5000);
      return;
    }

    let limitPrice: number | undefined;
    if (mode === "limit") {
      const priceCentsNum = parseFloat(limitPriceCents);
      if (!Number.isFinite(priceCentsNum) || priceCentsNum <= 0 || priceCentsNum >= 100) {
        setAction({ status: "error", msg: "Price must be 1-99¢" });
        setTimeout(() => setAction({ status: "idle" }), 5000);
        return;
      }
      limitPrice = priceCentsNum / 100;
    }
    // If mode=="market", omit limitPrice so backend falls back to best-bid

    const proceedsUsd = mode === "limit"
      ? (limitPrice! * sharesNum).toFixed(2)
      : orderbook?.bid !== null && orderbook?.bid !== undefined
        ? (orderbook.bid * sharesNum).toFixed(2)
        : (pos.curPrice * sharesNum).toFixed(2);
    const modeLabel = mode === "limit"
      ? `LIMIT @ ${limitPriceCents}¢`
      : `MARKET (best bid ~${((orderbook?.bid ?? pos.curPrice) * 100).toFixed(1)}¢)`;
    if (!window.confirm(`SELL ${sharesNum.toFixed(2)} shares ${pos.outcome} of "${pos.title}"\n\nType: ${modeLabel}\nProceeds estimate: ~$${proceedsUsd}\n\nContinue?`)) return;

    setAction({ status: "submitting" });
    try {
      const res = await fetch("/api/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: pos.tokenId,
          conditionId: pos.conditionId,
          outcomeIndex: pos.outcomeIndex,
          size: sharesNum,
          title: pos.title,
          negRisk: pos.negativeRisk,
          currentPrice: pos.curPrice,
          entryPrice: pos.avgPrice,
          limitPrice,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAction({ status: "error", msg: body.detail || body.error || `HTTP ${res.status}` });
        setTimeout(() => setAction({ status: "idle" }), 10000);
        return;
      }
      setAction({ status: "success", msg: body.message || `Placed at ${((body.price ?? 0) * 100).toFixed(1)}¢` });
      closeSellForm();
      onRefresh();
      setTimeout(() => setAction({ status: "idle" }), 6000);
    } catch (err) {
      setAction({ status: "error", msg: err instanceof Error ? err.message : String(err) });
      setTimeout(() => setAction({ status: "idle" }), 10000);
    }
  };

  const handleRedeem = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const label = isWinner ? `Redeem ${pos.outcome} on "${pos.title}"?\n\nThis will claim ~$${pos.currentValue.toFixed(2)} via an on-chain transaction.` : `Clear losing position "${pos.title}"?\n\nThis submits an on-chain redeem (no payout — just removes from your positions list).`;
    if (!window.confirm(label)) return;
    setAction({ status: "submitting" });

    try {
      // Path 1: Wallet connected → client-side signing via wagmi
      if (isConnected) {
        const amountAtoms = BigInt(Math.floor(pos.size * 1_000_000));
        const hash = await walletRedeem({
          conditionId: pos.conditionId as `0x${string}`,
          negativeRisk: pos.negativeRisk,
          outcomeIndex: pos.outcomeIndex,
          amountAtoms,
        });
        if (!hash) {
          setAction({ status: "error", msg: "Wallet rejected or tx failed" });
          setTimeout(() => setAction({ status: "idle" }), 8000);
          return;
        }
        setAction({ status: "success", msg: `TX: ${hash.slice(0, 12)}...` });
        onRefresh();
        setTimeout(() => setAction({ status: "idle" }), 5000);
        return;
      }

      // Path 2: No wallet → server-side signing with PRIVATE_KEY
      const endpoint = pos.negativeRisk ? "/api/redeem-negrisk" : "/api/redeem";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditionId: pos.conditionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAction({ status: "error", msg: body.error || body.detail || `HTTP ${res.status}` });
        setTimeout(() => setAction({ status: "idle" }), 8000);
        return;
      }
      setAction({ status: "success", msg: body.results?.[0] || "Redeemed (server)" });
      onRefresh();
      setTimeout(() => setAction({ status: "idle" }), 5000);
    } catch (err) {
      setAction({ status: "error", msg: err instanceof Error ? err.message : String(err) });
      setTimeout(() => setAction({ status: "idle" }), 8000);
    }
  };

  return (
    <>
      <div
        onClick={onToggle}
        className={`grid grid-cols-[minmax(0,3fr)_64px_64px_64px_56px_72px_72px_56px] gap-2 px-4 py-2.5 items-center cursor-pointer transition-colors hover:bg-bg-tertiary/30 ${
          isOdd ? "bg-bg-tertiary/10" : ""
        }`}
      >
        {/* Market */}
        <div className="flex items-center gap-2 min-w-0">
          {pos.icon && (
            <img src={pos.icon} alt="" className="w-6 h-6 rounded flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <div className="min-w-0">
            <div className="text-text-primary text-xs font-medium line-clamp-2 leading-tight">{pos.title}</div>
          </div>
        </div>

        {/* Outcome */}
        <div className="text-center">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
            pos.outcome === "Yes"
              ? "bg-accent-green/10 text-accent-green border-accent-green/30"
              : "bg-accent-red/10 text-accent-red border-accent-red/30"
          }`}>{pos.outcome}</span>
        </div>

        {/* Current Odds */}
        <div className="text-right">
          <div className="text-xs font-mono font-semibold text-text-primary tnum">{(pos.curPrice * 100).toFixed(1)}¢</div>
          <div className={`text-[10px] font-mono tnum ${isUp ? "text-accent-green" : "text-accent-red"}`}>
            {isUp ? "+" : ""}{(priceChange * 100).toFixed(1)}¢
          </div>
        </div>

        {/* Bought At */}
        <div className="text-right">
          <div className="text-xs font-mono text-text-primary tnum">{(pos.avgPrice * 100).toFixed(1)}¢</div>
        </div>

        {/* Shares */}
        <div className="text-right text-xs font-mono text-text-primary tnum">{pos.size.toFixed(1)}</div>

        {/* Current Value */}
        <div className="text-right text-xs font-mono font-semibold text-text-primary tnum">${pos.currentValue.toFixed(2)}</div>

        {/* P&L */}
        <div className="text-right">
          <div className={`text-xs font-mono font-bold tnum ${pnlColor(pos.cashPnl)}`}>
            {pos.cashPnl >= 0 ? "+" : ""}${pos.cashPnl.toFixed(2)}
          </div>
          <div className={`text-[10px] font-mono tnum ${pnlColor(pos.percentPnl)}`}>
            {pos.percentPnl >= 0 ? "+" : ""}{pos.percentPnl.toFixed(1)}%
          </div>
        </div>

        {/* Expires */}
        <div className="text-right">
          <div className="text-xs text-text-primary tnum">{days}d</div>
          <div className="text-[10px] text-text-muted">{format(new Date(pos.endDate), "MMM d")}</div>
        </div>
      </div>

      {/* Expanded */}
      {isExpanded && (
        <div className="px-6 py-3 bg-bg-tertiary/20 border-b border-border">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Cost Basis</div>
              <div className="font-mono text-text-primary tnum">${pos.initialValue.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Total Bought</div>
              <div className="font-mono text-text-primary tnum">{pos.totalBought.toFixed(1)} shares</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Realized P&L</div>
              <div className={`font-mono tnum ${pnlColor(pos.realizedPnl)}`}>${pos.realizedPnl.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Payout if Win</div>
              <div className="font-mono text-accent-green tnum">${pos.size.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase mb-1">Token ID</div>
              <div className="font-mono text-text-muted text-[10px] truncate">{pos.tokenId.slice(0, 25)}...</div>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border flex items-center gap-3 flex-wrap">
            <a
              href={`https://polymarket.com/event/${pos.eventSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-accent-cyan text-[10px] hover:underline"
            >
              View on Polymarket <ExternalLink className="w-2.5 h-2.5" />
            </a>

            {isResolved && (
              <button
                onClick={handleRedeem}
                disabled={action.status === "submitting"}
                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isWinner
                    ? "bg-accent-green/10 text-accent-green border-accent-green/30 hover:bg-accent-green/20"
                    : "bg-text-muted/10 text-text-muted border-text-muted/30 hover:bg-text-muted/20"
                }`}
                title={isWinner ? `Redeem ~$${pos.currentValue.toFixed(2)} on-chain` : "Clear $0 losing position on-chain"}
              >
                {action.status === "submitting" ? (
                  <>
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Submitting…
                  </>
                ) : isWinner ? (
                  <>
                    <DollarSign className="w-2.5 h-2.5" /> Redeem ${pos.currentValue.toFixed(2)}
                  </>
                ) : (
                  <>
                    <XCircle className="w-2.5 h-2.5" /> Clear Losing
                  </>
                )}
              </button>
            )}

            {isLive && !sellFormOpen && (
              <button
                onClick={openSellForm}
                disabled={action.status === "submitting"}
                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  pos.cashPnl >= 0
                    ? "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/40 hover:bg-accent-yellow/20"
                    : "bg-accent-red/10 text-accent-red border-accent-red/40 hover:bg-accent-red/20"
                }`}
                title={`Open sell form for ${pos.size.toFixed(2)} shares`}
              >
                <XCircle className="w-2.5 h-2.5" />
                Sell {pos.outcome} ~${(pos.size * pos.curPrice).toFixed(2)}
              </button>
            )}

            {action.status === "success" && (
              <span className="inline-flex items-center gap-1 text-accent-green text-[10px]">
                <CheckCircle className="w-2.5 h-2.5" /> {action.msg?.slice(0, 80) || "Done"}
              </span>
            )}
            {action.status === "error" && (
              <span className="inline-flex items-center gap-1 text-accent-red text-[10px]">
                <AlertTriangle className="w-2.5 h-2.5" /> {action.msg?.slice(0, 120) || "Error"}
              </span>
            )}
          </div>

          {/* ── SELL FORM ── */}
          {sellFormOpen && (
            <div className="mt-3 p-3 bg-bg-primary border border-accent-yellow/30 rounded" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-accent-yellow text-[10px] font-bold uppercase tracking-wider">Sell {pos.outcome} — set limit to save the spread</div>
                <button onClick={closeSellForm} className="text-text-muted hover:text-text-primary text-[10px]">✕ Close</button>
              </div>

              {/* Orderbook snapshot */}
              <div className="grid grid-cols-3 gap-3 mb-3 text-[11px]">
                <div>
                  <div className="text-text-muted text-[9px] uppercase">Best Bid (market-sell)</div>
                  <div className="font-mono text-accent-red tnum">
                    {orderbook?.bid !== null && orderbook?.bid !== undefined ? `${(orderbook.bid * 100).toFixed(1)}¢` : "—"}
                    {orderbook?.bidSize ? <span className="text-text-muted text-[9px] ml-1">({orderbook.bidSize.toFixed(0)} sh)</span> : null}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted text-[9px] uppercase">Best Ask (your limit target)</div>
                  <div className="font-mono text-accent-green tnum">
                    {orderbook?.ask !== null && orderbook?.ask !== undefined ? `${(orderbook.ask * 100).toFixed(1)}¢` : "—"}
                    {orderbook?.askSize ? <span className="text-text-muted text-[9px] ml-1">({orderbook.askSize.toFixed(0)} sh)</span> : null}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted text-[9px] uppercase">Spread</div>
                  <div className="font-mono text-text-primary tnum">
                    {orderbook?.spread !== null && orderbook?.spread !== undefined ? `${(orderbook.spread * 100).toFixed(1)}¢` : "—"}
                  </div>
                </div>
              </div>

              {/* Inputs */}
              <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                <div>
                  <label className="text-text-muted text-[9px] uppercase block mb-0.5">Limit price (¢)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={limitPriceCents}
                    onChange={(e) => setLimitPriceCents(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-bg-tertiary border border-border rounded text-text-primary font-mono"
                  />
                </div>
                <div>
                  <label className="text-text-muted text-[9px] uppercase block mb-0.5">Shares (max {pos.size.toFixed(2)})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={sellShares}
                    onChange={(e) => setSellShares(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-bg-tertiary border border-border rounded text-text-primary font-mono"
                  />
                </div>
                <button
                  onClick={() => submitSell("limit")}
                  disabled={action.status === "submitting"}
                  className="px-3 py-1 text-[10px] font-bold uppercase bg-accent-green/10 text-accent-green border border-accent-green/40 rounded hover:bg-accent-green/20 disabled:opacity-40"
                >
                  {action.status === "submitting" ? "…" : "Place Limit"}
                </button>
                <button
                  onClick={() => submitSell("market")}
                  disabled={action.status === "submitting"}
                  title="Sell at best bid now (eats the spread but fills fast)"
                  className="px-3 py-1 text-[10px] font-bold uppercase bg-accent-red/10 text-accent-red border border-accent-red/40 rounded hover:bg-accent-red/20 disabled:opacity-40"
                >
                  Market
                </button>
              </div>

              {/* Proceeds estimate */}
              {limitPriceCents && sellShares && !isNaN(parseFloat(limitPriceCents)) && !isNaN(parseFloat(sellShares)) && (
                <div className="mt-2 text-[10px] text-text-muted">
                  Limit proceeds: <span className="font-mono text-text-primary tnum">${(parseFloat(limitPriceCents) / 100 * parseFloat(sellShares)).toFixed(2)}</span>
                  {orderbook?.bid !== null && orderbook?.bid !== undefined && (
                    <> — Market proceeds: <span className="font-mono text-accent-red/70 tnum">${(orderbook.bid * parseFloat(sellShares)).toFixed(2)}</span>
                      <> (save <span className="text-accent-green">${((parseFloat(limitPriceCents) / 100 - orderbook.bid) * parseFloat(sellShares)).toFixed(2)}</span>)</>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Paper trade row ─────────────────────────────────────────────────────────

function PaperRow({ trade, onClose }: { trade: PaperTrade; onClose: (id: string, outcome: "won" | "lost") => void }) {
  const isYes = trade.direction === "BUY_YES";
  return (
    <div className="px-4 py-2 flex items-center gap-3 hover:bg-bg-tertiary/30 text-xs">
      <span className="text-text-muted font-mono text-[10px] w-12 tnum">{relativeTime(trade.timestamp)}</span>
      <span className="text-text-primary flex-1 truncate">{trade.marketQuestion}</span>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
        isYes ? "bg-accent-green/10 text-accent-green border-accent-green/30" : "bg-accent-red/10 text-accent-red border-accent-red/30"
      }`}>{isYes ? "YES" : "NO"}</span>
      <span className="font-mono text-text-primary w-14 text-right tnum">{(trade.entryPrice * 100).toFixed(1)}¢</span>
      <span className="font-mono text-text-primary w-16 text-right tnum">${trade.size.toFixed(2)}</span>
      {trade.status === "open" && trade.mode === "paper" ? (
        <div className="flex gap-1 w-20 justify-end">
          <button onClick={() => onClose(trade.id, "won")} className="p-0.5 rounded hover:bg-accent-green/20"><CheckCircle className="w-3.5 h-3.5 text-accent-green" /></button>
          <button onClick={() => onClose(trade.id, "lost")} className="p-0.5 rounded hover:bg-accent-red/20"><XCircle className="w-3.5 h-3.5 text-accent-red" /></button>
        </div>
      ) : (
        <span className={`w-20 text-right font-mono font-bold tnum ${
          trade.pnl !== undefined ? (trade.pnl >= 0 ? "text-accent-green" : "text-accent-red") : "text-text-muted"
        }`}>
          {trade.pnl !== undefined ? `${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)}` : trade.status}
        </span>
      )}
    </div>
  );
}

// ── Sort button ─────────────────────────────────────────────────────────────

function SortBtn({ label, k, current, dir, onToggle, align = "left" }: {
  label: string; k: SortKey; current: SortKey; dir: SortDir; onToggle: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = current === k;
  return (
    <button onClick={() => onToggle(k)}
      className={`flex items-center gap-0.5 font-normal uppercase tracking-wider text-[10px] ${align === "right" ? "justify-end" : ""} ${active ? "text-accent-cyan" : "text-text-muted hover:text-text-secondary"}`}
    >
      {label}
      {active && (dir === "desc" ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronUp className="w-2.5 h-2.5" />)}
    </button>
  );
}

// ── Stat card ───────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5">
        <Icon className="w-3 h-3" />{label}
      </div>
      <div className={`text-sm font-mono font-semibold tnum ${color}`}>{value}</div>
    </div>
  );
}
