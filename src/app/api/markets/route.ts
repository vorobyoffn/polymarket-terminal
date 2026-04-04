import { NextRequest } from "next/server";
import { fetchEvents } from "@/lib/polymarket/gamma-client";
export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "100");
  try { return Response.json(await fetchEvents(limit)); }
  catch { return Response.json({ error: "Failed" }, { status: 500 }); }
}
