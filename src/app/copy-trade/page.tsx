"use client";

import Header from "@/components/layout/Header";
import {
  Copy, Plus, Trash2, Play, Square, RefreshCw,
  TrendingUp, TrendingDown, DollarSign, BarChart2,
  AlertTriangle, Users, Eye,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";

interface CopyTrade {
  id: string;
  timestamp: string;
  sourceAddress: string;
  sourceLabel: string;
  market: string;
  direction: "YES" | "NO";
  amount: number;
  status: "copied" | "skipped" | "failed";
  reason?: string;
}

export default function CopyTradingPage() {
  const { copyTargets, addCopyTarget, updateCopyTarget, removeCopyTarget, tradingMode } = useStore();
  const [newAddr, setNewAddr] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newCats, setNewCats] = useState("all");
  const [trades, setTrades] = useState<CopyTrade[]>([]);
  const [running, setRunning] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const addTarget = () => {
    if (!newAddr) return;
    addCopyTarget({
      address: newAddr,
      label: newLabel || `Trader ${copyTargets.length + 1}`,
      enabled: true,
      categories: newCats.split(",").map((c) => c.trim()),
    });
    setNewAddr("");
    setNewLabel("");
    setNewCats("all");
  };

  const enabledCount = copyTargets.filter((t) => t.enabled).length;

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Copy Trading"
        subtitle="Mirror profitable traders automatically"
        actions={
          <div className="flex items-center gap-2">
            {!running ? (
              <button onClick={() => setRunning(true)} disabled={enabledCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs rounded hover:bg-accent-green/20 transition-colors disabled:opacity-40">
                <Play className="w-3 h-3" /> Start Copying
              </button>
            ) : (
              <button onClick={() => setRunning(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-red/10 border border-accent-red/30 text-accent-red text-xs rounded hover:bg-accent-red/20 transition-colors">
                <Square className="w-3 h-3" /> Stop
              </button>
            )}
          </div>
        }
      />

      {/* Status bar */}
      <div className="px-6 py-2 border-b border-border bg-bg-secondary flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${running ? "bg-accent-green animate-pulse" : "bg-text-muted"}`} />
          <span className="text-xs text-text-secondary">{running ? "Monitoring trades..." : "Stopped"}</span>
        </div>
        <span className="text-text-muted text-[10px]">{enabledCount} trader{enabledCount !== 1 ? "s" : ""} tracked</span>
        <span className="text-text-muted text-[10px]">{trades.length} trades copied</span>
        {tradingMode === "paper" && (
          <div className="ml-auto flex items-center gap-1 text-[10px] text-accent-yellow">
            <AlertTriangle className="w-3 h-3" /> Paper mode — trades are simulated
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Add trader */}
        <div className="px-6 py-4 border-b border-border">
          <div className="text-text-muted text-[10px] uppercase tracking-wider mb-2">Add Trader to Copy</div>
          <div className="flex items-center gap-3">
            <input value={newAddr} onChange={(e) => setNewAddr(e.target.value)} placeholder="0x... wallet address"
              className="flex-1 max-w-md bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan" />
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label"
              className="w-32 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan" />
            <input value={newCats} onChange={(e) => setNewCats(e.target.value)} placeholder="Categories"
              className="w-32 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan" />
            <button onClick={addTarget} disabled={!newAddr}
              className="flex items-center gap-1 px-3 py-1.5 bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs rounded hover:bg-accent-green/20 transition-colors disabled:opacity-40">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>

        {/* Tracked traders */}
        <div className="px-6 py-4 border-b border-border">
          <div className="text-text-muted text-[10px] uppercase tracking-wider mb-3 flex items-center gap-1">
            <Users className="w-3 h-3" /> Tracked Traders ({copyTargets.length})
          </div>
          {copyTargets.length === 0 ? (
            <div className="bg-bg-secondary border border-border rounded p-6 text-center">
              <Copy className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
              <div className="text-text-muted text-xs">No traders added yet. Add a wallet address above to start copy trading.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {copyTargets.map((t) => (
                <div key={t.address} className="bg-bg-secondary border border-border rounded p-3 flex items-center gap-4">
                  <button onClick={() => updateCopyTarget(t.address, { enabled: !t.enabled })}
                    className={`w-3 h-3 rounded-sm border transition-colors ${t.enabled ? "bg-accent-green border-accent-green" : "border-text-muted"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary text-xs font-semibold">{t.label}</div>
                    <div className="text-text-muted text-[10px] font-mono truncate">{t.address}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {t.categories.map((c) => (
                      <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted border border-border">{c}</span>
                    ))}
                  </div>
                  <button onClick={() => removeCopyTarget(t.address)} className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-accent-red">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trade log */}
        <div className="px-6 py-4">
          <div className="text-text-muted text-[10px] uppercase tracking-wider mb-3 flex items-center gap-1">
            <BarChart2 className="w-3 h-3" /> Copy Trade Log
          </div>
          {trades.length === 0 ? (
            <div className="bg-bg-secondary border border-border rounded p-6 text-center">
              <Eye className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
              <div className="text-text-muted text-xs">
                {running ? "Monitoring for new trades... trades will appear here when detected." : "Start the copy trader to begin monitoring."}
              </div>
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <div className="px-3 py-1.5 bg-bg-tertiary/50 border-b border-border grid grid-cols-[0.8fr_1fr_2fr_0.5fr_0.5fr_0.6fr] gap-2 text-[9px] text-text-muted uppercase tracking-wider">
                <span>Time</span><span>Trader</span><span>Market</span><span>Dir</span><span>Amount</span><span>Status</span>
              </div>
              {trades.map((trade) => (
                <div key={trade.id} className="px-3 py-1.5 border-b border-border grid grid-cols-[0.8fr_1fr_2fr_0.5fr_0.5fr_0.6fr] gap-2 items-center text-[10px]">
                  <span className="text-text-muted font-mono">{new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-text-secondary truncate">{trade.sourceLabel}</span>
                  <span className="text-text-primary truncate">{trade.market}</span>
                  <span className={trade.direction === "YES" ? "text-accent-green font-bold" : "text-accent-red font-bold"}>{trade.direction}</span>
                  <span className="text-text-primary font-mono">${trade.amount}</span>
                  <span className={`uppercase font-bold ${
                    trade.status === "copied" ? "text-accent-green" : trade.status === "skipped" ? "text-accent-yellow" : "text-accent-red"
                  }`}>{trade.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
