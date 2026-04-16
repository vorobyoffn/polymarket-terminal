import { getTradeStats } from "@/lib/engine/auto-trader";

export async function GET() {
  const stats = getTradeStats();
  return Response.json(stats);
}
