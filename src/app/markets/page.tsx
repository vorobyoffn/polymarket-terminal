"use client";

import Header from "@/components/layout/Header";
import {
  TrendingUp, TrendingDown, Search, RefreshCw, Filter,
  Clock, DollarSign, BarChart2, ExternalLink, ChevronDown,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import type { PolymarketEvent, PolymarketMarket } from "@/lib/polymarket/types";

type SortKey = "volume" | "liquidity" | "newest" | "ending";
type Category = "all" | "crypto" | "politics" | "sports" | "science" | "culture";

function parseOutcomePrices(market: PolymarketMarket): { yes: number; no: number } | null {
  try {
    const raw = market.outcomePrices as unknown as string;
    const prices = JSON.parse(raw || "[]") as string[];
    const yes = parseFloat(prices[0] || "0");
    const no = parseFloat(prices[1] || "0");
    return yes > 0 ? { yes, no } : null;
  } catch { return null; }
}

function PriceBar({ yes }: { yes: number }) {
  const pct = Math.round(yes * 100);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 bg-bg-tertiary rounded-full overflow-hidden flex">
        <div className="h-full bg-accent-green rounded-l-full transition-all" style={{ width: `${pct}%` }} />
        <div className="h-full bg-accent-red rounded-r-full transition-all" style={{ width: `${100 - pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-accent-green w-8 text-right">{pct}¢</span>
    </div>
  );
}

export default function MarketsPage() {
  const [events, setEvents] = useState<PolymarketEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [category, setCategory] = useState<Category>("all");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/markets?limit=200");
      if (res.ok) {
        const data = await res.json() as PolymarketEvent[];
        setEvents(data);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchMarkets(); }, [fetchMarkets]);

  const allMarkets = events.flatMap((e) =>
    (e.markets || []).map((m) => ({ ...m, eventTitle: e.title, eventSlug: e.slug, eventEndDate: e.endDate }))
  );

  const filtered = allMarkets.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      if (!m.question?.toLowerCase().includes(q) && !m.eventTitle?.toLowerCase().includes(q)) return false;
    }
    if (category !== "all") {
      const q = (m.question || "").toLowerCase() + " " + (m.eventTitle || "").toLowerCase();
      if (category === "crypto" && !/bitcoin|btc|eth|crypto|solana|token/.test(q)) return false;
      if (category === "politics" && !/president|election|trump|biden|congress|senate|vote/.test(q)) return false;
      if (category === "sports" && !/nba|nfl|mlb|soccer|game|match|championship|team/.test(q)) return false;
      if (category === "science" && !/climate|weather|temperature|space|nasa|ai |artificial/.test(q)) return false;
      if (category === "culture" && !/movie|oscar|grammy|music|celebrity|box office/.test(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "volume") return (b.volumeNum || 0) - (a.volumeNum || 0);
    if (sortKey === "liquidity") return (b.liquidityNum || 0) - (a.liquidityNum || 0);
    if (sortKey === "ending") {
      const da = new Date(a.endDate || a.eventEndDate || "").getTime();
      const db = new Date(b.endDate || b.eventEndDate || "").getTime();
      return da - db;
    }
    return 0;
  });

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Markets"
        subtitle={`${allMarkets.length} active markets from Polymarket`}
        actions={
          <button onClick={fetchMarkets} disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors disabled:opacity-40">
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        }
      />

      {/* Search + Filters */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets..."
            className="w-full bg-bg-tertiary border border-border rounded pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-text-muted" />
          {(["all", "crypto", "politics", "sports", "science", "culture"] as Category[]).map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={`text-[10px] px-2 py-0.5 rounded capitalize transition-colors ${
                category === c ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30" : "text-text-muted hover:text-text-secondary"
              }`}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[10px] text-text-muted uppercase">Sort:</span>
          {(["volume", "liquidity", "ending"] as SortKey[]).map((k) => (
            <button key={k} onClick={() => setSortKey(k)}
              className={`text-[10px] px-2 py-0.5 rounded capitalize transition-colors ${
                sortKey === k ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30" : "text-text-muted hover:text-text-secondary"
              }`}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="px-6 py-2 border-b border-border grid grid-cols-4 gap-4 bg-bg-secondary">
        {[
          { label: "Total Markets", value: allMarkets.length, icon: BarChart2 },
          { label: "Showing", value: sorted.length, icon: Filter },
          { label: "Total Volume", value: `$${(allMarkets.reduce((s, m) => s + (m.volumeNum || 0), 0) / 1e6).toFixed(1)}M`, icon: DollarSign },
          { label: "Total Liquidity", value: `$${(allMarkets.reduce((s, m) => s + (m.liquidityNum || 0), 0) / 1e6).toFixed(1)}M`, icon: TrendingUp },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex flex-col">
            <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5">
              <Icon className="w-2.5 h-2.5" />{label}
            </div>
            <div className="text-text-primary text-sm font-mono font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {/* Table header */}
      <div className="px-6 py-2 border-b border-border grid grid-cols-[3fr_1.5fr_1fr_1fr_0.8fr_0.5fr] gap-3 text-[10px] text-text-muted uppercase tracking-wider">
        <span>Market</span>
        <span>Yes / No</span>
        <span>Volume</span>
        <span>Liquidity</span>
        <span>Expires</span>
        <span></span>
      </div>

      {/* Market rows */}
      {loading && sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="w-6 h-6 text-accent-cyan animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sorted.slice(0, 200).map((market) => {
            const prices = parseOutcomePrices(market as PolymarketMarket);
            const vol = market.volumeNum || 0;
            const liq = market.liquidityNum || 0;
            const endDate = market.endDate || market.eventEndDate || "";
            const daysLeft = endDate ? Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000) : null;

            return (
              <div key={market.id || market.question}
                className="px-6 py-3 border-b border-border grid grid-cols-[3fr_1.5fr_1fr_1fr_0.8fr_0.5fr] gap-3 items-center hover:bg-bg-tertiary/40 transition-colors">
                <div className="min-w-0">
                  <div className="text-text-primary text-xs font-medium truncate">{market.question}</div>
                  {market.oneDayPriceChange !== undefined && market.oneDayPriceChange !== 0 && (
                    <div className={`text-[10px] font-mono mt-0.5 flex items-center gap-1 ${market.oneDayPriceChange > 0 ? "text-accent-green" : "text-accent-red"}`}>
                      {market.oneDayPriceChange > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      {market.oneDayPriceChange > 0 ? "+" : ""}{(market.oneDayPriceChange * 100).toFixed(1)}% 24h
                    </div>
                  )}
                </div>
                <div className="w-full">
                  {prices ? <PriceBar yes={prices.yes} /> : <span className="text-text-muted text-[10px]">—</span>}
                </div>
                <div className="text-xs font-mono text-text-primary">
                  {vol >= 1e6 ? `$${(vol / 1e6).toFixed(1)}M` : vol >= 1e3 ? `$${(vol / 1e3).toFixed(0)}K` : `$${vol.toFixed(0)}`}
                </div>
                <div className="text-xs font-mono text-text-secondary">
                  {liq >= 1e6 ? `$${(liq / 1e6).toFixed(1)}M` : liq >= 1e3 ? `$${(liq / 1e3).toFixed(0)}K` : `$${liq.toFixed(0)}`}
                </div>
                <div className="text-xs font-mono text-text-muted flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {daysLeft !== null ? (daysLeft <= 0 ? "Ended" : `${daysLeft}d`) : "—"}
                </div>
                <a href={`https://polymarket.com/event/${market.eventSlug || ""}`} target="_blank" rel="noopener noreferrer"
                  className="text-text-muted hover:text-accent-cyan transition-colors">
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
