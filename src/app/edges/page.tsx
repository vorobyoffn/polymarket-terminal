"use client";

import Header from "@/components/layout/Header";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Gauge, RefreshCw, CheckCircle, XCircle, Search, TrendingUp, TrendingDown,
  ChevronUp, ChevronDown,
} from "lucide-react";

interface EligibilityLayer { pass: boolean; reason: string }
interface EdgeRow {
  city: string;
  date: string;
  targetTemp: number;
  targetType: "exact" | "above" | "below" | "range";
  unit: "C" | "F";
  marketQuestion: string;
  marketId: string;
  marketPrice: number;
  forecastProb: number;
  forecastHigh: number;
  edge: number;
  direction: "BUY_YES" | "BUY_NO";
  confidence: number;
  daysToExpiry: number;
  volume24h: number;
  lor: number;
  significance: number;
  payoffRatio: number;
  score: number;
  entryPrice: number;
  eligibility: {
    tradeable: boolean;
    blockedByLayer: 1 | 2 | 3 | 4 | 5 | null;
    blockedReason: string | null;
    layerChecks: {
      time: EligibilityLayer;
      edgeQuality: EligibilityLayer;
      priceZone: EligibilityLayer;
      confidence: EligibilityLayer;
      strategy: EligibilityLayer;
    };
  };
}

interface EdgeResponse {
  scannedAt: string;
  citiesScanned: number;
  marketsScanned: number;
  forecastsLoaded: number;
  total: number;
  tradeableCount: number;
  edges: EdgeRow[];
}

type SortKey = "score" | "edge" | "confidence" | "daysToExpiry" | "volume24h" | "city";
type SortDir = "asc" | "desc";
type EligibilityFilter = "all" | "tradeable" | "blocked" | "L1" | "L2" | "L3" | "L4" | "L5";
type DirectionFilter = "all" | "BUY_YES" | "BUY_NO";

function edgeColor(edge: number): string {
  if (edge >= 0.15) return "text-accent-green";
  if (edge >= 0.05) return "text-accent-yellow";
  return "text-text-muted";
}

function formatTarget(r: EdgeRow): string {
  const t = r.targetTemp;
  const u = r.unit === "F" ? "°F" : "°C";
  if (r.targetType === "above") return `≥${t}${u}`;
  if (r.targetType === "below") return `≤${t}${u}`;
  if (r.targetType === "range") return `${t}${u} band`;
  return `${t}${u}`;
}

