"use client";
import { useStore } from "@/lib/store";
import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  const { tradingMode, hideBalances, setHideBalances } = useStore();
  const [time, setTime] = useState("");

  // Keep <body> class in sync with toggle so CSS can find elements to blur
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.classList.toggle("hide-balances", hideBalances);
    }
  }, [hideBalances]);

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="px-6 py-4 border-b border-border flex items-center justify-between">
      <div>
        {title && <h1 className="text-text-primary text-sm font-semibold">{title}</h1>}
        {subtitle && <p className="text-text-muted text-[10px] mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        {actions}
        <button
          onClick={() => setHideBalances(!hideBalances)}
          title={hideBalances ? "Show balances" : "Hide balances (blur $ amounts)"}
          className={`p-1.5 rounded border transition-colors ${
            hideBalances
              ? "bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow"
              : "border-border text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          {hideBalances ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <div className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
          tradingMode === "paper"
            ? "bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20"
            : "bg-accent-green/10 text-accent-green border border-accent-green/20 glow-green"
        }`}>
          {tradingMode === "paper" ? "PAPER" : "LIVE"}
        </div>
        <div className="text-text-muted text-[10px] font-mono">{time}</div>
      </div>
    </div>
  );
}
