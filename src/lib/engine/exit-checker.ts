// Auto-exit detection — pure logic, no side effects.
//
// Scans on-chain positions and current weather signals; returns ExitTriggers
// for positions where the model's view has flipped against us or the forecast
// has diverged enough that the target outcome is no longer plausible.

import type { WeatherSignal } from "@/lib/weather/oracle";

export interface ExitTrigger {
  tokenId: string;
  conditionId: string;
  outcomeIndex: number;    // 0=YES, 1=NO
  size: number;             // shares held on-chain
  reason: "edge_flip" | "forecast_diverged";
  currentEdge: number;      // our-side edge (negative means against us)
  currentProb: number;      // our-side probability (our outcome wins)
  entryPrice: number;       // avg entry for reference
  currentPrice: number;     // YES price for our side
  title: string;
  negRisk: boolean;
}

interface OnChainPosition {
  asset: string;            // tokenId
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  currentValue: number;
  title: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
  negativeRisk: boolean;
  redeemable: boolean;
}

export interface DetectExitsParams {
  address: string;
  currentWeatherSignals: WeatherSignal[];
  edgeThreshold: number;     // e.g., -0.08 (exit if our edge drops below this)
  probThreshold: number;     // e.g., 0.05 (exit if our outcome <5% probable)
  recentExitTimestamps: Map<string, number>;
  cooldownMinutes: number;   // e.g., 10
  minAgePositionsBeforeExit: number; // minutes since position first appeared
  positionFirstSeen: Map<string, number>; // conditionId -> ms timestamp of first observation
  now?: number;              // injectable for testing
}

async function fetchPositions(address: string): Promise<OnChainPosition[]> {
  const https = await import("node:https");
  const dns = await import("node:dns");
  dns.setDefaultResultOrder("ipv4first");

  const data = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 15000);
    const r = https.get(
      `https://data-api.polymarket.com/positions?user=${address}&sizeThreshold=0`,
      { family: 4 },
      (res) => {
        let d = "";
        res.on("data", (c: Buffer) => { d += c.toString(); });
        res.on("end", () => { clearTimeout(timer); resolve(d); });
      }
    );
    r.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
  });

  return JSON.parse(data) as OnChainPosition[];
}

export async function detectExits(params: DetectExitsParams): Promise<ExitTrigger[]> {
  const {
    address,
    currentWeatherSignals,
    edgeThreshold,
    probThreshold,
    recentExitTimestamps,
    cooldownMinutes,
    minAgePositionsBeforeExit,
    positionFirstSeen,
    now = Date.now(),
  } = params;

  const cooldownMs = cooldownMinutes * 60 * 1000;
  const minAgeMs = minAgePositionsBeforeExit * 60 * 1000;

  let positions: OnChainPosition[];
  try {
    positions = await fetchPositions(address);
  } catch (err) {
    console.error("[ExitChecker] Failed to fetch positions:", err instanceof Error ? err.message : err);
    return [];
  }

  // Filter to open weather positions with meaningful value
  const candidates = positions.filter(p =>
    p.currentValue > 0.5 &&
    p.curPrice > 0.10 &&           // skip near-resolution losers
    p.curPrice < 0.90 &&           // skip near-resolution winners
    typeof p.title === "string" &&
    p.title.toLowerCase().includes("temperature")
  );

  // Track first-seen for each market to enforce min-age rule
  for (const p of candidates) {
    if (!positionFirstSeen.has(p.conditionId)) {
      positionFirstSeen.set(p.conditionId, now);
    }
  }

  const triggers: ExitTrigger[] = [];

  for (const p of candidates) {
    // Min age guard
    const firstSeen = positionFirstSeen.get(p.conditionId) ?? now;
    if (now - firstSeen < minAgeMs) continue;

    // Cooldown guard
    const lastExit = recentExitTimestamps.get(p.conditionId) ?? 0;
    if (now - lastExit < cooldownMs) continue;

    // Find fresh signal
    const signal = currentWeatherSignals.find(s => {
      // Match by marketId if possible (marketId is the Polymarket market id, not conditionId)
      // Weather signals use market.id from Gamma API. Compare title/question as fallback.
      return s.marketQuestion === p.title;
    });
    if (!signal) continue; // market not scanned this cycle

    // Compute our-side edge and probability
    // forecastProb is the probability that YES wins (target band hit).
    // If we hold YES (outcomeIndex=0): our edge = forecastProb - yesPrice
    // If we hold NO (outcomeIndex=1): our edge = (1 - forecastProb) - noPrice
    //                              = (1 - forecastProb) - (1 - yesPrice)
    //                              = yesPrice - forecastProb
    const yesPrice = signal.marketPrice;
    const forecastProb = signal.forecastProb;

    const ourCurrentProb = p.outcomeIndex === 0 ? forecastProb : 1 - forecastProb;
    const ourCurrentEdge = p.outcomeIndex === 0
      ? forecastProb - yesPrice
      : yesPrice - forecastProb;

    // Trigger A: edge flipped strongly against us
    if (ourCurrentEdge < edgeThreshold) {
      triggers.push({
        tokenId: p.asset,
        conditionId: p.conditionId,
        outcomeIndex: p.outcomeIndex,
        size: p.size,
        reason: "edge_flip",
        currentEdge: ourCurrentEdge,
        currentProb: ourCurrentProb,
        entryPrice: p.avgPrice,
        currentPrice: p.curPrice,
        title: p.title,
        negRisk: p.negativeRisk,
      });
      continue;
    }

    // Trigger B: forecast diverged (our outcome is now very unlikely)
    if (ourCurrentProb < probThreshold) {
      triggers.push({
        tokenId: p.asset,
        conditionId: p.conditionId,
        outcomeIndex: p.outcomeIndex,
        size: p.size,
        reason: "forecast_diverged",
        currentEdge: ourCurrentEdge,
        currentProb: ourCurrentProb,
        entryPrice: p.avgPrice,
        currentPrice: p.curPrice,
        title: p.title,
        negRisk: p.negativeRisk,
      });
    }
  }

  return triggers;
}
