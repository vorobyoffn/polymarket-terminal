// Performance data endpoint — provides chart-ready data

const DEFAULT_EOA = process.env.TRADING_ADDRESS || "0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const queryAddr = url.searchParams.get("address");
    const eoa = queryAddr && /^0x[a-fA-F0-9]{40}$/.test(queryAddr) ? queryAddr : DEFAULT_EOA;

    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15000);
      const req = https.get(
        `https://data-api.polymarket.com/positions?user=${eoa}&sizeThreshold=0`,
        { family: 4 },
        (res) => {
          let d = "";
          res.on("data", (c: Buffer) => { d += c.toString(); });
          res.on("end", () => { clearTimeout(timer); resolve(d); });
        }
      );
      req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const positions = JSON.parse(data) as Array<{
      title: string; outcome: string; size: number; avgPrice: number;
      curPrice: number; initialValue: number; currentValue: number;
      cashPnl: number; percentPnl: number; endDate: string; icon: string;
      conditionId: string; redeemable: boolean; negativeRisk: boolean;
    }>;

    // Categorize
    const weather = positions.filter(p => p.title.toLowerCase().includes("temperature"));
    const crypto = positions.filter(p => /bitcoin|btc|microstrategy|ethereum/i.test(p.title));
    const other = positions.filter(p => !p.title.toLowerCase().includes("temperature") && !/bitcoin|btc|microstrategy|ethereum/i.test(p.title));

    // Build strategy performance
    const strategyPerf = (name: string, pos: typeof positions) => {
      const invested = pos.reduce((s, p) => s + p.initialValue, 0);
      const current = pos.reduce((s, p) => s + p.currentValue, 0);
      const pnl = pos.reduce((s, p) => s + p.cashPnl, 0);
      const winners = pos.filter(p => p.cashPnl > 0.5).length;
      const losers = pos.filter(p => p.cashPnl < -0.5).length;
      const resolved = pos.filter(p => p.curPrice <= 0.01 || p.curPrice >= 0.99).length;
      return {
        name, count: pos.length, invested: Math.round(invested * 100) / 100,
        current: Math.round(current * 100) / 100, pnl: Math.round(pnl * 100) / 100,
        pnlPct: invested > 0 ? Math.round(pnl / invested * 10000) / 100 : 0,
        winners, losers, resolved,
      };
    };

    const strategies = [
      strategyPerf("Weather Arb", weather),
      strategyPerf("Crypto/BTC", crypto),
      strategyPerf("Other", other),
    ];

    // Build individual position P&L for waterfall chart
    const positionPnl = positions
      .map(p => ({
        title: p.title.slice(0, 40),
        pnl: Math.round(p.cashPnl * 100) / 100,
        pnlPct: Math.round(p.percentPnl * 100) / 100,
        invested: Math.round(p.initialValue * 100) / 100,
        category: p.title.toLowerCase().includes("temperature") ? "weather" : /bitcoin|btc|microstrategy/i.test(p.title) ? "crypto" : "other",
        resolved: p.curPrice <= 0.01 || p.curPrice >= 0.99,
        outcome: p.outcome,
      }))
      .sort((a, b) => b.pnl - a.pnl);

    // Build cumulative P&L by expiry date (timeline proxy)
    const byDate: Record<string, { weather: number; crypto: number; other: number; total: number }> = {};
    positions.forEach(p => {
      const date = p.endDate?.slice(0, 10) || "unknown";
      if (!byDate[date]) byDate[date] = { weather: 0, crypto: 0, other: 0, total: 0 };
      const cat = p.title.toLowerCase().includes("temperature") ? "weather" : /bitcoin|btc|microstrategy/i.test(p.title) ? "crypto" : "other";
      byDate[date][cat] += p.cashPnl;
      byDate[date].total += p.cashPnl;
    });

    const timeline = Object.entries(byDate)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, pnl]) => ({ date, ...pnl }));

    // Redeemed/resolved positions
    // Already-claimed positions — mark them properly
    const claimedConditionIds = new Set([
      "0xb907f677d1a4574261607573593f9931f0bdcb48dd014d6e4fbc25aa4051904a", // Taipei
      "0xb8433678ecb971f94728c0579c9dd349521567678436daad1471c8f4cb5e033e", // Moscow 9C
      "0xc044c6e20f16903b5d307c786f7900917fdad7db76db0bbf7af15d28ed07c585", // Singapore
      "0x3b856eb1f92b453485bdbe3b9063d067bae3337d60165df145caa2daab7fc81a", // Moscow 11C
    ]);

    const redeemedPositions = positions
      .filter(p => p.curPrice <= 0.01 || p.curPrice >= 0.99 || claimedConditionIds.has(p.conditionId))
      .map(p => {
        // Correct win logic: YES won means curPrice high; NO won means curPrice low.
        // Previous code always used curPrice >= 0.99 which miscounted every NO win as a loss.
        const won = p.outcome === "Yes"
          ? p.curPrice >= 0.99
          : p.curPrice <= 0.01;
        const claimed = claimedConditionIds.has(p.conditionId);
        const payout = won ? p.size : 0;
        return {
          title: p.title,
          outcome: p.outcome,
          won,
          claimed,
          cost: Math.round(p.initialValue * 100) / 100,
          payout: Math.round(payout * 100) / 100,
          profit: Math.round((payout - p.initialValue) * 100) / 100,
          category: p.title.toLowerCase().includes("temperature") ? "weather" : /bitcoin|btc|microstrategy/i.test(p.title) ? "crypto" : "other",
        };
      });

    // Already-redeemed condition IDs (these were claimed, data API is stale)
    const claimedConditions = new Set([
      "0xb907f677d1a4574261607573593f9931f0bdcb48dd014d6e4fbc25aa4051904a", // Taipei
      "0xb8433678ecb971f94728c0579c9dd349521567678436daad1471c8f4cb5e033e", // Moscow 9C
      "0xc044c6e20f16903b5d307c786f7900917fdad7db76db0bbf7af15d28ed07c585", // Singapore
      "0x3b856eb1f92b453485bdbe3b9063d067bae3337d60165df145caa2daab7fc81a", // Moscow 11C
    ]);

    const claimable = positions.filter(p =>
      p.redeemable && p.currentValue > 0.01 && !claimedConditions.has(p.conditionId)
    );
    const expired = positions.filter(p => new Date(p.endDate) < new Date() && p.curPrice > 0.01 && p.curPrice < 0.99);

    const realizedPnl = redeemedPositions.reduce((s, p) => s + p.profit, 0);
    const claimableAmount = claimable.reduce((s, p) => s + p.size, 0);

    // Fetch wallet balance for total portfolio
    let walletUsdc = 0;
    try {
      const walletData = await new Promise<string>((resolve, reject) => {
        const timer2 = setTimeout(() => reject(new Error("timeout")), 10000);
        const https2 = require("node:https");
        // balanceOf(eoa) — 0x70a08231 + address padded to 32 bytes
        const addrPadded = eoa.toLowerCase().replace("0x", "").padStart(64, "0");
        const callData = `0x70a08231${addrPadded}`;
        const body = JSON.stringify({jsonrpc:"2.0",method:"eth_call",params:[{to:"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",data:callData},"latest"],id:1});
        const rpcUrl = new URL(process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com");
        const req2 = https2.request({hostname:rpcUrl.hostname,port:443,path:rpcUrl.pathname,method:"POST",family:4,headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}}, (res: { on: (event: string, cb: (data?: Buffer) => void) => void }) => {
          let d2 = ""; res.on("data", (c?: Buffer) => { if (c) d2 += c.toString(); }); res.on("end", () => { clearTimeout(timer2); resolve(d2); });
        });
        req2.on("error", () => { clearTimeout(timer2); resolve("{}"); });
        req2.write(body); req2.end();
      });
      const parsed = JSON.parse(walletData) as { result?: string };
      walletUsdc = Number(BigInt(parsed.result || "0x0")) / 1e6;
    } catch { /* silent */ }

    // Active positions = exclude already-claimed ones
    const activePositions = positions.filter(p => !claimedConditionIds.has(p.conditionId));
    // Display positions = same filter as live-positions page
    const displayPositions = positions.filter(p => !claimedConditionIds.has(p.conditionId) && p.currentValue > 0.01);

    // Equity curve: starting capital, then add each position's P&L sorted by end date
    // Total deposits across all top-ups this session:
    //   $633 on Apr 12 (initial) + $141 on Apr 14 + $264 on Apr 22 = $1,038
    const startingCapital = 1038;
    const sortedByDate = [...positions].sort((a, b) => (a.endDate || "").localeCompare(b.endDate || ""));
    let equity = startingCapital;
    const equityCurve = [{ date: "Start", value: startingCapital, label: `Total deposits: $${startingCapital}` }];

    // Group by date for equity curve
    const dateGroups: Record<string, { pnl: number; count: number; invested: number }> = {};
    sortedByDate.forEach(p => {
      const date = p.endDate?.slice(0, 10) || "unknown";
      if (!dateGroups[date]) dateGroups[date] = { pnl: 0, count: 0, invested: 0 };
      dateGroups[date].pnl += p.cashPnl;
      dateGroups[date].count++;
      dateGroups[date].invested += p.initialValue;
    });

    Object.entries(dateGroups).sort((a, b) => a[0].localeCompare(b[0])).forEach(([date, g]) => {
      equity += g.pnl;
      equityCurve.push({
        date: date, // full date "2026-04-14"
        value: Math.round(equity * 100) / 100,
        label: `${g.count} positions, P&L $${g.pnl.toFixed(2)}`,
      });
    });

    // Add "Now" point = wallet + display position value (same filter as positions page)
    const totalPortfolioNow = walletUsdc + displayPositions.reduce((s, p) => s + p.currentValue, 0);
    equityCurve.push({
      date: "Now",
      value: Math.round(totalPortfolioNow * 100) / 100,
      label: `Wallet $${walletUsdc.toFixed(0)} + positions $${positions.reduce((s, p) => s + p.currentValue, 0).toFixed(0)}`,
    });

    // Totals — include dead positions in cost basis (true cost) but only living ones in current value
    // Simple: cost and value of visible positions only (what user sees on screen)
    const totalInvested = Math.round(displayPositions.reduce((s, p) => s + p.initialValue, 0) * 100) / 100;
    const totalCurrent = Math.round(displayPositions.reduce((s, p) => s + p.currentValue, 0) * 100) / 100;
    const totalPnl = Math.round((totalCurrent - totalInvested) * 100) / 100;

    return Response.json({
      strategies,
      positionPnl,
      timeline,
      equityCurve,
      redeemedPositions,
      totals: {
        invested: Math.round(totalInvested * 100) / 100,
        current: Math.round(totalCurrent * 100) / 100,
        pnl: totalPnl,
        pnlPct: totalInvested > 0 ? Math.round(totalPnl / totalInvested * 10000) / 100 : 0,
        positions: positions.length,
        resolved: positions.filter(p => p.curPrice <= 0.01 || p.curPrice >= 0.99).length,
        realizedPnl: Math.round(realizedPnl * 100) / 100,
        claimableAmount: Math.round(claimableAmount * 100) / 100,
        pendingSettlement: expired.length,
        walletUsdc: Math.round(walletUsdc * 100) / 100,
        totalPortfolio: Math.round((walletUsdc + totalCurrent) * 100) / 100,
        startingCapital,
        totalReturn: Math.round(((walletUsdc + totalCurrent) / startingCapital - 1) * 10000) / 100,

        // ── Win rate stats (from redeemed/resolved positions) ──
        wonCount: redeemedPositions.filter(p => p.won).length,
        lostCount: redeemedPositions.filter(p => !p.won).length,
        resolvedCount: redeemedPositions.length,
        winRate: redeemedPositions.length > 0
          ? Math.round(redeemedPositions.filter(p => p.won).length / redeemedPositions.length * 10000) / 100
          : 0,
        avgWinProfit: (() => {
          const wins = redeemedPositions.filter(p => p.won);
          if (wins.length === 0) return 0;
          return Math.round(wins.reduce((s, p) => s + p.profit, 0) / wins.length * 100) / 100;
        })(),
        avgLossAmount: (() => {
          const losses = redeemedPositions.filter(p => !p.won);
          if (losses.length === 0) return 0;
          return Math.round(losses.reduce((s, p) => s + p.profit, 0) / losses.length * 100) / 100;
        })(),
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
