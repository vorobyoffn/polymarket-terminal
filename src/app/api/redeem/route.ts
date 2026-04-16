// Redeem resolved positions — claims winning payouts to wallet
import { Wallet } from "ethers";

const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";

export async function GET() {
  // List redeemable positions
  try {
    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15000);
      const req = https.get(
        `https://data-api.polymarket.com/positions?user=0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0&sizeThreshold=0`,
        { family: 4 },
        (res) => {
          let d = "";
          res.on("data", (c: Buffer) => { d += c.toString(); });
          res.on("end", () => { clearTimeout(timer); resolve(d); });
        }
      );
      req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const all = JSON.parse(data) as Array<{
      asset: string; conditionId: string; size: number; curPrice: number;
      currentValue: number; cashPnl: number; title: string; outcome: string;
      redeemable: boolean; endDate: string; initialValue: number;
    }>;

    const redeemable = all.filter(p => p.redeemable);
    const resolved = all.filter(p => p.curPrice <= 0.01 || p.curPrice >= 0.99);
    const expired = all.filter(p => new Date(p.endDate) < new Date() && !p.redeemable && p.curPrice > 0.01 && p.curPrice < 0.99);
    const won = resolved.filter(p => p.curPrice >= 0.99);
    const lost = resolved.filter(p => p.curPrice <= 0.01);

    return Response.json({
      redeemable: redeemable.map(p => ({
        title: p.title,
        outcome: p.outcome,
        conditionId: p.conditionId,
        asset: p.asset,
        shares: p.size,
        payout: Math.round(p.size * 100) / 100,
        cost: Math.round(p.initialValue * 100) / 100,
        profit: Math.round(p.cashPnl * 100) / 100,
      })),
      resolved: resolved.map(p => ({
        title: p.title,
        outcome: p.outcome,
        won: p.curPrice >= 0.99,
        payout: p.curPrice >= 0.99 ? Math.round(p.size * 100) / 100 : 0,
        cost: Math.round(p.initialValue * 100) / 100,
        pnl: Math.round(p.cashPnl * 100) / 100,
        redeemable: p.redeemable,
      })),
      expired: expired.map(p => ({
        title: p.title,
        outcome: p.outcome,
        curPrice: p.curPrice,
        cost: Math.round(p.initialValue * 100) / 100,
        currentValue: Math.round(p.currentValue * 100) / 100,
        endDate: p.endDate,
      })),
      summary: {
        totalRedeemable: redeemable.length,
        totalClaimable: Math.round(won.reduce((s, p) => s + p.size, 0) * 100) / 100,
        totalResolved: resolved.length,
        totalWon: won.length,
        totalLost: lost.length,
        realizedPnl: Math.round(resolved.reduce((s, p) => s + p.cashPnl, 0) * 100) / 100,
        pendingSettlement: expired.length,
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Attempt to redeem redeemable positions via CLOB. Optional body: {conditionId?: string}
  // scopes redemption to a single position; omitted = redeem all.
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return Response.json({ error: "No PRIVATE_KEY" }, { status: 400 });

  let targetConditionId: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.conditionId === "string") {
      targetConditionId = body.conditionId;
    }
  } catch { /* empty body = redeem all */ }

  try {
    const { ClobClient } = await import("@polymarket/clob-client");
    const normalizedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
    const wallet = new Wallet(normalizedKey);

    const creds = {
      key: process.env.CLOB_API_KEY || "",
      secret: process.env.CLOB_API_SECRET || "",
      passphrase: process.env.CLOB_API_PASSPHRASE || "",
    };

    if (!creds.key || !creds.secret) {
      return Response.json({ error: "No CLOB credentials" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new ClobClient(CLOB_API, 137, wallet as any, creds as any, 0);

    // Get redeemable positions from data API
    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15000);
      const req = https.get(
        `https://data-api.polymarket.com/positions?user=0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0&sizeThreshold=0`,
        { family: 4 },
        (res) => {
          let d = "";
          res.on("data", (c: Buffer) => { d += c.toString(); });
          res.on("end", () => { clearTimeout(timer); resolve(d); });
        }
      );
      req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const all = JSON.parse(data) as Array<{ redeemable: boolean; conditionId: string; title: string; size: number }>;
    const redeemable = targetConditionId
      ? all.filter(p => p.redeemable && p.conditionId === targetConditionId)
      : all.filter(p => p.redeemable);

    if (targetConditionId && redeemable.length === 0) {
      return Response.json(
        { error: "not_redeemable", conditionId: targetConditionId },
        { status: 404 }
      );
    }

    // Redeem through the CTF contract using viem (ethers v5 has IPv6 issues)
    const { createWalletClient, createPublicClient, http, parseAbi } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { polygon } = await import("viem/chains");

    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    const rpc = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
    const walletClient = createWalletClient({ account, chain: polygon, transport: http(rpc, { timeout: 30000 }) });
    const publicClient = createPublicClient({ chain: polygon, transport: http(rpc, { timeout: 30000 }) });

    const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;
    const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
    const PARENT_COLLECTION = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    const ctfAbi = parseAbi([
      "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
    ]);

    const results: string[] = [];
    for (const pos of redeemable) {
      if (!pos.conditionId) {
        results.push(`Skipped: ${pos.title.slice(0, 40)} — no condition ID`);
        continue;
      }
      try {
        const hash = await walletClient.writeContract({
          address: CTF_ADDRESS,
          abi: ctfAbi,
          functionName: "redeemPositions",
          args: [USDC_E, PARENT_COLLECTION, pos.conditionId as `0x${string}`, [BigInt(1), BigInt(2)]],
        });
        results.push(`TX sent: ${pos.title.slice(0, 40)} — ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        results.push(`Confirmed: block ${receipt.blockNumber}`);
      } catch (e) {
        results.push(`Failed: ${pos.title.slice(0, 40)} — ${e instanceof Error ? e.message.slice(0, 150) : String(e).slice(0, 150)}`);
      }
    }

    return Response.json({ ok: true, redeemed: results.length, results });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
