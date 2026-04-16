// Spread Capture (Market Making) Engine
// Finds markets with wide bid-ask spreads and places limit orders on both sides.

const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";
const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

async function cloudGet<T>(url: string, timeoutMs = 30000): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const https = await import("node:https");
      const dns = await import("node:dns");
      dns.setDefaultResultOrder("ipv4first");

      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        const req = https.get(url, { family: 4 }, (res) => {
          let data = "";
          res.on("data", (c: Buffer) => { data += c.toString(); });
          res.on("end", () => {
            clearTimeout(timer);
            if (res.statusCode && res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
            try { resolve(JSON.parse(data) as T); } catch { reject(new Error("JSON parse failed")); }
          });
        });
        req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
      });
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("cloudGet failed");
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpreadOpportunity {
  marketId: string;
  marketQuestion: string;
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPct: number;
  midPrice: number;
  myBidPrice: number;
  myAskPrice: number;
  expectedProfit: number;  // per $100 wagered
  volume24h: number;
  liquidity: number;
}

export interface SpreadCaptureResult {
  opportunities: SpreadOpportunity[];
  marketsScanned: number;
  wideSpreadCount: number;
  avgSpread: number;
  timestamp: string;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

interface OrderbookResponse {
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
  market?: string;
}

async function getOrderbook(tokenId: string): Promise<OrderbookResponse | null> {
  try {
    return await cloudGet<OrderbookResponse>(`${CLOB_API}/book?token_id=${tokenId}`, 6000);
  } catch { return null; }
}

export async function runSpreadCaptureScan(): Promise<SpreadCaptureResult> {
  // Fetch high-volume markets to find ones with orderbooks
  const rawEvents = await cloudGet<Record<string, unknown>[]>(
    `${GAMMA_API}/events?active=true&closed=false&limit=200&order=volume24hr&ascending=false`,
    15000
  );

  const opportunities: SpreadOpportunity[] = [];
  let marketsChecked = 0;
  let wideCount = 0;

  // Collect top markets by volume
  const topMarkets: { id: string; question: string; tokenIds: string[]; volume: number; liquidity: number }[] = [];

  for (const event of (rawEvents || []).slice(0, 100)) {
    const markets = (event.markets as Record<string, unknown>[]) || [];
    for (const m of markets) {
      if (m.closed || !m.active) continue;
      const tokenIdsRaw = m.clobTokenIds as string | undefined;
      if (!tokenIdsRaw) continue;
      try {
        const tokenIds = JSON.parse(tokenIdsRaw) as string[];
        if (tokenIds.length < 1) continue;
        topMarkets.push({
          id: (m.id as string) || "",
          question: (m.question as string) || "",
          tokenIds,
          volume: (m.volumeNum as number) || 0,
          liquidity: (m.liquidityNum as number) || 0,
        });
      } catch { continue; }
    }
  }

  // Sort by volume descending, skip top 20 (already tight spreads), check next 80
  topMarkets.sort((a, b) => b.volume - a.volume);
  const candidates = topMarkets.slice(10, 90);

  for (const market of candidates) {
    marketsChecked++;
    const book = await getOrderbook(market.tokenIds[0]);
    if (!book || !book.bids.length || !book.asks.length) continue;

    const bestBid = parseFloat(book.bids[0].price);
    const bestAsk = parseFloat(book.asks[0].price);
    if (bestBid <= 0 || bestAsk <= 0 || bestAsk <= bestBid) continue;

    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPct = spread / midPrice;

    // Filter: spread must be 3-30¢, both bid and ask must be in tradeable range (5¢-95¢)
    // Skip extreme markets where bid=0.1¢ ask=99.9¢ — those aren't real spreads
    if (spread >= 0.03 && spread <= 0.30 && bestBid >= 0.05 && bestAsk <= 0.95) {
      wideCount++;
      const myBid = Math.round((midPrice - spread * 0.25) * 100) / 100;
      const myAsk = Math.round((midPrice + spread * 0.25) * 100) / 100;
      const expectedProfit = Math.round((myAsk - myBid) * 100 * 100) / 100; // per $100

      opportunities.push({
        marketId: market.id,
        marketQuestion: market.question,
        tokenId: market.tokenIds[0],
        bestBid: Math.round(bestBid * 1000) / 1000,
        bestAsk: Math.round(bestAsk * 1000) / 1000,
        spread: Math.round(spread * 1000) / 1000,
        spreadPct: Math.round(spreadPct * 10000) / 100,
        midPrice: Math.round(midPrice * 1000) / 1000,
        myBidPrice: myBid,
        myAskPrice: myAsk,
        expectedProfit,
        volume24h: market.volume,
        liquidity: market.liquidity,
      });
    }
  }

  opportunities.sort((a, b) => b.expectedProfit - a.expectedProfit);
  const avgSpread = opportunities.length > 0
    ? Math.round(opportunities.reduce((s, o) => s + o.spreadPct, 0) / opportunities.length * 100) / 100
    : 0;

  return {
    opportunities,
    marketsScanned: marketsChecked,
    wideSpreadCount: wideCount,
    avgSpread,
    timestamp: new Date().toISOString(),
  };
}
