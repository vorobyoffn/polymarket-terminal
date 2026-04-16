// Price Snapshot Recorder — captures real Polymarket prices every scan cycle
// Builds a historical dataset for backtesting against ACTUAL market prices

import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data", "price-snapshots");
const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

async function httpGet<T>(url: string, timeoutMs = 30000): Promise<T> {
  const https = await import("node:https");
  const dns = await import("node:dns");
  dns.setDefaultResultOrder("ipv4first");

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const req = https.get(url, { family: 4 }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => {
        clearTimeout(timer);
        if (res.statusCode && res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data) as T); } catch { reject(new Error("parse")); }
      });
    });
    req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
  });
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface PriceSnapshot {
  timestamp: string;        // ISO timestamp
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  liquidity: number;
  endDate: string;
  city?: string;            // for weather markets
  targetTemp?: number;
  targetType?: string;
}

export interface SnapshotBatch {
  timestamp: string;
  source: string;
  marketCount: number;
  weatherCount: number;
  snapshots: PriceSnapshot[];
}

// ── City detection ──────────────────────────────────────────────────────────

const CITIES = [
  "seoul", "tokyo", "london", "new york", "singapore", "paris", "moscow",
  "toronto", "chicago", "milan", "sydney", "hong kong", "berlin", "mumbai",
  "ankara", "taipei", "chongqing", "chengdu", "wuhan", "wellington",
  "shanghai", "los angeles", "miami", "bangkok", "beijing",
];

function detectCity(question: string): string | undefined {
  const q = question.toLowerCase();
  for (const city of CITIES) {
    if (q.includes(city)) return city;
  }
  return undefined;
}

function parseTemp(question: string): { temp: number; type: string } | undefined {
  const q = question.toLowerCase();
  // "be 22°C on" → exact 22
  const exact = q.match(/be\s+(\d+)[°]?[cf]?\s+on/);
  if (exact) return { temp: parseInt(exact[1]), type: "exact" };
  // "be 24°C or higher"
  const above = q.match(/(\d+)[°]?[cf]?\s+or\s+higher/);
  if (above) return { temp: parseInt(above[1]), type: "above" };
  // "be 14°C or below"
  const below = q.match(/(\d+)[°]?[cf]?\s+or\s+below/);
  if (below) return { temp: parseInt(below[1]), type: "below" };
  // "between 72-73°F"
  const range = q.match(/between\s+(\d+)[-–](\d+)/);
  if (range) return { temp: (parseInt(range[1]) + parseInt(range[2])) / 2, type: "range" };
  return undefined;
}

// ── Recorder ────────────────────────────────────────────────────────────────

export async function recordPriceSnapshot(): Promise<SnapshotBatch> {
  // Ensure data directory exists
  await fs.mkdir(DATA_DIR, { recursive: true });

  // Fetch all active events
  const rawEvents = await httpGet<Record<string, unknown>[]>(
    `${GAMMA_API}/events?active=true&closed=false&limit=500&order=volume24hr&ascending=false`,
    45000
  );

  const snapshots: PriceSnapshot[] = [];
  const now = new Date().toISOString();
  let weatherCount = 0;

  for (const event of (rawEvents || [])) {
    const markets = (event.markets as Record<string, unknown>[]) || [];
    for (const m of markets) {
      if (m.closed || !m.active) continue;

      const question = (m.question as string) || "";
      const endDate = (m.endDate as string) || (event.endDate as string) || "";

      // Parse prices
      let yesPrice = 0;
      let noPrice = 0;
      try {
        const prices = JSON.parse((m.outcomePrices as string) || "[]") as string[];
        yesPrice = parseFloat(prices[0] || "0");
        noPrice = parseFloat(prices[1] || "0");
      } catch { continue; }

      if (yesPrice < 0.001 && noPrice < 0.001) continue;

      const snapshot: PriceSnapshot = {
        timestamp: now,
        marketId: (m.id as string) || "",
        question,
        yesPrice: Math.round(yesPrice * 10000) / 10000,
        noPrice: Math.round(noPrice * 10000) / 10000,
        volume24h: (m.volume24hr as number) || 0,
        liquidity: (m.liquidityNum as number) || 0,
        endDate,
      };

      // Check if it's a weather/temperature market
      const q = question.toLowerCase();
      if (/highest temperature|lowest temperature|°c|°f/.test(q)) {
        snapshot.city = detectCity(question);
        const tempInfo = parseTemp(question);
        if (tempInfo) {
          snapshot.targetTemp = tempInfo.temp;
          snapshot.targetType = tempInfo.type;
        }
        weatherCount++;
      }

      snapshots.push(snapshot);
    }
  }

  const batch: SnapshotBatch = {
    timestamp: now,
    source: "gamma-api",
    marketCount: snapshots.length,
    weatherCount,
    snapshots,
  };

  // Save to file — one file per hour to avoid too many files
  const hour = now.slice(0, 13).replace(/[:-]/g, ""); // "2026041322"
  const filename = `snapshot_${hour}.json`;
  const filepath = path.join(DATA_DIR, filename);

  // Append to existing file or create new
  let existing: SnapshotBatch[] = [];
  try {
    const raw = await fs.readFile(filepath, "utf8");
    existing = JSON.parse(raw) as SnapshotBatch[];
  } catch { /* file doesn't exist yet */ }

  existing.push(batch);
  await fs.writeFile(filepath, JSON.stringify(existing, null, 2));

  console.log(`[PriceRecorder] Saved ${snapshots.length} markets (${weatherCount} weather) to ${filename}`);
  return batch;
}

