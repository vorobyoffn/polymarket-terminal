import { NextRequest } from "next/server";
import {
  getState,
  startTrader,
  stopTrader,
  resetTrader,
  closePaperTrade,
  setLossLimit,
  setAutoExit,
} from "@/lib/engine/auto-trader";

export async function GET() {
  return Response.json(getState());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const action = body.action as string;

  switch (action) {
    case "start": {
      startTrader({
        mode: (body.mode as "paper" | "live") || undefined,
        bankroll: body.bankroll ? Number(body.bankroll) : undefined,
        scanIntervalSec: body.scanIntervalSec ? Number(body.scanIntervalSec) : undefined,
        minLor: body.minLor !== undefined ? Number(body.minLor) : undefined,
        minEdge: body.minEdge !== undefined ? Number(body.minEdge) : undefined,
        maxConcurrentTrades: body.maxConcurrentTrades ? Number(body.maxConcurrentTrades) : undefined,
      });
      return Response.json({ ok: true, state: getState() });
    }
    case "stop": {
      stopTrader();
      return Response.json({ ok: true, state: getState() });
    }
    case "reset": {
      resetTrader();
      return Response.json({ ok: true, state: getState() });
    }
    case "close_trade": {
      closePaperTrade(
        body.tradeId as string,
        body.outcome as "won" | "lost"
      );
      return Response.json({ ok: true, state: getState() });
    }
    case "set_loss_limit": {
      const lossLimit = body.lossLimit === null ? null : Number(body.lossLimit);
      setLossLimit(Number.isFinite(lossLimit as number) || lossLimit === null ? lossLimit : null);
      return Response.json({ ok: true, state: getState() });
    }
    case "set_auto_exit": {
      setAutoExit({
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        edgeThreshold: body.edgeThreshold !== undefined ? Number(body.edgeThreshold) : undefined,
        probThreshold: body.probThreshold !== undefined ? Number(body.probThreshold) : undefined,
      });
      return Response.json({ ok: true, state: getState() });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
