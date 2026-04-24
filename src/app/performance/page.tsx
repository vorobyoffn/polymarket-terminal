"use client";

import Header from "@/components/layout/Header";
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, BarChart3, Target, Activity, Layers, Zap, Clock, CheckCircle, XCircle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface StrategyPerf {
  name: string; count: number; invested: number; current: number;
  pnl: number; pnlPct: number; winners: number; losers: number; resolved: number;
}

interface PositionPnl {
  title: string; pnl: number; pnlPct: number; invested: number;
  category: string; resolved: boolean; outcome: string;
}

interface TimelinePoint {
  date: string; weather: number; crypto: number; other: number; total: number;
}

interface EquityPoint {
  date: string; value: number; label: string;
}

interface RedeemedPosition {
  title: string; outcome: string; won: boolean; cost: number; payout: number; profit: number; category: string;
}

interface PerfData {
  strategies: StrategyPerf[];
  positionPnl: PositionPnl[];
  timeline: TimelinePoint[];
  equityCurve: EquityPoint[];
  redeemedPositions: RedeemedPosition[];
  totals: {
    invested: number; current: number; pnl: number; pnlPct: number;
    positions: number; resolved: number; realizedPnl: number;
    claimableAmount: number; pendingSettlement: number;
    walletUsdc: number; totalPortfolio: number; startingCapital: number; totalReturn: number;
    wonCount?: number; lostCount?: number; resolvedCount?: number;
    winRate?: number; avgWinProfit?: number; avgLossAmount?: number;
  };
}

function pc(v: number) { return v > 0 ? "text-accent-green" : v < 0 ? "text-accent-red" : "text-text-muted"; }
function catCol(c: string) { return c === "weather" ? "#00d4d4" : c === "crypto" ? "#ff8c00" : "#8b949e"; }

type TimeRange = "7d" | "30d" | "ytd" | "1y" | "all";

