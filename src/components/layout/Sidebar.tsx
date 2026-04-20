"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, TrendingUp, Wallet, Copy, Bot, BarChart3,
  Settings, Activity, CloudRain, Bitcoin, RefreshCw, Layers,
  Menu, X, AlertTriangle, Gauge,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

const navItems = [
  { href: "/",           label: "Dashboard",      icon: LayoutDashboard },
  { href: "/markets",    label: "Markets",         icon: TrendingUp },
  { href: "/wallets",    label: "Wallet Analysis", icon: Wallet },
  { href: "/copy-trade", label: "Copy Trading",    icon: Copy },
  { href: "/weather",    label: "Weather Arb",     icon: CloudRain },
  { href: "/edges",      label: "Edges",           icon: Gauge },
  { href: "/btc",        label: "BTC Arb",         icon: Bitcoin },
  { href: "/strategies", label: "Strategies",      icon: Layers },
  { href: "/bots",       label: "Custom Bots",     icon: Bot },
  { href: "/positions",  label: "Positions",       icon: BarChart3 },
  { href: "/performance", label: "Performance",    icon: TrendingUp },
  { href: "/risk",       label: "Risk",            icon: AlertTriangle },
  { href: "/settings",   label: "Settings",        icon: Settings },
];

interface WalletBalance {
  eoa: { address: string; usdc: number; matic: number };
  proxy: { address: string; usdc: number; matic: number };
  exchange: number;
  totalUsdc: number;
  timestamp: string;
}

interface PortfolioSummary {
  walletUsdc: number;
  totalPortfolio: number;
  pnl: number;
  pnlPct: number;
  current: number;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { tradingMode, balance, setConnectedAddress } = useStore();
  const { address, isConnected } = useAccount();
  const [walletBal, setWalletBal] = useState<WalletBalance | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Keep store in sync with wagmi
  useEffect(() => {
    setConnectedAddress(isConnected && address ? address : null);
  }, [address, isConnected, setConnectedAddress]);

  const fetchBalance = useCallback(async () => {
    if (tradingMode !== "live") return;
    setLoading(true);
    try {
      const [walletRes, perfRes] = await Promise.all([
        fetch("/api/wallet-balance"),
        fetch("/api/performance"),
      ]);
      if (walletRes.ok) setWalletBal(await walletRes.json() as WalletBalance);
      if (perfRes.ok) {
        const perf = await perfRes.json() as { totals: PortfolioSummary };
        if (perf.totals) setPortfolio(perf.totals);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [tradingMode]);

  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, 15000);
    return () => clearInterval(id);
  }, [fetchBalance]);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const displayBalance = tradingMode === "live" && walletBal
    ? walletBal.totalUsdc
    : balance;

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5" style={{ color: "#e8751a" }} />
          <span className="font-bold text-sm tracking-wider" style={{ color: "#e8751a" }}>ARRAKIS</span>
          {/* Close button on mobile */}
          <button className="ml-auto md:hidden p-1" onClick={() => setMobileOpen(false)}>
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>
        <div className="text-text-muted text-[10px] mt-1 tracking-widest uppercase">Trading Terminal</div>
      </div>

      {/* Portfolio summary */}
      <div className="px-4 py-3 border-b border-border">
        <div className={`flex items-center gap-2 text-xs font-semibold ${
          tradingMode === "paper" ? "text-accent-yellow" : "text-accent-green glow-green"
        }`}>
          <span className={`w-2 h-2 rounded-full ${tradingMode === "paper" ? "bg-accent-yellow" : "bg-accent-green"}`} />
          {tradingMode === "paper" ? "PAPER MODE" : "LIVE MODE"}
          {loading && <RefreshCw className="w-2.5 h-2.5 animate-spin ml-auto opacity-40" />}
        </div>
        <div className="text-text-primary text-lg font-mono font-bold mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
          ${portfolio ? portfolio.totalPortfolio.toLocaleString("en-US", { minimumFractionDigits: 2 }) : displayBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </div>
        {portfolio && (
          <div className={`text-[10px] font-mono mt-0.5 ${portfolio.pnl >= 0 ? "text-accent-green" : "text-accent-red"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
            {portfolio.pnl >= 0 ? "+" : ""}${portfolio.pnl.toFixed(2)} ({portfolio.pnlPct >= 0 ? "+" : ""}{portfolio.pnlPct.toFixed(1)}%) unrealized
          </div>
        )}
        {tradingMode === "live" && walletBal && (
          <div className="text-text-muted text-[9px] font-mono mt-1.5 space-y-0.5">
            <div className="flex justify-between">
              <span>Cash:</span>
              <span>${walletBal.totalUsdc.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Positions:</span>
              <span>${portfolio ? portfolio.current.toFixed(2) : "\u2014"}</span>
            </div>
          </div>
        )}
      </div>

      {/* Wallet Connect */}
      <div className="px-4 py-3 border-b border-border">
        <ConnectButton
          showBalance={false}
          chainStatus="icon"
          accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
        />
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
    </>
  );

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-bg-secondary border-b border-border flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4" style={{ color: "#e8751a" }} />
          <span className="font-bold text-xs tracking-wider" style={{ color: "#e8751a" }}>ARRAKIS</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-text-primary text-sm font-mono font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
            ${portfolio ? portfolio.totalPortfolio.toLocaleString("en-US", { minimumFractionDigits: 2 }) : displayBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
          <button onClick={() => setMobileOpen(true)} className="p-1">
            <Menu className="w-5 h-5 text-text-primary" />
          </button>
        </div>
      </div>

      {/* ── Mobile spacer (prevents content from hiding behind fixed bar) ── */}
      <div className="md:hidden h-11" />

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-56 bg-bg-secondary border-r border-border flex-col h-screen fixed left-0 top-0 z-40">
        {sidebarContent}
      </aside>

      {/* ── Mobile drawer overlay ── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          {/* Drawer */}
          <aside className="relative w-64 bg-bg-secondary border-r border-border flex flex-col h-full z-10">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
