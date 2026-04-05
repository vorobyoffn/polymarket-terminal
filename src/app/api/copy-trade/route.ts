import { NextRequest } from "next/server";
import {
  getCopyState,
  startCopyTrader,
  stopCopyTrader,
  addWhaleWallet,
  removeWhaleWallet,
} from "@/lib/engine/copy-trader";

export async function GET() {
  return Response.json(getCopyState());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const action = body.action as string;

  switch (action) {
    case "start":
      startCopyTrader(body.intervalSec ? Number(body.intervalSec) : undefined);
      return Response.json({ ok: true, state: getCopyState() });
    case "stop":
      stopCopyTrader();
      return Response.json({ ok: true, state: getCopyState() });
    case "add_wallet":
      addWhaleWallet(body.address as string, body.label as string);
      return Response.json({ ok: true, state: getCopyState() });
    case "remove_wallet":
      removeWhaleWallet(body.address as string);
      return Response.json({ ok: true, state: getCopyState() });
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