export default function PerformancePage() {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/performance");
      if (res.ok) setData(await res.json() as PerfData);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30000); return () => clearInterval(id); }, [refresh]);

  if (!mounted) return null;

  const t = data?.totals;
  const strats = data?.strategies || [];
  const pos = data?.positionPnl || [];
  const timeline = data?.timeline || [];

  // Derived stats
  const weatherS = strats.find(s => s.name === "Weather Arb");
  const allWinners = pos.filter(p => p.pnl > 0.5);
  const allLosers = pos.filter(p => p.pnl < -0.5);
  const avgWin = allWinners.length > 0 ? allWinners.reduce((s, p) => s + p.pnl, 0) / allWinners.length : 0;
  const avgLoss = allLosers.length > 0 ? allLosers.reduce((s, p) => s + p.pnl, 0) / allLosers.length : 0;
  const grossProfit = allWinners.reduce((s, p) => s + p.pnl, 0);
  const grossLoss = Math.abs(allLosers.reduce((s, p) => s + p.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const avgTradeSize = pos.length > 0 ? pos.reduce((s, p) => s + p.invested, 0) / pos.length : 0;
  const maxWin = pos.length > 0 ? Math.max(...pos.map(p => p.pnl)) : 0;
  const maxLoss = pos.length > 0 ? Math.min(...pos.map(p => p.pnl)) : 0;
  const resolvedPos = pos.filter(p => p.resolved);
  const resolvedPnl = resolvedPos.reduce((s, p) => s + p.pnl, 0);

  // Cumulative timeline
  let cumW = 0, cumC = 0, cumO = 0, cumT = 0;
  const cum = timeline.map(tp => {
    cumW += tp.weather; cumC += tp.crypto; cumO += tp.other; cumT += tp.total;
    return { date: tp.date, weather: cumW, crypto: cumC, other: cumO, total: cumT };
  });
  const maxCum = Math.max(1, ...cum.map(c => Math.max(Math.abs(c.total), Math.abs(c.weather))));

  // Waterfall
  const maxPnl = Math.max(1, ...pos.map(p => Math.abs(p.pnl)));

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header title="Performance Analytics" subtitle="Strategy returns, P&L charts, and position breakdown"
        actions={<button onClick={refresh} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors disabled:opacity-40">
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
        </button>} />

      <div className="flex-1 overflow-y-auto">

        {/* ═══ ROW 1: KEY METRICS ═══ */}
        {t && (
          <div className="px-6 py-4 bg-bg-secondary border-b border-border">
            <div className="grid grid-cols-5 gap-5">
              <div>
                <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Total Portfolio</div>
                <div className="text-2xl font-mono font-bold text-text-primary tnum money">${t.totalPortfolio.toFixed(2)}</div>
                <div className={`text-xs font-mono tnum ${pc(t.totalReturn)}`}>
                  {t.totalReturn >= 0 ? "+" : ""}{t.totalReturn.toFixed(1)}% from ${t.startingCapital}
                </div>
              </div>
              <div>
                <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Wallet Cash</div>
                <div className="text-lg font-mono text-text-primary tnum">${t.walletUsdc.toFixed(2)}</div>
                <div className="text-text-muted text-[10px]">USDC.e available</div>
              </div>
              <div>
                <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Positions Value</div>
                <div className="text-lg font-mono text-text-primary tnum">${t.current.toFixed(2)}</div>
                <div className={`text-[10px] font-mono tnum ${pc(t.pnl)}`}>
                  {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} unrealized
                </div>
              </div>
              <div>
                <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Win Rate</div>
                <div className={`text-lg font-mono font-bold tnum ${(t.winRate ?? 0) >= 40 ? "text-accent-green" : (t.winRate ?? 0) >= 20 ? "text-accent-yellow" : "text-accent-red"}`}>
                  {(t.winRate ?? 0).toFixed(1)}%
                </div>
                <div className="text-text-muted text-[10px]">
                  {t.wonCount ?? 0}W / {t.lostCount ?? 0}L of {t.resolvedCount ?? 0} resolved
                </div>
              </div>
              <div>
                <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Realized P&L</div>
                <div className={`text-lg font-mono font-bold tnum ${pc(t.realizedPnl)}`}>
                  {t.realizedPnl >= 0 ? "+" : ""}${t.realizedPnl.toFixed(2)}
                </div>
                <div className="text-text-muted text-[10px]">
                  PF {profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}x · {t.positions} pos · {t.pendingSettlement} pending
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ROW 2: DETAILED STATS GRID ═══ */}
        <div className="px-6 py-3 border-b border-border bg-bg-tertiary/20">
          <div className="grid grid-cols-8 gap-3">
            {[
              { icon: DollarSign, label: "Avg Trade", value: `$${avgTradeSize.toFixed(2)}`, color: "text-text-primary" },
              { icon: TrendingUp, label: "Avg Win", value: `+$${avgWin.toFixed(2)}`, color: "text-accent-green" },
              { icon: TrendingDown, label: "Avg Loss", value: `$${avgLoss.toFixed(2)}`, color: "text-accent-red" },
              { icon: Zap, label: "Best Trade", value: `+$${maxWin.toFixed(2)}`, color: "text-accent-green" },
              { icon: Target, label: "Worst Trade", value: `$${maxLoss.toFixed(2)}`, color: "text-accent-red" },
              { icon: Activity, label: "Realized", value: `$${resolvedPnl.toFixed(2)}`, color: pc(resolvedPnl) },
              { icon: Layers, label: "Resolved", value: `${resolvedPos.length}/${pos.length}`, color: "text-accent-cyan" },
              { icon: Clock, label: "Weather ROI", value: weatherS ? `${weatherS.pnlPct.toFixed(1)}%` : "—", color: "text-accent-cyan" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="flex flex-col">
                <div className="flex items-center gap-1 text-text-muted text-[9px] uppercase tracking-wider mb-0.5"><Icon className="w-2.5 h-2.5" />{label}</div>
                <div className={`text-xs font-mono font-semibold tnum ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ ROW 3: STRATEGY COMPARISON ═══ */}
        <div className="px-6 py-5 border-b border-border">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-4">Strategy Comparison</div>
          <div className="grid grid-cols-3 gap-4">
            {strats.map(s => {
              const isPos = s.pnl >= 0;
              const winRate = s.count > 0 ? Math.round(s.winners / s.count * 100) : 0;
              return (
                <div key={s.name} className="bg-bg-secondary border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-text-primary text-sm font-semibold">{s.name}</span>
                    <span className={`text-xs font-mono font-bold tnum ${pc(s.pnl)}`}>
                      {s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] mb-3">
                    <div><div className="text-text-muted uppercase">Invested</div><div className="text-text-primary font-mono tnum">${s.invested.toFixed(0)}</div></div>
                    <div><div className="text-text-muted uppercase">Return</div><div className={`font-mono font-bold tnum ${pc(s.pnlPct)}`}>{s.pnlPct >= 0 ? "+" : ""}{s.pnlPct.toFixed(1)}%</div></div>
                    <div><div className="text-text-muted uppercase">Win Rate</div><div className="text-text-primary font-mono tnum">{winRate}%</div></div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-accent-green">{s.winners}W</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-accent-red">{s.losers}L</span>
                    <span className="text-text-muted ml-auto">{s.resolved} resolved</span>
                  </div>
                  {/* P&L bar */}
                  <div className="mt-2 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${isPos ? "bg-accent-green" : "bg-accent-red"}`}
                      style={{ width: `${Math.min(100, Math.abs(s.pnlPct))}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ ROW 4: EQUITY CURVE ═══ */}
        {data?.equityCurve && data.equityCurve.length > 1 && (() => {
          // Filter equity curve by selected time range
          const now = new Date();
          const cutoffs: Record<TimeRange, Date> = {
            "7d": new Date(now.getTime() - 7 * 86400000),
            "30d": new Date(now.getTime() - 30 * 86400000),
            "ytd": new Date(now.getFullYear(), 0, 1),
            "1y": new Date(now.getTime() - 365 * 86400000),
            "all": new Date(0),
          };
          const cutoff = cutoffs[timeRange];

          const ec = data.equityCurve.filter(p => {
            if (p.date === "Start" || p.date === "Now") return true;
            const d = new Date(p.date);
            return isNaN(d.getTime()) || d >= cutoff;
          });

          const minVal = Math.min(...ec.map(p => p.value));
          const maxVal = Math.max(...ec.map(p => p.value));
          const range = Math.max(1, maxVal - minVal);
          const startVal = ec[0].value;
          const endVal = ec[ec.length - 1].value;
          const pnl = endVal - startVal;
          const pnlPct = ((endVal / startVal - 1) * 100).toFixed(1);
          return (
            <div className="px-6 py-5 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="text-text-muted text-[10px] uppercase tracking-widest">Portfolio Equity Curve</div>
                  <div className="flex gap-1">
                    {(["7d", "30d", "ytd", "1y", "all"] as TimeRange[]).map(tr => (
                      <button key={tr} onClick={() => setTimeRange(tr)}
                        className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-wider transition-colors ${
                          timeRange === tr ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30" : "text-text-muted hover:text-text-secondary"
                        }`}>{tr}</button>
                    ))}
                  </div>
                </div>
                <div className="text-text-muted text-[10px]">
                  ${startVal.toFixed(0)} → ${endVal.toFixed(0)}
                  <span className={`ml-2 font-bold ${pnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnl >= 0 ? "+" : ""}{pnlPct}%)
                  </span>
                </div>
              </div>
              <div style={{ height: 200 }}>
                <svg viewBox="0 0 800 200" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                  {/* Grid */}
                  {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                    const y = 10 + (1 - frac) * 170;
                    const val = (minVal + frac * range).toFixed(0);
                    return (
                      <g key={frac}>
                        <line x1={50} y1={y} x2={780} y2={y} stroke="#21262d" strokeWidth={0.5} />
                        <text x={46} y={y + 3} textAnchor="end" fill="#484f58" fontSize={9} fontFamily="monospace">${val}</text>
                      </g>
                    );
                  })}
                  {/* Start line */}
                  <line x1={50} y1={10 + ((maxVal - startVal) / range) * 170} x2={780} y2={10 + ((maxVal - startVal) / range) * 170} stroke="#484f58" strokeWidth={1} strokeDasharray="4,4" />
                  {/* Area fill */}
                  <polygon
                    fill="url(#equityGrad)" opacity={0.3}
                    points={`60,180 ${ec.map((p, i) => `${60 + (i / (ec.length - 1)) * 720},${10 + ((maxVal - p.value) / range) * 170}`).join(" ")} ${780},180`}
                  />
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00d4d4" />
                      <stop offset="100%" stopColor="#0a0a0f" />
                    </linearGradient>
                  </defs>
                  {/* Line */}
                  <polyline fill="none" stroke="#00d4d4" strokeWidth={2.5}
                    points={ec.map((p, i) => `${60 + (i / (ec.length - 1)) * 720},${10 + ((maxVal - p.value) / range) * 170}`).join(" ")} />
                  {/* Points */}
                  {ec.map((p, i) => {
                    const x = 60 + (i / (ec.length - 1)) * 720;
                    const y = 10 + ((maxVal - p.value) / range) * 170;
                    return (
                      <g key={i}>
                        <circle cx={x} cy={y} r={4} fill="#0a0a0f" stroke="#00d4d4" strokeWidth={2} />
                        <text x={x} y={195} textAnchor="middle" fill="#484f58" fontSize={8} fontFamily="monospace">
                          {p.date === "Start" || p.date === "Now" ? p.date : (() => {
                            const d = new Date(p.date);
                            return isNaN(d.getTime()) ? p.date : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
                          })()}
                        </text>
                        {(i === 0 || i === ec.length - 1 || Math.abs(p.value - ec[Math.max(0, i-1)].value) > range * 0.1) && (
                          <text x={x} y={y - 8} textAnchor="middle" fill="#00d4d4" fontSize={8} fontFamily="monospace" fontWeight="bold">${p.value.toFixed(0)}</text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          );
        })()}

        {/* ═══ ROW 5: REDEEMED / CLOSED POSITIONS ═══ */}
        {data?.redeemedPositions && data.redeemedPositions.length > 0 && (
          <div className="px-6 py-5 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="text-text-muted text-[10px] uppercase tracking-widest">
                Closed & Redeemed Positions ({data.redeemedPositions.length})
              </div>
              <div className="flex gap-4 text-xs font-mono">
                <span className={`font-bold tnum ${pc(t?.realizedPnl || 0)}`}>
                  Realized: {(t?.realizedPnl || 0) >= 0 ? "+" : ""}${(t?.realizedPnl || 0).toFixed(2)}
                </span>
                {(t?.claimableAmount || 0) > 0 && (
                  <span className="text-accent-yellow">Claimable: ${(t?.claimableAmount || 0).toFixed(2)}</span>
                )}
                {(t?.pendingSettlement || 0) > 0 && (
                  <span className="text-text-muted">{t?.pendingSettlement} pending settlement</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,3fr)_56px_56px_64px_64px_72px] gap-2 px-2 py-1.5 text-[9px] text-text-muted uppercase tracking-wider border-b border-border">
              <span>Market</span><span>Type</span><span>Side</span><span className="text-right">Cost</span><span className="text-right">Payout</span><span className="text-right">Profit</span>
            </div>
            {data.redeemedPositions.map((p, i) => (
              <div key={i} className={`grid grid-cols-[minmax(0,3fr)_56px_56px_64px_64px_72px] gap-2 px-2 py-1.5 items-center text-xs border-b border-border ${i % 2 === 1 ? "bg-bg-tertiary/10" : ""}`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  {p.won ? <CheckCircle className="w-3 h-3 text-accent-green flex-shrink-0" /> : <XCircle className="w-3 h-3 text-accent-red flex-shrink-0" />}
                  <span className="text-text-primary truncate text-[11px]">{p.title}</span>
                </div>
                <span className="text-text-muted text-[10px] capitalize">{p.category}</span>
                <span className={`text-[10px] font-bold ${p.outcome === "Yes" ? "text-accent-green" : "text-accent-red"}`}>{p.outcome}</span>
                <span className="text-right font-mono text-text-primary tnum text-[10px]">${p.cost.toFixed(2)}</span>
                <span className="text-right font-mono text-text-primary tnum text-[10px]">${p.payout.toFixed(2)}</span>
                <span className={`text-right font-mono font-bold tnum text-[10px] ${pc(p.profit)}`}>
                  {p.profit >= 0 ? "+" : ""}${p.profit.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ═══ ROW 6: CUMULATIVE P&L CHART ═══ */}
        <div className="px-6 py-5 border-b border-border">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3">Cumulative P&L by Market Resolution Date</div>
          <div style={{ height: 220 }}>
            <svg viewBox="0 0 800 220" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
              {/* Grid */}
              {[-1, -0.5, 0, 0.5, 1].map(frac => {
                const y = 10 + (1 - (frac + 1) / 2) * 190;
                const val = (frac * maxCum).toFixed(0);
                return (
                  <g key={frac}>
                    <line x1={50} y1={y} x2={780} y2={y} stroke="#21262d" strokeWidth={0.5} />
                    <text x={46} y={y + 3} textAnchor="end" fill="#484f58" fontSize={9} fontFamily="monospace">${val}</text>
                  </g>
                );
              })}
              {/* Zero line */}
              <line x1={50} y1={105} x2={780} y2={105} stroke="#484f58" strokeWidth={1} strokeDasharray="4,4" />

              {cum.length > 1 && (
                <>
                  {/* Area fill for total */}
                  <polygon
                    fill="#c9d1d9" opacity={0.07}
                    points={`50,105 ${cum.map((c, i) => {
                      const x = 60 + (i / (cum.length - 1)) * 710;
                      const y = 10 + ((maxCum - c.total) / (2 * maxCum)) * 190;
                      return `${x},${y}`;
                    }).join(" ")} ${60 + 710},105`}
                  />
                  {/* Weather line */}
                  <polyline fill="none" stroke="#00d4d4" strokeWidth={2.5}
                    points={cum.map((c, i) => `${60 + (i / (cum.length - 1)) * 710},${10 + ((maxCum - c.weather) / (2 * maxCum)) * 190}`).join(" ")} />
                  {/* Total line */}
                  <polyline fill="none" stroke="#c9d1d9" strokeWidth={2}
                    points={cum.map((c, i) => `${60 + (i / (cum.length - 1)) * 710},${10 + ((maxCum - c.total) / (2 * maxCum)) * 190}`).join(" ")} />
                  {/* Crypto line */}
                  <polyline fill="none" stroke="#ff8c00" strokeWidth={1.5} strokeDasharray="4,3"
                    points={cum.map((c, i) => `${60 + (i / (cum.length - 1)) * 710},${10 + ((maxCum - c.crypto) / (2 * maxCum)) * 190}`).join(" ")} />
                  {/* Other line */}
                  <polyline fill="none" stroke="#8b949e" strokeWidth={1.5} strokeDasharray="2,3"
                    points={cum.map((c, i) => `${60 + (i / (cum.length - 1)) * 710},${10 + ((maxCum - c.other) / (2 * maxCum)) * 190}`).join(" ")} />

                  {/* Data points */}
                  {cum.map((c, i) => {
                    const x = 60 + (i / (cum.length - 1)) * 710;
                    return (
                      <g key={i}>
                        <circle cx={x} cy={10 + ((maxCum - c.weather) / (2 * maxCum)) * 190} r={3} fill="#00d4d4" />
                        <circle cx={x} cy={10 + ((maxCum - c.total) / (2 * maxCum)) * 190} r={2.5} fill="#c9d1d9" />
                        <text x={x} y={215} textAnchor="middle" fill="#484f58" fontSize={8} fontFamily="monospace">{c.date.slice(5)}</text>
                      </g>
                    );
                  })}
                </>
              )}
            </svg>
          </div>
          <div className="flex gap-5 mt-1 text-[10px] justify-center">
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-accent-cyan inline-block rounded" /> Weather</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-text-primary inline-block rounded" /> Total</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-accent-orange inline-block rounded" style={{ opacity: 0.7 }} /> Crypto</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-text-muted inline-block rounded" /> Other</span>
          </div>
        </div>

        {/* ═══ ROW 5: POSITION WATERFALL ═══ */}
        <div className="px-6 py-5 border-b border-border">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3">
            Position P&L Waterfall — sorted best to worst
          </div>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${Math.max(800, pos.length * 26 + 60)} 200`} className="w-full" style={{ minWidth: 700, height: 200 }}>
              <line x1={30} y1={100} x2={Math.max(800, pos.length * 26 + 60)} y2={100} stroke="#484f58" strokeWidth={0.5} />
              <text x={4} y={104} fill="#484f58" fontSize={8} fontFamily="monospace">$0</text>
              {pos.map((p, i) => {
                const bw = 20;
                const x = 35 + i * (bw + 4);
                const h = Math.max(2, (Math.abs(p.pnl) / maxPnl) * 80);
                const y = p.pnl >= 0 ? 100 - h : 100;
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={bw} height={h} fill={p.pnl >= 0 ? "#00ff88" : "#ff4444"} opacity={p.resolved ? 0.9 : 0.5} rx={2} />
                    <circle cx={x + bw / 2} cy={190} r={3} fill={catCol(p.category)} />
                    {Math.abs(p.pnl) > maxPnl * 0.12 && (
                      <text x={x + bw / 2} y={p.pnl >= 0 ? y - 4 : y + h + 10} textAnchor="middle"
                        fill={p.pnl >= 0 ? "#00ff88" : "#ff4444"} fontSize={7} fontFamily="monospace">
                        {p.pnl >= 0 ? "+" : ""}{p.pnl.toFixed(0)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="flex gap-4 mt-1 text-[10px] text-text-muted justify-center">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#00d4d4" }} /> Weather</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#ff8c00" }} /> Crypto</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#8b949e" }} /> Other</span>
            <span className="ml-2">Solid = resolved · Faded = open</span>
          </div>
        </div>

        {/* ═══ ROW 6: ALL POSITIONS TABLE ═══ */}
        <div className="px-6 py-5">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3">All Positions Ranked by P&L</div>
          <div className="grid grid-cols-[minmax(0,3fr)_56px_56px_64px_72px_72px] gap-2 px-2 py-1.5 text-[9px] text-text-muted uppercase tracking-wider border-b border-border">
            <span>Market</span><span>Type</span><span>Side</span><span className="text-right">Cost</span><span className="text-right">P&L</span><span className="text-right">Return</span>
          </div>
          {pos.map((p, i) => (
            <div key={i} className={`grid grid-cols-[minmax(0,3fr)_56px_56px_64px_72px_72px] gap-2 px-2 py-1.5 items-center text-xs border-b border-border ${i % 2 === 1 ? "bg-bg-tertiary/10" : ""}`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: catCol(p.category) }} />
                <span className="text-text-primary truncate text-[11px] leading-tight">{p.title}</span>
                {p.resolved && <span className="text-[7px] text-accent-green border border-accent-green/30 rounded px-0.5 flex-shrink-0">DONE</span>}
              </div>
              <span className="text-text-muted text-[10px] capitalize">{p.category}</span>
              <span className={`text-[10px] font-bold ${p.outcome === "Yes" ? "text-accent-green" : "text-accent-red"}`}>{p.outcome}</span>
              <span className="text-right font-mono text-text-primary tnum text-[10px]">${p.invested.toFixed(2)}</span>
              <span className={`text-right font-mono font-bold tnum text-[10px] ${pc(p.pnl)}`}>{p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}</span>
              <span className={`text-right font-mono tnum text-[10px] ${pc(p.pnlPct)}`}>{p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
