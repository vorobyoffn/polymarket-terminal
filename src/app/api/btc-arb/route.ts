import type { NextRequest } from "next/server";
import { runBtcArbScan } from "@/lib/engine/btc-arb";

export async function GET(req: NextRequest) {
  const bankroll = parseFloat(req.nextUrl.searchParams.get("bankroll") || "1000");
  try {
    const result = await runBtcArbScan(bankroll);
    return Response.json(result);
  } catch (error) {
    console.error("BTC arb error:", error);
    return Response.json({ error: "Failed to run BTC arb scan" }, { status: 500 });
  }
}
