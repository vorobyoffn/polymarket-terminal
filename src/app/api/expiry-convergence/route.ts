import { NextRequest } from "next/server";
import { runExpiryConvergenceScan } from "@/lib/engine/expiry-convergence";

export async function GET(req: NextRequest) {
  const bankroll = parseFloat(req.nextUrl.searchParams.get("bankroll") || "1000");
  try {
    const result = await runExpiryConvergenceScan(bankroll);
    return Response.json(result);
  } catch (error) {
    console.error("Expiry convergence error:", error);
    return Response.json({ error: "Failed to run expiry convergence scan" }, { status: 500 });
  }
}
