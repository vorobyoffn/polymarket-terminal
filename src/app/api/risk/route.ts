// Risk metrics endpoint — exposure, concentration, drawdown, circuit-breaker status

const DEFAULT_EOA = process.env.TRADING_ADDRESS || "0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0";

interface RawPosition {
  conditionId: string;
  title: string;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  curPrice: number;
  size: number;
  endDate: string;
  outcome: string;
  outcomeIndex: number;
  redeemable: boolean;
  negativeRisk: boolean;
}

interface PortfolioSnapshot {
  timestamp: string;
  totalCurrent: number;
  totalInitial: number;
  totalPnl: number;
  positionCount: number;
}

function extractCity(title: string): string {
  const cities = [
    "New York City", "New York", "Chicago", "Miami", "Los Angeles", "Toronto", "Paris", "London",
    "Moscow", "Berlin", "Madrid", "Rome", "Istanbul", "Ankara", "Seoul", "Tokyo", "Beijing",
    "Shanghai", "Shenzhen", "Singapore", "Taipei", "Hong Kong", "Chengdu", "Chongqing",
    "Sydney", "Melbourne", "Mumbai", "Delhi", "Milan", "Wellington", "Wuhan", "Bangkok"
  ];
  for (const c of cities) {
    if (title.includes(c)) return c === "New York City" ? "NYC" : c;
  }
  return "Other";
}

function extractStrategy(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("temperature")) return "Weather";
  if (/bitcoin|btc|microstrategy|eth/.test(t)) return "Crypto";
  return "Other";
}

