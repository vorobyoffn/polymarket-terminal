"use client";

import { useStore } from "@/lib/store";
import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import {
  TrendingUp, Wallet, Copy, Bot, BarChart3, Activity,
  CloudRain, Bitcoin, ArrowUpRight, Circle,
} from "lucide-react";

const strategies = [
  { href: "/markets",    label: "Markets",         icon: TrendingUp, desc: "Browse & search live markets",         color: "text-accent-cyan" },
  { href: "/wallets",    label: "Wallet Analysis",  icon: Wallet,     desc: "Track whale wallets by category",      color: "text-accent-green" },
  { href: "/copy-trade", label: "Copy Trading",     icon: Copy,       desc: "Mirror profitable traders",            color: "text-accent-yellow" },
  { href: "/weather",    label: "Weather Arb",      icon: CloudRain,  desc: "Weather-based market mispricings",     color: "text-accent-cyan" },
  { href: "/btc",        label: "BTC Arb",          icon: Bitcoin,    desc: "BTC price-lag arbitrage signals",      color: "text-accent-orange" },
  { href: "/bots",       label: "Custom Bots",      icon: Bot,        desc: "Rule-based automated strategies",      color: "text-accent-green" },
  { href: "/positions",  label: "Positions",        icon: BarChart3,  desc: "Open positions & P&L",                 color: "text-accent-yellow" },
];

export default function Dashboard() {
  const { tradingMode, balance } = useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="p-6">
      <Header title="Dashboard" />

      <div className={`mb-6 px-4 py-3 rounded border flex items-center gap-3 ${
        tradingMode === "paper"
          ? "bg-accent-yellow/5 border-accent-yellow/30 text-accent-yellow"
          : "bg-accent-green/5 border-accent-green/30 text-accent-green glow-green"
      }`}>
        <Circle className="w-2 h-2 fill-current" />
        <span className="text-xs font-bold tracking-widest uppercase">
          {tradingMode === "paper" ? "Paper Trading Mode" : "Live Trading Mode"}
        </span>
        <span className="ml-auto text-xs font-mono">
          Balance: ${mounted ? balance.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "---"}
        </span>
        <Link href="/settings" className="text-[10px] underline opacity-60 hover:opacity-100">
          Change in Settings →
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Portfolio Value",  value: mounted ? `$${balance.toLocaleString()}` : "---", sub: "paper balance" },
          { label: "Open Positions",   value: "0",     sub: "no active trades" },
          { label: "Active Strategies",value: "0",     sub: "bots / copy traders" },
          { label: "24h Realized P&L", value: "$0.00", sub: "paper mode" },
        ].map((s) => (
          <div key={s.label} className="bg-bg-secondary border border-border rounded p-4">
            <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">{s.label}</div>
            <div className="text-text-primary text-lg font-mono font-semibold">{s.value}</div>
            <div className="text-text-muted text-[10px] mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="mb-2 text-text-muted text-[10px] uppercase tracking-widest">Strategies & Tools</div>
      <div className="grid grid-cols-3 gap-3">
        {strategies.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}
              className="bg-bg-secondary border border-border rounded p-4 hover:border-accent-cyan/40 hover:bg-bg-tertiary transition-colors group">
              <div className="flex items-center justify-between mb-2">
                <Icon className={`w-5 h-5 ${s.color}`} />
                <ArrowUpRight className="w-3 h-3 text-text-muted group-hover:text-accent-cyan transition-colors" />
              </div>
              <div className="text-text-primary text-sm font-semibold mb-0.5">{s.label}</div>
              <div className="text-text-muted text-[10px]">{s.desc}</div>
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        <div className="text-text-muted text-[10px] uppercase tracking-widest mb-3">Recent Activity</div>
        <div className="bg-bg-secondary border border-border rounded p-8 text-center">
          <Activity className="w-6 h-6 text-text-muted mx-auto mb-2" />
          <div className="text-text-muted text-xs">No activity yet. Start by scanning markets or enabling a strategy.</div>
        </div>
      </div>
    </div>
  );
}