export default function EdgesPage() {
  const [data, setData] = useState<EdgeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState<string>("All");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [eligibilityFilter, setEligibilityFilter] = useState<EligibilityFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/edges");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as EdgeResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    refresh(true);
    const id = setInterval(() => refresh(false), 60000);
    return () => clearInterval(id);
  }, [refresh]);

  const cities = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.edges.map(e => e.city))).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.edges;
    if (cityFilter !== "All") rows = rows.filter(r => r.city === cityFilter);
    if (directionFilter !== "all") rows = rows.filter(r => r.direction === directionFilter);
    if (eligibilityFilter === "tradeable") rows = rows.filter(r => r.eligibility.tradeable);
    if (eligibilityFilter === "blocked") rows = rows.filter(r => !r.eligibility.tradeable);
    if (/^L[1-5]$/.test(eligibilityFilter)) {
      const n = parseInt(eligibilityFilter.slice(1), 10);
      rows = rows.filter(r => r.eligibility.blockedByLayer === n);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r => r.marketQuestion.toLowerCase().includes(q) || r.city.toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "score": cmp = a.score - b.score; break;
        case "edge": cmp = a.edge - b.edge; break;
        case "confidence": cmp = a.confidence - b.confidence; break;
        case "daysToExpiry": cmp = a.daysToExpiry - b.daysToExpiry; break;
        case "volume24h": cmp = a.volume24h - b.volume24h; break;
        case "city": cmp = a.city.localeCompare(b.city); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data, cityFilter, directionFilter, eligibilityFilter, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  if (!data) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <Header title="Weather Edges" subtitle="Live forecasts vs Polymarket prices" />
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

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Weather Edges"
        subtitle={`${data.total} signals scanned \u00b7 ${data.citiesScanned} cities \u00b7 ${data.marketsScanned} markets`}
        actions={
          <button onClick={() => refresh(true)} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 disabled:opacity-40">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {/* ── Stats banner ── */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Signals</div>
          <div className="text-lg font-mono font-bold text-text-primary tnum">{data.total}</div>
        </div>
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Tradeable</div>
          <div className="text-lg font-mono font-bold text-accent-green tnum">{data.tradeableCount}</div>
        </div>
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Blocked</div>
          <div className="text-lg font-mono font-bold text-accent-red tnum">{data.total - data.tradeableCount}</div>
        </div>
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Cities</div>
          <div className="text-lg font-mono font-bold text-text-primary tnum">{data.citiesScanned}</div>
        </div>
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Last scan</div>
          <div className="text-[10px] font-mono text-text-primary tnum">{new Date(data.scannedAt).toLocaleTimeString()}</div>
          <div className="text-[9px] text-text-muted">Auto-refresh 60s</div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="px-6 py-2 border-b border-border flex items-center gap-2 overflow-x-auto text-xs flex-nowrap">
        <select value={cityFilter} onChange={e => setCityFilter(e.target.value)}
          className="px-2 py-1 bg-bg-tertiary border border-border rounded text-text-primary text-[10px]">
          <option>All</option>
          {cities.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={directionFilter} onChange={e => setDirectionFilter(e.target.value as DirectionFilter)}
          className="px-2 py-1 bg-bg-tertiary border border-border rounded text-text-primary text-[10px]">
          <option value="all">All sides</option>
          <option value="BUY_YES">BUY YES</option>
          <option value="BUY_NO">BUY NO</option>
        </select>
        <select value={eligibilityFilter} onChange={e => setEligibilityFilter(e.target.value as EligibilityFilter)}
          className="px-2 py-1 bg-bg-tertiary border border-border rounded text-text-primary text-[10px]">
          <option value="all">All eligibility</option>
          <option value="tradeable">Tradeable only</option>
          <option value="blocked">Blocked only</option>
          <option value="L1">Blocked: L1 Time</option>
          <option value="L2">Blocked: L2 Edge</option>
          <option value="L3">Blocked: L3 Price</option>
          <option value="L4">Blocked: L4 Confidence</option>
          <option value="L5">Blocked: L5 Strategy</option>
        </select>
        <div className="flex-1" />
        <div className="flex items-center gap-1 bg-bg-tertiary border border-border rounded px-2 py-1">
          <Search className="w-3 h-3 text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="bg-transparent outline-none text-text-primary text-[10px] w-32" />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
          {/* Header */}
          <div className="grid grid-cols-[120px_minmax(0,2fr)_90px_70px_70px_70px_70px_60px_90px] gap-2 px-4 py-2 border-b border-border sticky top-0 z-10 bg-bg-secondary text-[10px] text-text-muted uppercase tracking-wider min-w-[900px]">
            <SortBtn label="City" k="city" current={sortKey} dir={sortDir} onToggle={toggleSort} />
            <span>Market / Target</span>
            <span className="text-right">Side</span>
            <SortBtn label="Forecast" k="score" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
            <span className="text-right">Market</span>
            <SortBtn label="Edge" k="edge" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
            <SortBtn label="Conf" k="confidence" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
            <SortBtn label="Days" k="daysToExpiry" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
            <span className="text-center">Status</span>
          </div>

          {/* Rows */}
          {filtered.map((r, idx) => {
            const isExpanded = expandedIdx === idx;
            return (
              <div key={idx}>
                <div
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  className={`grid grid-cols-[120px_minmax(0,2fr)_90px_70px_70px_70px_70px_60px_90px] gap-2 px-4 py-2 items-center cursor-pointer hover:bg-bg-tertiary/30 text-xs min-w-[900px] border-b border-border ${idx % 2 === 1 ? "bg-bg-tertiary/10" : ""}`}
                >
                  <div className="text-text-primary text-xs font-medium truncate">{r.city}</div>
                  <div className="min-w-0">
                    <div className="text-text-primary text-[11px] truncate">{formatTarget(r)}</div>
                    <div className="text-text-muted text-[9px] truncate">{r.marketQuestion.slice(0, 60)}</div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                      r.direction === "BUY_YES"
                        ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                        : "bg-accent-red/10 text-accent-red border-accent-red/30"
                    }`}>{r.direction === "BUY_YES" ? "YES" : "NO"}</span>
                  </div>
                  <div className="text-right font-mono text-text-primary text-xs tnum">{(r.forecastProb * 100).toFixed(1)}%</div>
                  <div className="text-right font-mono text-text-primary text-xs tnum">{(r.marketPrice * 100).toFixed(1)}¢</div>
                  <div className={`text-right font-mono font-bold text-xs tnum ${edgeColor(r.edge)}`}>
                    {r.edge >= 0 ? "+" : ""}{(r.edge * 100).toFixed(1)}%
                  </div>
                  <div className="text-right font-mono text-text-muted text-[10px] tnum">
                    {"\u2605".repeat(r.significance)}{"\u2606".repeat(4 - r.significance)}
                  </div>
                  <div className="text-right font-mono text-text-primary text-[10px] tnum">{r.daysToExpiry}d</div>
                  <div className="text-center">
                    {r.eligibility.tradeable ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-accent-green/10 text-accent-green border-accent-green/40">
                        <CheckCircle className="w-2.5 h-2.5" /> TRADE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-accent-red/10 text-accent-red border-accent-red/40" title={r.eligibility.blockedReason || ""}>
                        <XCircle className="w-2.5 h-2.5" /> L{r.eligibility.blockedByLayer}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-6 py-3 bg-bg-tertiary/20 border-b border-border text-[10px] min-w-[900px]">
                    <div className="mb-2 text-text-primary text-[11px] font-medium">{r.marketQuestion}</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <Stat label="Forecast High" value={`${r.forecastHigh.toFixed(1)}${r.unit === "F" ? "°F" : "°C"}`} />
                      <Stat label="LOR" value={r.lor.toFixed(2)} />
                      <Stat label="Score" value={r.score.toFixed(4)} />
                      <Stat label="Payoff" value={`${r.payoffRatio.toFixed(2)}:1`} />
                    </div>
                    <div className="text-text-muted text-[10px] uppercase mb-1">Filter layer checks</div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <LayerChip n={1} name="Time" check={r.eligibility.layerChecks.time} />
                      <LayerChip n={2} name="Edge" check={r.eligibility.layerChecks.edgeQuality} />
                      <LayerChip n={3} name="Price" check={r.eligibility.layerChecks.priceZone} />
                      <LayerChip n={4} name="Conf" check={r.eligibility.layerChecks.confidence} />
                      <LayerChip n={5} name="Strategy" check={r.eligibility.layerChecks.strategy} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-6 py-8 text-center text-text-muted text-sm">No edges match filters</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-muted text-[9px] uppercase">{label}</div>
      <div className="font-mono text-text-primary text-[11px] tnum">{value}</div>
    </div>
  );
}

function LayerChip({ n, name, check }: { n: number; name: string; check: { pass: boolean; reason: string } }) {
  return (
    <div className={`p-2 rounded border text-[9px] ${
      check.pass
        ? "bg-accent-green/5 border-accent-green/20 text-text-primary"
        : "bg-accent-red/10 border-accent-red/30 text-text-primary"
    }`}>
      <div className="flex items-center gap-1 mb-0.5">
        {check.pass ? <CheckCircle className="w-3 h-3 text-accent-green" /> : <XCircle className="w-3 h-3 text-accent-red" />}
        <span className="font-bold uppercase tracking-wider">L{n} {name}</span>
      </div>
      <div className="text-text-muted text-[9px] leading-tight">{check.reason}</div>
    </div>
  );
}

function SortBtn({ label, k, current, dir, onToggle, align = "left" }: {
  label: string; k: SortKey; current: SortKey; dir: SortDir; onToggle: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = current === k;
  return (
    <button onClick={() => onToggle(k)}
      className={`flex items-center gap-0.5 font-normal uppercase tracking-wider text-[10px] ${align === "right" ? "justify-end" : ""} ${active ? "text-accent-cyan" : "text-text-muted hover:text-text-secondary"}`}
    >
      {label}
      {active && (dir === "desc" ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronUp className="w-2.5 h-2.5" />)}
    </button>
  );
}
