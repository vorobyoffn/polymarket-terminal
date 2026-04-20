"use client";

import Header from "@/components/layout/Header";
import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, Square, Pause, Play, RefreshCw, TrendingDown,
  Target, Activity, MapPin, Calendar, Layers, DollarSign,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface RiskData {
  exposure: {
    total: number;
    totalValue: number;
    totalPnl: number;
    positionCount: number;
    byCity: Array<{ city: string; totalCost: number; totalValue: number; posCount: number }>;
    byExpiry: Array<{ date: string; totalCost: number; posCount: number }>;
    byStrategy: Array<{ name: string; totalCost: number; totalValue: number; posCount: number; winnersCount: number }>;
    concentrationWarnings: string[];
  };
  drawdown: {
    peak: number;
    current: number;
    absolute: number;
    percent: number;
    maxDrawdownAllTime: number;
    snapshotCount: number;
  };
  worstCase: {
    ifAllLose: number;
    ifAllWin: number;
    netExposureAtRisk: number;
  };
  circuitBreakers: {
    botRunning: boolean;
    dailySpent: number;
    dailyCap: number;
    allocationUsed: number;
    allocationCap: number;
    lossLimit: number | null;
  };
  equityCurve: Array<{ timestamp: string; value: number; pnl: number }>;
}

function pnlColor(v: number): string {
  return v > 0 ? "text-accent-green" : v < 0 ? "text-accent-red" : "text-text-muted";
}

