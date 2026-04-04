"use client";

import Header from "@/components/layout/Header";
import {
  BarChart3, RefreshCw, TrendingUp, TrendingDown,
  DollarSign, Clock, Target, Percent, Filter,
  CheckCircle, XCircle, Activity,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import type { AutoTraderState, TradeRecord } from "@/lib/engine/auto-trader";

type TabKey = "open" | "closed" | "all";

export default function PositionsPage() {
  const [trader, setTrader] = useState<AutoTraderState | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/auto-trade");
      if (res.ok) setTrader(await res.json() as AutoTraderState);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchPositions();
    const id = setInterval(fetchPositions, 5000);
    return () => clearInterval(id);
  }, [fetchPositions]);

  const closeTrade = async (tradeId: string, outcome: "won" | "lost") => {
    await fetch("/api/auto-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close_trade", tradeId, outcome }),
    });
    fetchPositions();
  };

  const trades = trader?.trades || [];
  const filtered = trades.filter((t) => {
    if (tab === "open") return t.status === "open" || t.status === "pending";
    if (tab === "closed") return t.status === "won" || t.status === "lost";
    return true;
  });

  const openTrades = trades.filter((t) => t.status === "open" || t.status === "pending");
  const closedTrades = trades.filter((t) => t.status === "won" || t.status === "lost");
  const totalInvested = openTrades.reduce((s, t) => s + t.size, 0);
  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = closedTrades.filter((t) => t.status === "won").length;
  const winRate = closedTrades.length > 0 ? Math.round((wins / closedTrades.length) * 100) : 0;
  const avgEdge = trades.length > 0 ? trades.reduce((s, t) => s + t.edge, 0) / trades.length : 0;

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Positions"
        subtitle="Open positions & realized P&L from auto-trader"
        actions={
          <button onClick={fetchPositions}
            className="flex items-center gap-1 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        }
      />

      {/* Stats */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary grid grid-cols-6 gap-4">
        {[
          { label: "Open", value: openTrades.length, icon: Activity, color: "text-accent-yellow" },
          { label: "Closed", value: closedTrades.length, icon: BarChart3, color: "text-text-primary" },
          { label: "Invested", value: `$${totalInvested.toFixed(0)}`, icon: DollarSign, color: "text-accent-cyan" },
          { label: "Total P&L", value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, icon: totalPnl >= 0 ? TrendingUp : TrendingDown, color: totalPnl >= 0 ? "text-accent-green" : "text-accent-red" },
          { label: "Win Rate", value: `${winRate}%`, icon: Percent, color: "text-accent-green" },
          { label: "Avg Edge", value: `${(avgEdge * 100).toFixed(1)}%`, icon: Target, color: "text-accent-cyan" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label}>
            <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5"><Icon className="w-2.5 h-2.5" />{label}</div>
            <div className={`text-sm font-mono font-semibold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="px-6 py-2 border-b border-border flex items-center gap-2">
        <Filter className="w-3 h-3 text-text-muted" />
        {(["all", "open", "closed"] as TabKey[]).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`text-[10px] px-2 py-0.5 rounded capitalize transition-colors ${
              tab === k ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30" : "text-text-muted hover:text-text-secondary"
            }`}>
            {k} ({k === "all" ? trades.length : k === "open" ? openTrades.length : closedTrades.length})
          </button>
        ))}
        {trader && (
          <span className="ml-auto text-text-muted text-[10px]">
            Mode: {trader.mode} · Balance: ${(trader.mode === "paper" ? trader.paperBalance : trader.bankroll).toFixed(0)}
          </span>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <BarChart3 className="w-10 h-10 text-text-muted/30" />
          <div className="text-text-secondary text-sm font-semibold">No positions yet</div>
          <div className="text-text-muted text-xs max-w-sm">
            Start the auto-trader on the BTC Arb page to see positions here. Trades will appear as the scanner finds opportunities.
          </div>
        </div>
      ) : (
        <>
          <div className="px-6 py-2 border-b border-border grid grid-cols-[0.6fr_2.5fr_0.6fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr_0.7fr] gap-2 text-[10px] text-text-muted uppercase tracking-wider">
            <span>Time</span><span>Market</span><span>Dir</span><span>Entry</span><span>Size</span><span>Edge</span><span>LOR</span><span>P&L</span><span>Status</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {[...filtered].reverse().map((trade) => {
              const time = new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const isYes = trade.direction === "BUY_YES";
              return (
                <div key={trade.id} className="px-6 py-2.5 border-b border-border grid grid-cols-[0.6fr_2.5fr_0.6fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr_0.7fr] gap-2 items-center hover:bg-bg-tertiary/40 transition-colors">
                  <span className="text-text-muted text-[10px] font-mono">{time}</span>
                  <div className="min-w-0">
                    <div className="text-text-primary text-xs truncate">{trade.marketQuestion}</div>
                  </div>
                  <span className={`text-[10px] font-bold ${isYes ? "text-accent-green" : "text-accent-red"}`}>
                    {isYes ? "BUY YES" : "BUY NO"}
                  </span>
                  <span className="text-xs font-mono text-text-primary">{(trade.entryPrice * 100).toFixed(0)}¢</span>
                  <span className="text-xs font-mono text-text-primary">${trade.size.toFixed(0)}</span>
                  <span className="text-xs font-mono text-accent-yellow">{(trade.edge * 100).toFixed(1)}%</span>
                  <span className="text-xs font-mono text-accent-cyan">{trade.lor.toFixed(1)}</span>
                  <span className={`text-xs font-mono font-semibold ${
                    trade.pnl === undefined ? "text-text-muted" : trade.pnl >= 0 ? "text-accent-green" : "text-accent-red"
                  }`}>
                    {trade.pnl !== undefined ? `${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(0)}` : "—"}
                  </span>
                  <div>
                    {trade.status === "open" && trade.mode === "paper" ? (
                      <div className="flex gap-1">
                        <button onClick={() => closeTrade(trade.id, "won")} className="p-0.5 rounded hover:bg-accent-green/20" title="Won">
                          <CheckCircle className="w-3.5 h-3.5 text-accent-green" />
                        </button>
                        <button onClick={() => closeTrade(trade.id, "lost")} className="p-0.5 rounded hover:bg-accent-red/20" title="Lost">
                          <XCircle className="w-3.5 h-3.5 text-accent-red" />
                        </button>
                      </div>
                    ) : (
                      <span className={`text-[10px] font-bold uppercase ${
                        trade.status === "won" ? "text-accent-green" : trade.status === "lost" ? "text-accent-red"
                        : trade.status === "open" ? "text-accent-yellow" : "text-text-muted"
                      }`}>{trade.status}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
