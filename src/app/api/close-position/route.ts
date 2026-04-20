// Manual sell (close position) endpoint — places a SELL order on CLOB at best bid.
// Called from the Positions page "Sell" button.

import { executeManualSell } from "@/lib/engine/auto-trader";

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      tokenId?: string;
      conditionId?: string;
      outcomeIndex?: number;
      size?: number;
      title?: string;
      negRisk?: boolean;
      currentPrice?: number;
      entryPrice?: number;
    };

    const tokenId = body.tokenId;
    const conditionId = body.conditionId;
    const outcomeIndex = body.outcomeIndex;
    const size = body.size;
    const title = body.title;
    const negRisk = body.negRisk;

    if (!tokenId || !conditionId || typeof outcomeIndex !== "number" || typeof size !== "number" || size <= 0) {
      return Response.json({
        error: "missing_params",
        detail: "Required: tokenId, conditionId, outcomeIndex (0|1), size (>0)"
      }, { status: 400 });
    }

    const result = await executeManualSell({
      tokenId,
      conditionId,
      outcomeIndex,
      size,
      title: title || "(unknown market)",
      negRisk: !!negRisk,
      currentPrice: body.currentPrice || 0,
      entryPrice: body.entryPrice || 0,
    });

    if (!result.ok) {
      return Response.json({
        error: "sell_failed",
        detail: result.error,
        price: result.price,
      }, { status: 422 });
    }

    return Response.json({
      ok: true,
      orderId: result.orderId,
      price: result.price,
      message: `SELL order placed at ${(result.price ?? 0) * 100}¢`,
    });
  } catch (err) {
    return Response.json({
      error: "internal",
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
