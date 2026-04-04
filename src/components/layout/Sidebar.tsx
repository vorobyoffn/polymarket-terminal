"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, TrendingUp, Wallet, Copy, Bot, BarChart3,
  Settings, Activity, CloudRain, Bitcoin, RefreshCw,
} from "lucide-react";
import { useStore } from "@/lib/store";

const navItems = [
  { href: "/",           label: "Dashboard",      icon: LayoutDashboard },
  { href: "/markets",    label: "Markets",         icon: TrendingUp },
  { href: "/wallets",    label: "Wallet Analysis", icon: Wallet },
  { href: "/copy-trade", label: "Copy Trading",    icon: Copy },
  { href: "/weather",    label: "Weather Arb",     icon: CloudRain },
  { href: "/btc",        label: "BTC Arb",         icon: Bitcoin },
  { href: "/bots",       label: "Custom Bots",     icon: Bot },
  { href: "/positions",  label: "Positions",       icon: BarChart3 },
  { href: "/settings",   label: "Settings",        icon: Settings },
];

interface WalletBalance {
  eoa: { address: string; usdc: number; matic: number };
  proxy: { address: string; usdc: number; matic: number };
  exchange: number;
  totalUsdc: number;
  timestamp: string;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { tradingMode, balance } = useStore();
  const [walletBal, setWalletBal] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (tradingMode !== "live") return;
    setLoading(true);
    try {
      const res = await fetch("/api/wallet-balance");
      if (res.ok) setWalletBal(await res.json() as WalletBalance);
    } catch { /* silent */ }
    setLoading(false);
  }, [tradingMode]);

  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, 15000); // poll every 15s
    return () => clearInterval(id);
  }, [fetchBalance]);

  const displayBalance = tradingMode === "live" && walletBal
    ? walletBal.totalUsdc
    : balance;

  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col h-screen fixed left-0 top-0">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent-cyan" />
          <span className="text-accent-cyan font-bold text-sm tracking-wider">POLYMARKET</span>
        </div>
        <div className="text-text-muted text-[10px] mt-1 tracking-widest uppercase">Terminal v1.0</div>
      </div>

      {/* Mode indicator */}
      <div className="px-4 py-3 border-b border-border">
        <div className={`flex items-center gap-2 text-xs font-semibold ${
          tradingMode === "paper" ? "text-accent-yellow" : "text-accent-green glow-green"
        }`}>
          <span className={`w-2 h-2 rounded-full ${tradingMode === "paper" ? "bg-accent-yellow" : "bg-accent-green"}`} />
          {tradingMode === "paper" ? "PAPER MODE" : "LIVE MODE"}
          {tradingMode === "live" && loading && <RefreshCw className="w-2.5 h-2.5 animate-spin ml-auto opacity-40" />}
        </div>
        <div className="text-text-secondary text-xs mt-1 font-mono">
          ${displayBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          {tradingMode === "live" && <span className="text-text-muted text-[9px] ml-1">USDC</span>}
        </div>
        {tradingMode === "live" && walletBal && (
          <div className="text-text-muted text-[9px] font-mono mt-0.5 space-y-0.5">
            {walletBal.exchange > 0 && (
              <div className="flex justify-between">
                <span>Exchange:</span>
                <span className="text-accent-green">${walletBal.exchange.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Wallet:</span>
              <span>${(walletBal.eoa.usdc + walletBal.proxy.usdc).toFixed(2)}</span>
            </div>
            <div className="flex justify-between opacity-60">
              <span>POL (gas):</span>
              <span>{(walletBal.eoa.matic + walletBal.proxy.matic).toFixed(4)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-xs transition-colors ${
                isActive
                  ? "text-accent-cyan bg-bg-tertiary border-r-2 border-accent-cyan"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50"
              }`}>
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border text-text-muted text-[10px]">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
          Connected to Polygon
        </div>
        {tradingMode === "live" && walletBal && (
          <div className="text-[9px] mt-1 opacity-60">
            Balance updates every 15s
          </div>
        )}
      </div>
    </aside>
  );
}
