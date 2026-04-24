"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Activity,
  CloudRain, Bitcoin, ArrowUpRight, Layers, Target, RefreshCw,
  CheckCircle, XCircle, Clock, Zap,
} from "lucide-react";

interface Position {
  title: string;
  outcome: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  endDate: string;
  icon: string;
  eventSlug: string;
}

interface PortfolioData {
  positions: Position[];
  stats: {
    totalPositions: number;
    totalInitial: number;
    totalCurrent: number;
    totalPnl: number;
    totalPnlPct: number;
    totalRealized: number;
    winners: number;
    losers: number;
  };
}

interface AutoTraderState {
  running: boolean;
  mode: string;
  scanCount: number;
  trades: { status: string; pnl?: number; marketQuestion: string; direction: string; entryPrice: number; size: number }[];
  totalPnl: number;
  winRate: number;
  paperBalance: number;
}

export default function Dashboard() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [trader, setTrader] = useState<AutoTraderState | null>(null);
  const [walletUsdc, setWalletUsdc] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    try {
      const [posRes, traderRes, walletRes] = await Promise.all([
        fetch("/api/live-positions"),
        fetch("/api/auto-trade"),
        fetch("/api/wallet-balance"),
      ]);
      if (posRes.ok) setData(await posRes.json() as PortfolioData);
      if (traderRes.ok) setTrader(await traderRes.json() as AutoTraderState);
      if (walletRes.ok) {
        const w = await walletRes.json() as { totalUsdc: number };
        setWalletUsdc(w.totalUsdc || 0);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!mounted) return null;

  const stats = data?.stats;
  const positions = data?.positions || [];
  const totalPortfolio = walletUsdc + (stats?.totalCurrent || 0);
  const weatherPositions = positions.filter(p => p.title.toLowerCase().includes("temperature"));
  const otherPositions = positions.filter(p => !p.title.toLowerCase().includes("temperature"));
  const weatherPnl = weatherPositions.reduce((s, p) => s + p.cashPnl, 0);
  const otherPnl = otherPositions.reduce((s, p) => s + p.cashPnl, 0);
  const weatherInvested = weatherPositions.reduce((s, p) => s + p.initialValue, 0);

  // Top movers
  const topWinners = [...positions].sort((a, b) => b.cashPnl - a.cashPnl).slice(0, 3);
  const topLosers = [...positions].sort((a, b) => a.cashPnl - b.cashPnl).slice(0, 3);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Investment Dashboard"
        subtitle="Portfolio overview, P&L tracking, and strategy performance"
        actions={
          <button onClick={refresh} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* ── HERO: Portfolio Value ── */}
        <div className="px-6 py-5 bg-bg-secondary border-b border-border">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            <div>
              <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Total Portfolio</div>
              <div className="text-3xl font-mono font-bold text-text-primary tnum money">${totalPortfolio.toFixed(2)}</div>
              {stats && (
                <div className={`text-sm font-mono tnum mt-1 ${stats.totalPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                  {stats.totalPnl >= 0 ? "+" : ""}{stats.totalPnl.toFixed(2)} ({stats.totalPnlPct >= 0 ? "+" : ""}{stats.totalPnlPct.toFixed(1)}%) unrealized
                </div>
              )}
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Cash Available</div>
              <div className="text-2xl font-mono font-bold text-text-primary tnum money">${walletUsdc.toFixed(2)}</div>
              <div className="text-text-muted text-[10px] mt-1">USDC.e on Polygon</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Positions Value</div>
              <div className="text-2xl font-mono font-bold text-text-primary tnum money">${(stats?.totalCurrent || 0).toFixed(2)}</div>
              <div className="text-text-muted text-[10px] mt-1">{stats?.totalPositions || 0} active positions</div>
            </div>
            <div>
              <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Bot Status</div>
              {trader?.running ? (
                <>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-accent-green animate-pulse" />
                    <span className="text-accent-green text-sm font-bold uppercase">{trader.mode} Running</span>
                  </div>
                  <div className="text-text-muted text-[10px] mt-1">Scan #{trader.scanCount} · every 90s</div>
                </>
              ) : (
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-text-muted" />
                  <span className="text-text-muted text-sm">Stopped</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── STRATEGY P&L BREAKDOWN ── */}
        <div className="px-6 py-4 border-b border-border">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3">Strategy Performance</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Weather */}
            <div className="bg-bg-secondary border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <CloudRain className="w-4 h-4 text-accent-cyan" />
                <span className="text-text-primary text-sm font-semibold">Weather Arbitrage</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Invested</div>
                  <div className="text-text-primary text-sm font-mono tnum">${weatherInvested.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">P&L</div>
                  <div className={`text-sm font-mono font-bold tnum ${weatherPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {weatherPnl >= 0 ? "+" : ""}${weatherPnl.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Positions</div>
                  <div className="text-text-primary text-sm font-mono tnum">{weatherPositions.length}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Return</div>
                  <div className={`text-sm font-mono font-bold tnum ${weatherPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {weatherInvested > 0 ? ((weatherPnl / weatherInvested) * 100).toFixed(1) : "0.0"}%
                  </div>
                </div>
              </div>
              {/* P&L bar */}
              <div className="mt-3 h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${weatherPnl >= 0 ? "bg-accent-green" : "bg-accent-red"}`}
                  style={{ width: `${Math.min(100, Math.abs(weatherPnl / Math.max(weatherInvested, 1)) * 100)}%` }}
                />
              </div>
            </div>

            {/* Crypto/Other */}
            <div className="bg-bg-secondary border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Bitcoin className="w-4 h-4 text-accent-orange" />
                <span className="text-text-primary text-sm font-semibold">Crypto & Other</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Invested</div>
                  <div className="text-text-primary text-sm font-mono tnum">${otherPositions.reduce((s, p) => s + p.initialValue, 0).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">P&L</div>
                  <div className={`text-sm font-mono font-bold tnum ${otherPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {otherPnl >= 0 ? "+" : ""}${otherPnl.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Positions</div>
                  <div className="text-text-primary text-sm font-mono tnum">{otherPositions.length}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Return</div>
                  <div className={`text-sm font-mono font-bold tnum ${otherPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {otherPositions.reduce((s, p) => s + p.initialValue, 0) > 0
                      ? ((otherPnl / otherPositions.reduce((s, p) => s + p.initialValue, 0)) * 100).toFixed(1)
                      : "0.0"}%
                  </div>
                </div>
              </div>
              <div className="mt-3 h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${otherPnl >= 0 ? "bg-accent-green" : "bg-accent-red"}`}
                  style={{ width: `${Math.min(100, Math.abs(otherPnl / Math.max(otherPositions.reduce((s, p) => s + p.initialValue, 1), 1)) * 100)}%` }}
                />
              </div>
            </div>

            {/* Overall Stats */}
            <div className="bg-bg-secondary border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-accent-yellow" />
                <span className="text-text-primary text-sm font-semibold">Overall Stats</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Win Rate</div>
                  <div className="text-text-primary text-sm font-mono tnum">
                    {stats && stats.totalPositions > 0
                      ? Math.round(stats.winners / stats.totalPositions * 100) + "%"
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Winners/Losers</div>
                  <div className="text-sm font-mono tnum">
                    <span className="text-accent-green">{stats?.winners || 0}W</span>
                    {" / "}
                    <span className="text-accent-red">{stats?.losers || 0}L</span>
                  </div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Realized</div>
                  <div className="text-text-muted text-sm font-mono tnum">${(stats?.totalRealized || 0).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px] uppercase">Cost Basis</div>
                  <div className="text-text-primary text-sm font-mono tnum">${(stats?.totalInitial || 0).toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-3 h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent-cyan"
                  style={{ width: `${stats ? Math.round(stats.winners / Math.max(stats.totalPositions, 1) * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── TOP MOVERS ── */}
        <div className="px-6 py-4 border-b border-border grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Winners */}
          <div>
            <div className="text-text-muted text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-accent-green" /> Top Winners
            </div>
            {topWinners.filter(p => p.cashPnl > 0).map((p, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                {p.icon && <img src={p.icon} alt="" className="w-5 h-5 rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-xs truncate">{p.title}</div>
                  <div className="text-text-muted text-[10px]">{p.outcome} · {(p.curPrice * 100).toFixed(1)}¢</div>
                </div>
                <div className="text-right">
                  <div className="text-accent-green text-xs font-mono font-bold tnum">+${p.cashPnl.toFixed(2)}</div>
                  <div className="text-accent-green text-[10px] font-mono tnum">+{p.percentPnl.toFixed(1)}%</div>
                </div>
              </div>
            ))}
            {topWinners.filter(p => p.cashPnl > 0).length === 0 && (
              <div className="text-text-muted text-[10px] py-2">No winners yet</div>
            )}
          </div>

          {/* Top Losers */}
          <div>
            <div className="text-text-muted text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1">
              <TrendingDown className="w-3 h-3 text-accent-red" /> Top Losers
            </div>
            {topLosers.filter(p => p.cashPnl < 0).map((p, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                {p.icon && <img src={p.icon} alt="" className="w-5 h-5 rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-xs truncate">{p.title}</div>
                  <div className="text-text-muted text-[10px]">{p.outcome} · {(p.curPrice * 100).toFixed(1)}¢</div>
                </div>
                <div className="text-right">
                  <div className="text-accent-red text-xs font-mono font-bold tnum">${p.cashPnl.toFixed(2)}</div>
                  <div className="text-accent-red text-[10px] font-mono tnum">{p.percentPnl.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── ALL POSITIONS ── */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="text-text-muted text-[10px] uppercase tracking-widest flex items-center gap-1">
              <Layers className="w-3 h-3" /> All Positions ({positions.length})
            </div>
            <Link href="/positions" className="text-accent-cyan text-[10px] hover:underline flex items-center gap-1">
              View Full Portfolio <ArrowUpRight className="w-2.5 h-2.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
          <div className="grid grid-cols-[minmax(0,2.5fr)_56px_56px_56px_64px_64px] gap-2 px-2 py-1.5 text-[9px] text-text-muted uppercase tracking-wider border-b border-border min-w-[500px]">
            <span>Market</span><span>Side</span><span>Odds</span><span>Entry</span><span className="text-right">Value</span><span className="text-right">P&L</span>
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {positions.map((p, i) => (
              <div key={i} className={`grid grid-cols-[minmax(0,2.5fr)_56px_56px_56px_64px_64px] gap-2 px-2 py-2 items-center text-xs border-b border-border min-w-[500px] ${i % 2 === 1 ? "bg-bg-tertiary/10" : ""}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {p.icon && <img src={p.icon} alt="" className="w-4 h-4 rounded flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                  <span className="text-text-primary truncate text-[11px] leading-tight">{p.title}</span>
                </div>
                <span className={`text-[10px] font-bold ${p.outcome === "Yes" ? "text-accent-green" : "text-accent-red"}`}>{p.outcome}</span>
                <span className="text-text-primary font-mono tnum text-[10px]">{(p.curPrice * 100).toFixed(0)}¢</span>
                <span className="text-text-muted font-mono tnum text-[10px]">{(p.avgPrice * 100).toFixed(0)}¢</span>
                <span className="text-right text-text-primary font-mono tnum text-[10px]">${p.currentValue.toFixed(2)}</span>
                <span className={`text-right font-mono font-bold tnum text-[10px] ${p.cashPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                  {p.cashPnl >= 0 ? "+" : ""}{p.cashPnl.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          </div>
        </div>

        {/* ── QUICK LINKS ── */}
        <div className="px-6 py-4">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3">Quick Access</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { href: "/positions", icon: Layers, label: "Positions", desc: "Full portfolio view" },
              { href: "/weather", icon: CloudRain, label: "Weather Arb", desc: "Live weather signals" },
              { href: "/btc", icon: Bitcoin, label: "BTC Arb", desc: "Price-lag scanner" },
              { href: "/strategies", icon: Zap, label: "Strategies", desc: "All strategy signals" },
            ].map(s => (
              <Link key={s.href} href={s.href}
                className="bg-bg-secondary border border-border rounded-lg p-3 hover:border-accent-cyan/40 transition-colors group">
                <div className="flex items-center justify-between mb-1">
                  <s.icon className="w-4 h-4 text-accent-cyan" />
                  <ArrowUpRight className="w-3 h-3 text-text-muted group-hover:text-accent-cyan" />
                </div>
                <div className="text-text-primary text-xs font-semibold">{s.label}</div>
                <div className="text-text-muted text-[10px]">{s.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