async function loadSnapshots(): Promise<PortfolioSnapshot[]> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), "data/portfolio-snapshots");
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const snapshots: PortfolioSnapshot[] = [];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, f), "utf8");
        const s = JSON.parse(raw) as PortfolioSnapshot;
        if (s.timestamp && new Date(s.timestamp).getTime() >= weekAgo) {
          snapshots.push(s);
        }
      } catch { /* skip bad file */ }
    }
    snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return snapshots;
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const queryAddr = url.searchParams.get("address");
    const eoa = queryAddr && /^0x[a-fA-F0-9]{40}$/.test(queryAddr) ? queryAddr : DEFAULT_EOA;

    // Fetch positions
    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15000);
      const r = https.get(
        `https://data-api.polymarket.com/positions?user=${eoa}&sizeThreshold=0`,
        { family: 4 },
        (res) => {
          let d = "";
          res.on("data", (c: Buffer) => { d += c.toString(); });
          res.on("end", () => { clearTimeout(timer); resolve(d); });
        }
      );
      r.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const all = JSON.parse(data) as RawPosition[];
    // Only count OPEN positions (not resolved, has value)
    const open = all.filter(p => p.currentValue > 0.01 && p.curPrice > 0.01 && p.curPrice < 0.99);

    const totalCost = open.reduce((s, p) => s + p.initialValue, 0);
    const totalValue = open.reduce((s, p) => s + p.currentValue, 0);
    const totalPnl = totalValue - totalCost;

    // ── Exposure by city ──
    const cityMap = new Map<string, { city: string; totalCost: number; totalValue: number; posCount: number }>();
    for (const p of open) {
      const city = extractCity(p.title);
      const existing = cityMap.get(city) || { city, totalCost: 0, totalValue: 0, posCount: 0 };
      existing.totalCost += p.initialValue;
      existing.totalValue += p.currentValue;
      existing.posCount += 1;
      cityMap.set(city, existing);
    }
    const byCity = Array.from(cityMap.values()).sort((a, b) => b.totalCost - a.totalCost);

    // ── Exposure by expiry ──
    const expiryMap = new Map<string, { date: string; totalCost: number; posCount: number }>();
    for (const p of open) {
      const date = p.endDate?.slice(0, 10) || "unknown";
      const existing = expiryMap.get(date) || { date, totalCost: 0, posCount: 0 };
      existing.totalCost += p.initialValue;
      existing.posCount += 1;
      expiryMap.set(date, existing);
    }
    const byExpiry = Array.from(expiryMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // ── Exposure by strategy ──
    const stratMap = new Map<string, { name: string; totalCost: number; totalValue: number; posCount: number; winnersCount: number }>();
    for (const p of open) {
      const name = extractStrategy(p.title);
      const existing = stratMap.get(name) || { name, totalCost: 0, totalValue: 0, posCount: 0, winnersCount: 0 };
      existing.totalCost += p.initialValue;
      existing.totalValue += p.currentValue;
      existing.posCount += 1;
      if (p.cashPnl > 0) existing.winnersCount += 1;
      stratMap.set(name, existing);
    }
    const byStrategy = Array.from(stratMap.values()).sort((a, b) => b.totalCost - a.totalCost);

    // ── Concentration warnings ──
    const warnings: string[] = [];
    if (totalCost > 0) {
      for (const c of byCity) {
        const pct = c.totalCost / totalCost;
        if (pct >= 0.40) {
          warnings.push(`${c.city}: ${(pct * 100).toFixed(0)}% of portfolio (${c.posCount} positions)`);
        }
      }
      for (const d of byExpiry) {
        const pct = d.totalCost / totalCost;
        if (pct >= 0.50) {
          warnings.push(`${d.date}: ${(pct * 100).toFixed(0)}% of portfolio expires same day`);
        }
      }
    }

    // ── Drawdown from snapshots ──
    const snapshots = await loadSnapshots();
    let peak = totalValue;
    let drawdownAbsolute = 0;
    let drawdownPercent = 0;
    let maxDdAllTime = 0;
    if (snapshots.length > 0) {
      const values = snapshots.map(s => s.totalCurrent);
      peak = Math.max(...values, totalValue);
      drawdownAbsolute = Math.max(0, peak - totalValue);
      drawdownPercent = peak > 0 ? (drawdownAbsolute / peak) * 100 : 0;
      // All-time max drawdown within snapshots
      let runningPeak = 0;
      for (const v of values) {
        runningPeak = Math.max(runningPeak, v);
        maxDdAllTime = Math.max(maxDdAllTime, runningPeak - v);
      }
    }

    // ── Worst case: all open positions resolve NO (lose everything invested) ──
    // vs all resolve YES (potential payout = size × $1 per share)
    const potentialPayout = open.reduce((s, p) => s + p.size, 0); // $1 per share if won
    const worstCase = {
      ifAllLose: -totalValue,            // lose current market value
      ifAllWin: potentialPayout - totalCost, // gain if every position hits
      netExposureAtRisk: totalValue,
    };

    // ── Circuit breakers — query local bot state ──
    let circuitBreakers: {
      botRunning: boolean;
      dailySpent: number;
      dailyCap: number;
      allocationUsed: number;
      allocationCap: number;
      lossLimit: number | null;
    } = {
      botRunning: false,
      dailySpent: 0,
      dailyCap: 0.50 * 562,
      allocationUsed: 0,
      allocationCap: 0.50 * 562,
      lossLimit: null,
    };
    interface RecentExit {
      timestamp: string;
      market: string;
      direction: string;
      reason: string;
      size: number;
      edge: number;
      prob: number;
    }
    let recentExits: RecentExit[] = [];
    let autoExit: {
      enabled: boolean;
      edgeThreshold: number;
      probThreshold: number;
    } = { enabled: false, edgeThreshold: -0.08, probThreshold: 0.05 };

    try {
      const self = await fetch(`${url.origin}/api/auto-trade`, { cache: "no-store" });
      if (self.ok) {
        const state = await self.json() as {
          running: boolean;
          bankroll: number;
          trades: Array<{
            timestamp: string; size: number; status: string; direction?: string;
            marketQuestion?: string; exitReason?: string; theoreticalProb?: number; edge?: number;
            shares?: number;
          }>;
          lossLimit?: number | null;
          autoExitEnabled?: boolean;
          autoExitEdgeThreshold?: number;
          autoExitProbThreshold?: number;
        };
        const now = Date.now();
        const dailySpent = (state.trades || [])
          .filter(t => new Date(t.timestamp).getTime() > now - 24 * 60 * 60 * 1000)
          .filter(t => !t.direction || t.direction.startsWith("BUY_"))
          .reduce((s, t) => s + (t.size || 0), 0);
        const allocationUsed = (state.trades || [])
          .filter(t => t.status === "open" || t.status === "pending")
          .filter(t => !t.direction || t.direction.startsWith("BUY_"))
          .reduce((s, t) => s + (t.size || 0), 0);
        circuitBreakers = {
          botRunning: state.running,
          dailySpent: Math.round(dailySpent * 100) / 100,
          dailyCap: Math.round(state.bankroll * 0.50 * 100) / 100,
          allocationUsed: Math.round(allocationUsed * 100) / 100,
          allocationCap: Math.round(state.bankroll * 0.50 * 100) / 100,
          lossLimit: state.lossLimit ?? null,
        };
        autoExit = {
          enabled: state.autoExitEnabled ?? false,
          edgeThreshold: state.autoExitEdgeThreshold ?? -0.08,
          probThreshold: state.autoExitProbThreshold ?? 0.05,
        };
        // Collect recent SELL trades (last 24h)
        recentExits = (state.trades || [])
          .filter(t => t.direction?.startsWith("SELL_"))
          .filter(t => new Date(t.timestamp).getTime() > now - 24 * 60 * 60 * 1000)
          .map(t => ({
            timestamp: t.timestamp,
            market: (t.marketQuestion || "").slice(0, 70),
            direction: t.direction || "",
            reason: t.exitReason || "manual",
            size: t.size || 0,
            edge: t.edge || 0,
            prob: t.theoreticalProb || 0,
          }))
          .slice(-20); // last 20
      }
    } catch { /* silent */ }

    return Response.json({
      exposure: {
        total: Math.round(totalCost * 100) / 100,
        totalValue: Math.round(totalValue * 100) / 100,
        totalPnl: Math.round(totalPnl * 100) / 100,
        positionCount: open.length,
        byCity,
        byExpiry,
        byStrategy,
        concentrationWarnings: warnings,
      },
      drawdown: {
        peak: Math.round(peak * 100) / 100,
        current: Math.round(totalValue * 100) / 100,
        absolute: Math.round(drawdownAbsolute * 100) / 100,
        percent: Math.round(drawdownPercent * 10) / 10,
        maxDrawdownAllTime: Math.round(maxDdAllTime * 100) / 100,
        snapshotCount: snapshots.length,
      },
      worstCase: {
        ifAllLose: Math.round(worstCase.ifAllLose * 100) / 100,
        ifAllWin: Math.round(worstCase.ifAllWin * 100) / 100,
        netExposureAtRisk: Math.round(worstCase.netExposureAtRisk * 100) / 100,
      },
      circuitBreakers,
      autoExit,
      recentExits,
      equityCurve: snapshots.map(s => ({
        timestamp: s.timestamp,
        value: Math.round(s.totalCurrent * 100) / 100,
        pnl: Math.round(s.totalPnl * 100) / 100,
      })),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
