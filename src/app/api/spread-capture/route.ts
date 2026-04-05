import { runSpreadCaptureScan } from "@/lib/engine/spread-capture";

export async function GET() {
  try {
    const result = await runSpreadCaptureScan();
    return Response.json(result);
  } catch (error) {
    console.error("Spread capture error:", error);
    return Response.json({ error: "Failed to run spread capture scan" }, { status: 500 });
  }
}