export default function RiskPage() {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lossLimitInput, setLossLimitInput] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState(false);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/risk");
      if (res.ok) setData(await res.json() as RiskData);
      else setError("Failed to load risk data");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    refresh(true);
    const id = setInterval(() => refresh(false), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleHaltBot = async () => {
    if (!window.confirm("Halt the auto-trading bot? It will stop scanning until you manually restart it.")) return;
    await fetch("/api/auto-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    refresh(true);
  };

  const handleSetLossLimit = async () => {
    const limit = lossLimitInput.trim() === "" ? null : parseFloat(lossLimitInput);
    if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) return;
    setSavingLimit(true);
    await fetch("/api/auto-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_loss_limit", lossLimit: limit }),
    });
    setSavingLimit(false);
    setLossLimitInput("");
    refresh(true);
  };

  if (!data) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <Header title="Risk Management" subtitle="Portfolio exposure, drawdown, circuit breakers" />
        <div className="flex-1 flex items-center justify-center">
          {error ? (
            <div className="text-accent-red text-sm">{error}</div>
          ) : (
            <RefreshCw className="w-8 h-8 text-text-muted animate-spin" />
          )}
        </div>
      </div>
    );
  }

  const { exposure, drawdown, worstCase, circuitBreakers, equityCurve } = data;
  const capUsedPct = circuitBreakers.dailyCap > 0 ? (circuitBreakers.dailySpent / circuitBreakers.dailyCap) * 100 : 0;
  const allocPct = circuitBreakers.allocationCap > 0 ? (circuitBreakers.allocationUsed / circuitBreakers.allocationCap) * 100 : 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Risk Management"
        subtitle="Portfolio exposure, drawdown, circuit breakers"
        actions={
          <button onClick={() => refresh(true)} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 disabled:opacity-40">
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* ── CIRCUIT BREAKERS BANNER ── */}
        <div className="px-6 py-4 border-b border-border bg-bg-secondary">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${circuitBreakers.botRunning ? "bg-accent-green glow-green" : "bg-accent-red"}`} />
              <div>
                <div className="text-text-muted text-[10px] uppercase tracking-wider">Bot Status</div>
                <div className={`text-sm font-bold ${circuitBreakers.botRunning ? "text-accent-green" : "text-accent-red"}`}>
                  {circuitBreakers.botRunning ? "RUNNING" : "STOPPED"}
                </div>
              </div>
            </div>

            <button onClick={handleHaltBot}
              disabled={!circuitBreakers.botRunning}
              className="flex items-center gap-2 px-4 py-2 bg-accent-red/10 border border-accent-red/40 text-accent-red rounded hover:bg-accent-red/20 disabled:opacity-30 text-xs font-semibold uppercase tracking-wider">
              <Square className="w-3 h-3" /> Halt Bot
            </button>

            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-text-muted text-[10px] uppercase mb-1">Daily Spend</div>
                <div className="font-mono text-text-primary tnum">${circuitBreakers.dailySpent.toFixed(2)} / ${circuitBreakers.dailyCap.toFixed(0)}</div>
                <div className={`h-1 rounded mt-1 ${capUsedPct > 90 ? "bg-accent-red/20" : "bg-bg-tertiary"}`}>
                  <div className={`h-full rounded ${capUsedPct > 90 ? "bg-accent-red" : capUsedPct > 70 ? "bg-accent-yellow" : "bg-accent-green"}`} style={{ width: `${Math.min(100, capUsedPct)}%` }} />
                </div>
              </div>
              <div>
                <div className="text-text-muted text-[10px] uppercase mb-1">Allocation</div>
                <div className="font-mono text-text-primary tnum">${circuitBreakers.allocationUsed.toFixed(2)} / ${circuitBreakers.allocationCap.toFixed(0)}</div>
                <div className={`h-1 rounded mt-1 ${allocPct > 90 ? "bg-accent-red/20" : "bg-bg-tertiary"}`}>
                  <div className={`h-full rounded ${allocPct > 90 ? "bg-accent-red" : allocPct > 70 ? "bg-accent-yellow" : "bg-accent-green"}`} style={{ width: `${Math.min(100, allocPct)}%` }} />
                </div>
              </div>
              <div>
                <div className="text-text-muted text-[10px] uppercase mb-1">Loss Limit</div>
                {circuitBreakers.lossLimit !== null ? (
                  <div className="font-mono text-accent-yellow tnum">-${circuitBreakers.lossLimit.toFixed(2)}</div>
                ) : (
                  <div className="text-text-muted text-[10px]">None set</div>
                )}
                <div className="flex gap-1 mt-1">
                  <input type="number" placeholder="e.g. 100"
                    value={lossLimitInput}
                    onChange={e => setLossLimitInput(e.target.value)}
                    className="flex-1 px-1.5 py-0.5 text-[10px] bg-bg-tertiary border border-border rounded text-text-primary font-mono" />
                  <button onClick={handleSetLossLimit} disabled={savingLimit}
                    className="px-2 py-0.5 text-[9px] bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded hover:bg-accent-cyan/20 uppercase">Set</button>
                </div>
              </div>
            </div>
          </div>

          {exposure.concentrationWarnings.length > 0 && (
            <div className="mt-3 p-2 bg-accent-yellow/10 border border-accent-yellow/30 rounded flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-accent-yellow flex-shrink-0 mt-0.5" />
              <div className="text-xs text-accent-yellow">
                <div className="font-semibold mb-1">Concentration warnings:</div>
                {exposure.concentrationWarnings.map((w, i) => <div key={i}>• {w}</div>)}
              </div>
            </div>
          )}
        </div>

        {/* ── EXPOSURE GRID ── */}
        <div className="px-6 py-4 border-b border-border">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3">Exposure</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={DollarSign} label="Total At Risk" value={`$${exposure.totalValue.toFixed(2)}`} sub={`${exposure.positionCount} positions`} color="text-text-primary" />
            <StatCard icon={TrendingDown} label="If All Lose" value={`$${worstCase.ifAllLose.toFixed(2)}`} sub="Max downside" color="text-accent-red" />
            <StatCard icon={Target} label="If All Win" value={`+$${worstCase.ifAllWin.toFixed(2)}`} sub="Max upside" color="text-accent-green" />
            <StatCard icon={Activity} label="Current P&L" value={`${exposure.totalPnl >= 0 ? "+" : ""}$${exposure.totalPnl.toFixed(2)}`} sub="Unrealized" color={pnlColor(exposure.totalPnl)} />
          </div>
        </div>

        {/* ── DRAWDOWN ── */}
        {drawdown.snapshotCount > 1 && (
          <div className="px-6 py-4 border-b border-border">
            <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3 flex items-center gap-2">
              <TrendingDown className="w-3 h-3" /> Drawdown (last 7 days)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
              <StatCard icon={TrendingDown} label="Current" value={`$${drawdown.current.toFixed(2)}`} sub="Portfolio value" color="text-text-primary" />
              <StatCard icon={Target} label="Peak" value={`$${drawdown.peak.toFixed(2)}`} sub="7d high" color="text-accent-green" />
              <StatCard icon={Activity} label="Drawdown" value={`-$${drawdown.absolute.toFixed(2)}`} sub={`${drawdown.percent.toFixed(1)}% from peak`} color="text-accent-red" />
              <StatCard icon={AlertTriangle} label="Max DD (all-time)" value={`-$${drawdown.maxDrawdownAllTime.toFixed(2)}`} sub="Worst in history" color="text-accent-red" />
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve}>
                  <XAxis dataKey="timestamp" tickFormatter={(v: string) => v.slice(5, 10)} tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1f2e", border: "1px solid #2d3748", borderRadius: "4px" }}
                    labelStyle={{ color: "#9ca3af", fontSize: "10px" }}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, "Value"]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2} dot={false} />
                  {circuitBreakers.lossLimit !== null && (
                    <ReferenceLine y={drawdown.peak + circuitBreakers.lossLimit} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Loss limit", fill: "#ef4444", fontSize: 10 }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── EXPOSURE BREAKDOWN ── */}
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-6">
          <BreakdownTable title="By City" icon={MapPin} rows={exposure.byCity.map(c => ({ label: c.city, cost: c.totalCost, count: c.posCount }))} total={exposure.total} />
          <BreakdownTable title="By Expiry" icon={Calendar} rows={exposure.byExpiry.map(d => ({ label: d.date, cost: d.totalCost, count: d.posCount }))} total={exposure.total} />
          <BreakdownTable title="By Strategy" icon={Layers} rows={exposure.byStrategy.map(s => ({ label: s.name, cost: s.totalCost, count: s.posCount }))} total={exposure.total} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-text-muted text-[10px] uppercase tracking-wider mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={`text-lg font-mono font-bold tnum ${color || "text-text-primary"}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ title, icon: Icon, rows, total }: {
  title: string; icon: React.ElementType; rows: Array<{ label: string; cost: number; count: number }>; total: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-text-muted text-[10px] uppercase tracking-wider mb-2">
        <Icon className="w-3 h-3" />
        {title}
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const pct = total > 0 ? (r.cost / total) * 100 : 0;
          return (
            <div key={i} className="text-xs">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-text-primary">{r.label}</span>
                <span className="font-mono text-text-primary tnum">${r.cost.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-bg-tertiary rounded overflow-hidden">
                  <div className={`h-full ${pct > 40 ? "bg-accent-yellow" : "bg-accent-cyan"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-text-muted tnum w-16 text-right">{pct.toFixed(1)}% · {r.count}</span>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="text-text-muted text-xs">No data</div>}
      </div>
    </div>
  );
}
