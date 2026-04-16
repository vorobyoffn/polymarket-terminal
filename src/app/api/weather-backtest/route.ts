import { NextRequest } from "next/server";
import { runWeatherBacktest } from "@/lib/weather/backtest";

export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get("days") || "30");
  try {
    const result = await runWeatherBacktest(Math.min(days, 90));
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
