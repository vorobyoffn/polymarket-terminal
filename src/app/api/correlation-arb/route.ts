import { runCorrelationArbScan } from "@/lib/engine/correlation-arb";

export async function GET() {
  try {
    const result = await runCorrelationArbScan();
    return Response.json(result);
  } catch (error) {
    console.error("Correlation arb error:", error);
    return Response.json({ error: "Failed to run correlation arb scan" }, { status: 500 });
  }
}
