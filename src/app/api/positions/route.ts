// Fetch real positions and trade history from Polymarket CLOB
import { Wallet } from "ethers";

const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";
const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

async function getClobClient() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("No PRIVATE_KEY");

  const { ClobClient } = await import("@polymarket/clob-client");
  const normalizedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
  const wallet = new Wallet(normalizedKey);

  const creds = {
    key: process.env.CLOB_API_KEY || "",
    secret: process.env.CLOB_API_SECRET || "",
    passphrase: process.env.CLOB_API_PASSPHRASE || "",
  };

  if (!creds.key || !creds.secret) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tmpClient = new ClobClient(CLOB_API, 137, wallet as any);
    const derived = await tmpClient.createOrDeriveApiKey();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = derived as any;
    creds.key = d.key || d.apiKey || "";
    creds.secret = d.secret || "";
    creds.passphrase = d.passphrase || "";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ClobClient(CLOB_API, 137, wallet as any, creds as any, 0);
}

// Cache market names by token ID
const marketNameCache = new Map<string, string>();

async function getMarketName(tokenId: string): Promise<string> {
  if (marketNameCache.has(tokenId)) return marketNameCache.get(tokenId)!;
  try {
    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 10000);
      const req = https.get(`${GAMMA_API}/markets?clobTokenIds=${tokenId}&limit=1`, { family: 4 }, (res) => {
        let d = "";
        res.on("data", (c: Buffer) => { d += c.toString(); });
        res.on("end", () => { clearTimeout(timer); resolve(d); });
      });
      req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const markets = JSON.parse(data);
    if (Array.isArray(markets) && markets.length > 0) {
      const name = markets[0].question || "Unknown";
      marketNameCache.set(tokenId, name);
      return name;
    }
  } catch { /* silent */ }
  return "Unknown Market";
}

export async function GET() {
  try {
    const client = await getClobClient();

    // Get open orders
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let openOrders: any[] = [];
    try {
      openOrders = await client.getOpenOrders();
      if (!Array.isArray(openOrders)) openOrders = [];
    } catch { openOrders = []; }

    // Get trade history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let trades: any[] = [];
    try {
      trades = await client.getTrades();
      if (!Array.isArray(trades)) trades = [];
    } catch { trades = []; }

    // Resolve market names for recent trades (first 30)
    const recentTrades = trades.slice(0, 50);
    const tokenIds = [...new Set(recentTrades.map((t: { asset_id?: string }) => t.asset_id).filter(Boolean))];

    // Fetch market names in parallel (max 10 at a time)
    const names = new Map<string, string>();
    for (let i = 0; i < tokenIds.length; i += 10) {
      const batch = tokenIds.slice(i, i + 10);
      const results = await Promise.allSettled(batch.map((id) => getMarketName(id as string)));
      results.forEach((r, idx) => {
        names.set(batch[idx] as string, r.status === "fulfilled" ? r.value : "Unknown");
      });
    }

    // Build positions from trade history (group by token)
    const positionMap = new Map<string, {
      tokenId: string;
      marketName: string;
      side: string;
      totalShares: number;
      totalCost: number;
      avgPrice: number;
      trades: number;
      firstTrade: string;
      lastTrade: string;
    }>();

    for (const t of trades) {
      const tokenId = t.asset_id || "";
      const size = parseFloat(t.size || "0");
      const price = parseFloat(t.price || "0");
      const shares = size / price;

      if (!positionMap.has(tokenId)) {
        positionMap.set(tokenId, {
          tokenId,
          marketName: names.get(tokenId) || "Unknown Market",
          side: t.side,
          totalShares: 0,
          totalCost: 0,
          avgPrice: 0,
          trades: 0,
          firstTrade: t.match_time || "",
          lastTrade: t.match_time || "",
        });
      }

      const pos = positionMap.get(tokenId)!;
      if (t.side === "BUY") {
        pos.totalShares += shares;
        pos.totalCost += size;
      } else {
        pos.totalShares -= shares;
        pos.totalCost -= size;
      }
      pos.trades++;
      pos.lastTrade = t.match_time || pos.lastTrade;
      pos.avgPrice = pos.totalShares > 0 ? pos.totalCost / pos.totalShares : 0;
    }

    const positions = [...positionMap.values()]
      .filter((p) => Math.abs(p.totalShares) > 0.01)
      .sort((a, b) => b.totalCost - a.totalCost);

    // Format trades for frontend
    const formattedTrades = recentTrades.map((t: Record<string, string>) => ({
      id: t.id || "",
      side: t.side || "",
      size: parseFloat(t.size || "0"),
      price: parseFloat(t.price || "0"),
      tokenId: (t.asset_id || "").slice(0, 20),
      marketName: names.get(t.asset_id || "") || "Unknown",
      timestamp: t.match_time || "",
      status: t.status || "",
    }));

    // Summary stats
    const totalInvested = positions.reduce((s, p) => s + Math.max(p.totalCost, 0), 0);
    const totalPositions = positions.length;

    return Response.json({
      positions,
      trades: formattedTrades,
      openOrders: openOrders.length,
      stats: {
        totalPositions,
        totalInvested: Math.round(totalInvested * 100) / 100,
        totalTrades: trades.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
