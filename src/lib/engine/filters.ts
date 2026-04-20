// Signal eligibility filters — single source of truth for both the auto-trader
// scan loop and the /edges dashboard. Mirrors the 5-layer filter logic that
// used to live inline in auto-trader.ts.

export interface FilterableSignal {
  edge: number;
  marketPrice: number;       // YES price (0-1)
  direction: "BUY_YES" | "BUY_NO";
  daysToExpiry: number;
  theoreticalProb: number;   // our probability for YES winning
  significance: number;      // 1-4 star rating
  lor: number;               // log odds ratio
  _strategy?: string;        // "weather" | "btc" | "correlation"
}

export interface LayerCheck {
  pass: boolean;
  reason: string;
}

export interface EligibilityResult {
  tradeable: boolean;
  blockedByLayer: 1 | 2 | 3 | 4 | 5 | null;
  blockedReason: string | null;
  layerChecks: {
    time: LayerCheck;
    edgeQuality: LayerCheck;
    priceZone: LayerCheck;
    confidence: LayerCheck;
    strategy: LayerCheck;
  };
}

export function evaluateSignalEligibility(signal: FilterableSignal): EligibilityResult {
  // ── Layer 1: TIME ──
  const time: LayerCheck = (() => {
    if (signal.daysToExpiry < 0) {
      return { pass: false, reason: `already expired (${signal.daysToExpiry}d)` };
    }
    if (signal.daysToExpiry > 14) {
      return { pass: false, reason: `${signal.daysToExpiry}d to expiry (>14d limit)` };
    }
    return { pass: true, reason: `${signal.daysToExpiry}d to expiry` };
  })();

  // ── Layer 2: EDGE QUALITY ──
  const edgeQuality: LayerCheck = (() => {
    const minEdge = signal.daysToExpiry <= 1 ? 0.08 : signal.daysToExpiry <= 3 ? 0.10 : 0.15;
    if (signal.edge < minEdge) {
      return { pass: false, reason: `edge ${(signal.edge * 100).toFixed(1)}% < min ${(minEdge * 100).toFixed(0)}% for ${signal.daysToExpiry}d` };
    }
    if (signal.marketPrice > 0 && signal.edge / signal.marketPrice < 0.15) {
      return {
        pass: false,
        reason: `edge/price ${((signal.edge / signal.marketPrice) * 100).toFixed(1)}% < 15% (${(signal.edge * 100).toFixed(1)}% edge on ${(signal.marketPrice * 100).toFixed(1)}¢ = noise)`,
      };
    }
    return { pass: true, reason: `edge ${(signal.edge * 100).toFixed(1)}% passes min ${(minEdge * 100).toFixed(0)}%` };
  })();

  // ── Layer 3: PRICE ZONE ──
  const priceZone: LayerCheck = (() => {
    if (signal.direction === "BUY_YES") {
      if (signal.marketPrice < 0.08) {
        return { pass: false, reason: `YES @ ${(signal.marketPrice * 100).toFixed(1)}¢ < 8¢ (too cheap — near-zero tail)` };
      }
      if (signal.marketPrice > 0.60) {
        return { pass: false, reason: `YES @ ${(signal.marketPrice * 100).toFixed(1)}¢ > 60¢ (payoff ratio too low)` };
      }
      return { pass: true, reason: `YES @ ${(signal.marketPrice * 100).toFixed(1)}¢ in 8-60¢ zone` };
    } else {
      if (signal.marketPrice < 0.40) {
        return { pass: false, reason: `NO: YES @ ${(signal.marketPrice * 100).toFixed(1)}¢ < 40¢ (NO @ ${((1 - signal.marketPrice) * 100).toFixed(1)}¢ too expensive)` };
      }
      if (signal.marketPrice > 0.92) {
        return { pass: false, reason: `NO: YES @ ${(signal.marketPrice * 100).toFixed(1)}¢ > 92¢ (NO too cheap — tail)` };
      }
      return { pass: true, reason: `NO: YES @ ${(signal.marketPrice * 100).toFixed(1)}¢ in 40-92¢ zone` };
    }
  })();

  // ── Layer 4: CONFIDENCE ──
  const confidence: LayerCheck = (() => {
    if (signal.significance < 2) {
      return { pass: false, reason: `significance ${signal.significance}/4 (need ≥2)` };
    }
    if (signal.lor < 0.3) {
      return { pass: false, reason: `LOR ${signal.lor.toFixed(2)} < 0.3 (weak)` };
    }
    return { pass: true, reason: `sig=${signal.significance}/4, LOR=${signal.lor.toFixed(2)}` };
  })();

  // ── Layer 5: STRATEGY-SPECIFIC ──
  const strategy: LayerCheck = (() => {
    const strat = signal._strategy;
    if (strat === "weather") {
      if (signal.theoreticalProb < 0.05) {
        return { pass: false, reason: `forecast prob ${(signal.theoreticalProb * 100).toFixed(1)}% < 5% (too certain against)` };
      }
      if (signal.theoreticalProb > 0.95) {
        return { pass: false, reason: `forecast prob ${(signal.theoreticalProb * 100).toFixed(1)}% > 95% (too certain for)` };
      }
      return { pass: true, reason: `prob ${(signal.theoreticalProb * 100).toFixed(1)}% in 5-95% band` };
    }
    if (strat === "btc") {
      if (signal.lor < 1.0) {
        return { pass: false, reason: `BTC: LOR ${signal.lor.toFixed(2)} < 1.0 (need volatile signal)` };
      }
      return { pass: true, reason: `BTC: LOR ${signal.lor.toFixed(2)} OK` };
    }
    if (strat === "correlation") {
      if (signal.edge < 0.08) {
        return { pass: false, reason: `correlation: edge ${(signal.edge * 100).toFixed(1)}% < 8%` };
      }
      return { pass: true, reason: `correlation: edge OK` };
    }
    return { pass: true, reason: "no strategy-specific rules" };
  })();

  // Determine first failing layer (short-circuit semantics match auto-trader loop)
  const checks: Array<[1 | 2 | 3 | 4 | 5, LayerCheck]> = [
    [1, time],
    [2, edgeQuality],
    [3, priceZone],
    [4, confidence],
    [5, strategy],
  ];
  for (const [layer, c] of checks) {
    if (!c.pass) {
      return {
        tradeable: false,
        blockedByLayer: layer,
        blockedReason: c.reason,
        layerChecks: { time, edgeQuality, priceZone, confidence, strategy },
      };
    }
  }

  return {
    tradeable: true,
    blockedByLayer: null,
    blockedReason: null,
    layerChecks: { time, edgeQuality, priceZone, confidence, strategy },
  };
}
