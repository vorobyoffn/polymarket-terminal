"use client";

import Header from "@/components/layout/Header";
import {
  Wallet, Search, Plus, Trash2, ExternalLink, RefreshCw,
  TrendingUp, TrendingDown, BarChart2, DollarSign, Eye,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface WalletProfile {
  address: string;
  label: string;
  positions: number;
  totalInvested: number;
  totalPnl: number;
  winRate: number;
  topMarkets: string[];
  loading: boolean;
}

const KNOWN_WHALES: { address: string; label: string }[] = [
  { address: "0xb8e4c89edce3d0c8c8c2a37dbeb24cdd5bde0654", label: "Polymarket Whale #1" },
  { address: "0x1e42be9a41d7289e2f751b1d21c4068b8d67f3e1", label: "Crypto Degen" },
  { address: "0x54c19bee60ee76fe08cca1be26e6e5b4d1b5dd47", label: "Political Trader" },
];

export default function WalletAnalysisPage() {
  const [wallets, setWallets] = useState<WalletProfile[]>([]);
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [search, setSearch] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchWalletData = useCallback(async (address: string): Promise<Partial<WalletProfile>> => {
    try {
      const res = await fetch(`https://data-api.polymarket.com/positions?user=${address.toLowerCase()}&limit=50`);
      if (!res.ok) return {};
      const positions = await res.json() as { market: string; size: number; avgPrice: number; curPrice: number; realizedPnl: number }[];
      const totalInvested = positions.reduce((s, p) => s + Math.abs(p.size * p.avgPrice), 0);
      const totalPnl = positions.reduce((s, p) => s + (p.realizedPnl || 0), 0);
      const wins = positions.filter((p) => (p.realizedPnl || 0) > 0).length;
      const closed = positions.filter((p) => p.realizedPnl !== undefined).length;
      return {
        positions: positions.length,
        totalInvested: Math.round(totalInvested),
        totalPnl: Math.round(totalPnl * 100) / 100,
        winRate: closed > 0 ? Math.round((wins / closed) * 100) : 0,
        topMarkets: positions.slice(0, 3).map((p) => p.market || "Unknown"),
      };
    } catch {
      return { positions: 0, totalInvested: 0, totalPnl: 0, winRate: 0, topMarkets: [] };
    }
  }, []);

  const addWallet = useCallback(async (address: string, label: string) => {
    if (!address || wallets.some((w) => w.address.toLowerCase() === address.toLowerCase())) return;
    const initial: WalletProfile = {
      address, label: label || `Wallet ${wallets.length + 1}`,
      positions: 0, totalInvested: 0, totalPnl: 0, winRate: 0, topMarkets: [], loading: true,
    };
    setWallets((prev) => [...prev, initial]);
    const data = await fetchWalletData(address);
    setWallets((prev) => prev.map((w) => w.address === address ? { ...w, ...data, loading: false } : w));
  }, [wallets, fetchWalletData]);

  const removeWallet = (address: string) => {
    setWallets((prev) => prev.filter((w) => w.address !== address));
  };

  const refreshAll = async () => {
    setWallets((prev) => prev.map((w) => ({ ...w, loading: true })));
    for (const w of wallets) {
      const data = await fetchWalletData(w.address);
      setWallets((prev) => prev.map((ww) => ww.address === w.address ? { ...ww, ...data, loading: false } : ww));
    }
  };

  const filtered = wallets.filter((w) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return w.label.toLowerCase().includes(q) || w.address.toLowerCase().includes(q);
  });

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Wallet Analysis"
        subtitle="Track whale wallets & analyze trading patterns"
        actions={
          <button onClick={refreshAll} className="flex items-center gap-1 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh All
          </button>
        }
      />

      {/* Add wallet bar */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary flex items-center gap-3">
        <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="0x... wallet address"
          className="flex-1 max-w-md bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan" />
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (optional)"
          className="w-40 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan" />
        <button onClick={() => { addWallet(newAddress, newLabel); setNewAddress(""); setNewLabel(""); }}
          disabled={!newAddress}
          className="flex items-center gap-1 px-3 py-1.5 bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs rounded hover:bg-accent-green/20 transition-colors disabled:opacity-40">
          <Plus className="w-3 h-3" /> Track
        </button>
        <div className="h-4 w-px bg-border" />
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter..."
            className="w-32 bg-bg-tertiary border border-border rounded pl-7 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan" />
        </div>
      </div>

      {/* Quick add whales */}
      {wallets.length === 0 && (
        <div className="px-6 py-4 border-b border-border bg-bg-secondary">
          <div className="text-text-muted text-[10px] uppercase tracking-wider mb-2">Quick Add Known Whales</div>
          <div className="flex gap-2">
            {KNOWN_WHALES.map((w) => (
              <button key={w.address} onClick={() => addWallet(w.address, w.label)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-secondary hover:border-accent-cyan/40 hover:text-accent-cyan transition-colors">
                <Eye className="w-3 h-3" /> {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Wallet cards */}
      {filtered.length === 0 && wallets.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <Wallet className="w-10 h-10 text-text-muted/30" />
          <div className="text-text-secondary text-sm font-semibold">No wallets tracked yet</div>
          <div className="text-text-muted text-xs max-w-sm">
            Add a Polygon wallet address above to analyze their Polymarket positions, P&L, and trading patterns.
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-4 auto-rows-min">
          {filtered.map((w) => (
            <div key={w.address} className="bg-bg-secondary border border-border rounded p-4 hover:border-accent-cyan/30 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-text-primary text-sm font-semibold">{w.label}</div>
                  <div className="text-text-muted text-[10px] font-mono">{w.address.slice(0, 8)}...{w.address.slice(-6)}</div>
                </div>
                <div className="flex gap-1">
                  <a href={`https://polygonscan.com/address/${w.address}`} target="_blank" rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-accent-cyan"><ExternalLink className="w-3 h-3" /></a>
                  <button onClick={() => removeWallet(w.address)} className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-accent-red">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {w.loading ? (
                <div className="flex items-center gap-2 text-text-muted text-xs"><RefreshCw className="w-3 h-3 animate-spin" /> Loading...</div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Positions", value: w.positions, icon: BarChart2, color: "text-accent-cyan" },
                    { label: "Invested", value: `$${w.totalInvested.toLocaleString()}`, icon: DollarSign, color: "text-text-primary" },
                    { label: "P&L", value: `${w.totalPnl >= 0 ? "+" : ""}$${w.totalPnl.toFixed(2)}`, icon: w.totalPnl >= 0 ? TrendingUp : TrendingDown, color: w.totalPnl >= 0 ? "text-accent-green" : "text-accent-red" },
                    { label: "Win Rate", value: `${w.winRate}%`, icon: BarChart2, color: "text-accent-yellow" },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label}>
                      <div className="flex items-center gap-1 text-text-muted text-[9px] uppercase tracking-wider mb-0.5">
                        <Icon className="w-2.5 h-2.5" />{label}
                      </div>
                      <div className={`text-xs font-mono font-semibold ${color}`}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
