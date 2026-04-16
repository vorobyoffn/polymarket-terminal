import { runWeatherArbScan } from "@/lib/weather/oracle";

export async function GET() {
  try {
    const result = await runWeatherArbScan();
    return Response.json(result);
  } catch (error) {
    console.error("Weather arb error:", error);
    return Response.json({ error: "Failed to run weather arb scan", signals: [], citiesScanned: 0, marketsScanned: 0, forecastsLoaded: 0 }, { status: 500 });
  }
}
