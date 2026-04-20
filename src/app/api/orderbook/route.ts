// Top-of-book lookup for a CLOB token. Returns best bid + ask + sizes + spread
// + midpoint. Used by the Sell UI to show the spread before placing a limit.

import { getOrderbookTop } from "@/lib/engine/auto-trader";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tokenId = url.searchParams.get("tokenId");
    if (!tokenId) {
      return Response.json({ error: "missing tokenId param" }, { status: 400 });
    }
    const top = await getOrderbookTop(tokenId);
    return Response.json(top);
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
