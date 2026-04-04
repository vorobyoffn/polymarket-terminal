import { httpsGet } from "@/lib/utils/https-get";
import type { PolymarketEvent } from "./types";

const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

export async function fetchEvents(limit = 100): Promise<PolymarketEvent[]> {
  return httpsGet<PolymarketEvent[]>(`${GAMMA_API}/events?active=true&closed=false&limit=${limit}`, 15000);
}
