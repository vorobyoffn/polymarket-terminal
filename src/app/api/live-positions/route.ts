// Live positions, open orders, and trade history from Polymarket

import { Wallet } from "ethers";

const EOA_ADDRESS = "0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0";
const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";

async function httpGet<T>(url: string, timeoutMs = 15000): Promise<T> {
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
        try { resolve(JSON.parse(data) as T); } catch { reject(new Error("JSON parse")); }
      });
    });
    req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
  });
}

async function getClobClient() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return null;

  const { ClobClient } = await import("@polymarket/clob-client");
  const normalizedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
  const wallet = new Wallet(normalizedKey);

  const creds = {
    key: process.env.CLOB_API_KEY || "",
    secret: process.env.CLOB_API_SECRET || "",
    passphrase: process.env.CLOB_API_PASSPHRASE || "",
  };

  if (!creds.key || !creds.secret) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ClobClient(CLOB_API, 137, wallet as any, creds as any, 0);
}

export async function GET() {
  try {
    // ── 1. Fetch live positions from data API ──
    const rawPositions = await httpGet<Array<{
      asset: string; size: number; avgPrice: number; initialValue: number;
      currentValue: number; cashPnl: number; percentPnl: number;
      totalBought: number; realizedPnl: number; curPrice: number;
      title: string; slug: string; icon: string; eventSlug: string;
      outcome: string; outcomeIndex: number; endDate: string; negativeRisk: boolean;
      conditionId: string; redeemable: boolean;
    }>>(`https://data-api.polymarket.com/positions?user=${EOA_ADDRESS}&sizeThreshold=0`);

    // Filter out only positions we've actually redeemed (claimed condition IDs)
    const claimedIds = new Set([
      "0xb907f677d1a4574261607573593f9931f0bdcb48dd014d6e4fbc25aa4051904a", // Taipei
      "0xb8433678ecb971f94728c0579c9dd349521567678436daad1471c8f4cb5e033e", // Moscow 9C
      "0xc044c6e20f16903b5d307c786f7900917fdad7db76db0bbf7af15d28ed07c585", // Singapore
      "0x3b856eb1f92b453485bdbe3b9063d067bae3337d60165df145caa2daab7fc81a", // Moscow 11C
    ]);
    const activePositions = (rawPositions || []).filter(p =>
      !claimedIds.has(p.conditionId) && p.currentValue > 0.01
    );

    const positions = activePositions.map(p => ({
      tokenId: p.asset,
      title: p.title,
      slug: p.slug,
      icon: p.icon,
      eventSlug: p.eventSlug,
      outcome: p.outcome,
      outcomeIndex: p.outcomeIndex,
      endDate: p.endDate,
      size: p.size,
      avgPrice: Math.round(p.avgPrice * 10000) / 10000,
      curPrice: Math.round(p.curPrice * 10000) / 10000,
      initialValue: Math.round(p.initialValue * 100) / 100,
      currentValue: Math.round(p.currentValue * 100) / 100,
      cashPnl: Math.round(p.cashPnl * 100) / 100,
      percentPnl: Math.round(p.percentPnl * 100) / 100,
      totalBought: p.totalBought,
      realizedPnl: Math.round(p.realizedPnl * 100) / 100,
      negativeRisk: p.negativeRisk,
      conditionId: p.conditionId,
      redeemable: p.redeemable,
    }));

    // ── 2. Fetch open orders from CLOB ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let openOrders: any[] = [];
    try {
      const client = await getClobClient();
      if (client) {
        const raw = await client.getOpenOrders();
        openOrders = Array.isArray(raw) ? raw : [];
      }
    } catch { /* silent */ }

    // ── 3. Fetch trade history from CLOB ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tradeHistory: any[] = [];
    try {
      const client = await getClobClient();
      if (client) {
        const raw = await client.getTrades();
        tradeHistory = Array.isArray(raw) ? raw : [];
      }
    } catch { /* silent */ }

    // ── Compute stats ── Simple: cost and value of visible positions
    const totalInitial = Math.round(positions.reduce((s, p) => s + p.initialValue, 0) * 100) / 100;
    const totalCurrent = Math.round(positions.reduce((s, p) => s + p.currentValue, 0) * 100) / 100;
    const totalPnl = Math.round((totalCurrent - totalInitial) * 100) / 100;
    const totalPnlPct = totalInitial > 0 ? Math.round(totalPnl / totalInitial * 10000) / 100 : 0;
    const totalRealized = 0;
    const winners = positions.filter(p => p.cashPnl > 0.5).length;
    const losers = positions.filter(p => p.cashPnl < -0.5).length;

    // Format open orders
    const formattedOrders = openOrders.map((o: Record<string, unknown>) => ({
      id: (o.id as string) || "",
      side: (o.side as string) || "",
      price: parseFloat((o.price as string) || "0"),
      originalSize: parseFloat((o.original_size as string) || "0"),
      sizeMatched: parseFloat((o.size_matched as string) || "0"),
      sizeRemaining: parseFloat((o.original_size as string) || "0") - parseFloat((o.size_matched as string) || "0"),
      tokenId: ((o.asset_id as string) || "").slice(0, 20),
      status: (o.status as string) || "",
      createdAt: (o.created_at as string) || "",
      type: (o.type as string) || "GTC",
    }));

    // Build token → market name lookup from positions
    const tokenNameMap = new Map<string, { title: string; outcome: string }>();
    for (const p of rawPositions || []) {
      tokenNameMap.set(p.asset, { title: p.title, outcome: p.outcome });
    }

    // Format trade history with market names
    const formattedTrades = tradeHistory.slice(0, 100).map((t: Record<string, unknown>) => {
      const assetId = (t.asset_id as string) || "";
      const match = tokenNameMap.get(assetId);
      return {
        id: (t.id as string) || "",
        side: (t.side as string) || "",
        size: parseFloat((t.size as string) || "0"),
        price: parseFloat((t.price as string) || "0"),
        tokenId: assetId.slice(0, 20),
        marketName: match?.title || "Unknown Market",
        outcome: match?.outcome || "",
        status: (t.status as string) || "",
        matchTime: (t.match_time as string) || "",
      };
    });

    return Response.json({
      positions,
      openOrders: formattedOrders,
      tradeHistory: formattedTrades,
      stats: {
        totalPositions: positions.length,
        totalInitial: Math.round(totalInitial * 100) / 100,
        totalCurrent: Math.round(totalCurrent * 100) / 100,
        totalPnl,
        totalPnlPct,
        totalRealized: Math.round(totalRealized * 100) / 100,
        winners,
        losers,
        openOrderCount: formattedOrders.length,
        totalTradeCount: tradeHistory.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