// ── Read historical snapshots ───────────────────────────────────────────────

export async function getRecordedSnapshots(daysBack = 7): Promise<SnapshotBatch[]> {
  const allBatches: SnapshotBatch[] = [];

  try {
    const files = await fs.readdir(DATA_DIR);
    const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString();

    for (const file of files.sort()) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
        const batches = JSON.parse(raw) as SnapshotBatch[];
        for (const batch of batches) {
          if (batch.timestamp >= cutoff) allBatches.push(batch);
        }
      } catch { /* corrupt file, skip */ }
    }
  } catch { /* dir doesn't exist yet */ }

  return allBatches;
}

// ── Get weather market price history for a specific market ──────────────────

export async function getWeatherPriceHistory(marketId: string, daysBack = 7): Promise<{
  timestamp: string;
  yesPrice: number;
}[]> {
  const batches = await getRecordedSnapshots(daysBack);
  const history: { timestamp: string; yesPrice: number }[] = [];

  for (const batch of batches) {
    const snap = batch.snapshots.find(s => s.marketId === marketId);
    if (snap) {
      history.push({ timestamp: batch.timestamp, yesPrice: snap.yesPrice });
    }
  }

  return history;
}

// ── Stats on recorded data ──────────────────────────────────────────────────

export async function getRecordingStats(): Promise<{
  totalSnapshots: number;
  totalBatches: number;
  oldestSnapshot: string;
  newestSnapshot: string;
  weatherMarketsTracked: number;
  uniqueMarkets: number;
  fileCount: number;
  diskUsageKb: number;
}> {
  const batches = await getRecordedSnapshots(90);

  const uniqueMarkets = new Set<string>();
  const weatherMarkets = new Set<string>();

  for (const batch of batches) {
    for (const snap of batch.snapshots) {
      uniqueMarkets.add(snap.marketId);
      if (snap.city) weatherMarkets.add(snap.marketId);
    }
  }

  let fileCount = 0;
  let diskUsage = 0;
  try {
    const files = await fs.readdir(DATA_DIR);
    fileCount = files.filter(f => f.endsWith(".json")).length;
    for (const file of files) {
      const stat = await fs.stat(path.join(DATA_DIR, file));
      diskUsage += stat.size;
    }
  } catch { /* dir doesn't exist */ }

  return {
    totalSnapshots: batches.reduce((s, b) => s + b.snapshots.length, 0),
    totalBatches: batches.length,
    oldestSnapshot: batches[0]?.timestamp || "none",
    newestSnapshot: batches[batches.length - 1]?.timestamp || "none",
    weatherMarketsTracked: weatherMarkets.size,
    uniqueMarkets: uniqueMarkets.size,
    fileCount,
    diskUsageKb: Math.round(diskUsage / 1024),
  };
}
