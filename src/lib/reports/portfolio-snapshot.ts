// Portfolio snapshot writer — called periodically by the auto-trader scan loop.
// Writes hourly JSON files to data/portfolio-snapshots/ for drawdown analysis.

const DEFAULT_EOA = process.env.TRADING_ADDRESS || "0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0";

export interface PortfolioSnapshot {
  timestamp: string;
  totalCurrent: number;
  totalInitial: number;
  totalPnl: number;
  positionCount: number;
  address: string;
}

let lastSnapshotHour: string | null = null;

/**
 * Writes one snapshot per hour (deduplicated by YYYY-MM-DDTHH key).
 * Cheap enough to call on every auto-trader scan (1/60s).
 */
export async function maybeWritePortfolioSnapshot(): Promise<void> {
  try {
    const now = new Date();
    const hourKey = now.toISOString().slice(0, 13); // "2026-04-19T20"
    if (hourKey === lastSnapshotHour) return;

    const address = DEFAULT_EOA;
    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 10000);
      const r = https.get(
        `https://data-api.polymarket.com/positions?user=${address}&sizeThreshold=0`,
        { family: 4 },
        (res) => {
          let d = "";
          res.on("data", (c: Buffer) => { d += c.toString(); });
          res.on("end", () => { clearTimeout(timer); resolve(d); });
        }
      );
      r.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const all = JSON.parse(data) as Array<{
      currentValue: number; initialValue: number; cashPnl: number; curPrice: number;
    }>;
    const open = all.filter(p => p.currentValue > 0.01 && p.curPrice > 0.01 && p.curPrice < 0.99);
    const totalCurrent = open.reduce((s, p) => s + p.currentValue, 0);
    const totalInitial = open.reduce((s, p) => s + p.initialValue, 0);
    const totalPnl = totalCurrent - totalInitial;

    const snapshot: PortfolioSnapshot = {
      timestamp: now.toISOString(),
      totalCurrent: Math.round(totalCurrent * 100) / 100,
      totalInitial: Math.round(totalInitial * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      positionCount: open.length,
      address,
    };

    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), "data/portfolio-snapshots");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `snapshot_${hourKey.replace(":", "")}.json`);
    await fs.writeFile(file, JSON.stringify(snapshot, null, 2));

    lastSnapshotHour = hourKey;
    console.log(`[PortfolioSnapshot] Wrote ${file} — value=$${totalCurrent.toFixed(2)} pnl=$${totalPnl.toFixed(2)}`);
  } catch (err) {
    console.error("[PortfolioSnapshot] Failed:", err instanceof Error ? err.message : err);
  }
}
