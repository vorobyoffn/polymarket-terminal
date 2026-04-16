import { NextRequest } from "next/server";
import { getRecordingStats, getRecordedSnapshots } from "@/lib/weather/price-recorder";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "stats";
  const days = parseInt(req.nextUrl.searchParams.get("days") || "7");

  try {
    if (action === "stats") {
      const stats = await getRecordingStats();
      return Response.json(stats);
    }

    if (action === "weather") {
      // Return only weather market snapshots
      const batches = await getRecordedSnapshots(days);
      const weatherSnapshots = batches.flatMap(b =>
        b.snapshots.filter(s => s.city).map(s => ({
          timestamp: b.timestamp,
          marketId: s.marketId,
          question: s.question,
          city: s.city,
          targetTemp: s.targetTemp,
          targetType: s.targetType,
          yesPrice: s.yesPrice,
          endDate: s.endDate,
          volume24h: s.volume24h,
        }))
      );
      return Response.json({
        count: weatherSnapshots.length,
        snapshots: weatherSnapshots.slice(-500), // last 500
      });
    }

    if (action === "all") {
      const batches = await getRecordedSnapshots(days);
      return Response.json({
        batches: batches.length,
        totalSnapshots: batches.reduce((s, b) => s + b.snapshots.length, 0),
        data: batches.slice(-10), // last 10 batches
      });
    }

    return Response.json({ error: "Unknown action. Use: stats, weather, all" });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
