// Redeem negRisk positions through the NegRiskAdapter contract

export async function POST(req: Request) {
  // Optional body: {conditionId?: string} scopes to one position; omitted = redeem all negRisk.
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
    const { createWalletClient, createPublicClient, http, parseAbi, encodeFunctionData } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { polygon } = await import("viem/chains");

    const normalizedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    const rpc = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
    const walletClient = createWalletClient({ account, chain: polygon, transport: http(rpc, { timeout: 30000 }) });
    const publicClient = createPublicClient({ chain: polygon, transport: http(rpc, { timeout: 30000 }) });

    // Get redeemable negRisk positions
    const https = await import("node:https");
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15000);
      const req = https.get(
        `https://data-api.polymarket.com/positions?user=${account.address}&sizeThreshold=0`,
        { family: 4 },
        (res) => { let d = ""; res.on("data", (c: Buffer) => d += c.toString()); res.on("end", () => { clearTimeout(timer); resolve(d); }); }
      );
      req.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });

    const all = JSON.parse(data) as Array<{
      conditionId: string; title: string; curPrice: number;
      currentValue: number; negativeRisk: boolean; redeemable: boolean;
      size: number; asset: string; outcome: string; outcomeIndex: number;
    }>;

    // Find positions that are resolved (price 0 or 1) and have value
    const toRedeem = all.filter(p => {
      const isResolved = (p.curPrice >= 0.99 || p.curPrice <= 0.01) &&
        p.currentValue > 0.01 &&
        p.negativeRisk === true;
      if (!isResolved) return false;
      if (targetConditionId) return p.conditionId === targetConditionId;
      return true;
    });

    if (toRedeem.length === 0) {
      if (targetConditionId) {
        return Response.json(
          { error: "not_redeemable", conditionId: targetConditionId },
          { status: 404 }
        );
      }
      return Response.json({ ok: true, message: "No negRisk positions to redeem", results: [] });
    }

    // Contracts
    const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;
    const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const;
    const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

    // For negRisk, we need to:
    // 1. First try redeemPositions on the CTF with parentCollectionId = bytes32(0)
    // 2. If that doesn't work, try the NegRiskAdapter

    const ctfAbi = parseAbi([
      "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
      "function balanceOf(address owner, uint256 id) view returns (uint256)",
    ]);

    // NegRiskAdapter.redeemPositions takes (conditionId, amounts[2])
    // where amounts[0] = YES tokens to burn, amounts[1] = NO tokens to burn.
    // See: https://github.com/Polymarket/neg-risk-ctf-adapter
    const negRiskAbi = parseAbi([
      "function redeemPositions(bytes32 conditionId, uint256[] amounts) external",
    ]);

    const results: string[] = [];

    for (const pos of toRedeem) {
      results.push(`Trying: ${pos.title.slice(0, 45)} (${pos.outcome}, $${pos.currentValue.toFixed(2)})`);

      // Query actual on-chain balance for this position (atoms, 6 decimals)
      // The `asset` field IS the ERC-1155 position ID.
      let balanceAtoms: bigint;
      try {
        balanceAtoms = (await publicClient.readContract({
          address: CTF,
          abi: ctfAbi,
          functionName: "balanceOf",
          args: [account.address, BigInt(pos.asset)],
        })) as bigint;
      } catch (e) {
        results.push(`  balanceOf failed, falling back to data-api size: ${e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80)}`);
        balanceAtoms = BigInt(Math.floor(pos.size * 1_000_000));
      }

      if (balanceAtoms === BigInt(0)) {
        results.push(`  skip: zero balance on-chain (asset already redeemed or merged)`);
        continue;
      }

      // outcomeIndex 0 = YES (amounts[0]), outcomeIndex 1 = NO (amounts[1])
      const amounts: [bigint, bigint] = pos.outcomeIndex === 0
        ? [balanceAtoms, BigInt(0)]
        : [BigInt(0), balanceAtoms];
      results.push(`  balance=${balanceAtoms.toString()} atoms, amounts=[${amounts[0].toString()}, ${amounts[1].toString()}]`);

      // Try NegRiskAdapter first (correct path for negRisk markets)
      try {
        const hash = await walletClient.writeContract({
          address: NEG_RISK_ADAPTER,
          abi: negRiskAbi,
          functionName: "redeemPositions",
          args: [pos.conditionId as `0x${string}`, amounts],
        });
        results.push(`  NegRiskAdapter TX: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        results.push(`  Confirmed block ${receipt.blockNumber} — status: ${receipt.status}`);
        continue;
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 180) : String(e).slice(0, 180);
        results.push(`  NegRiskAdapter failed: ${msg}`);
      }

      // Fallback: try CTF directly with zero parent and proper index set
      try {
        const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
        // indexSet = 1 << outcomeIndex (1 for YES, 2 for NO)
        const indexSet = BigInt(1) << BigInt(pos.outcomeIndex);
        const hash = await walletClient.writeContract({
          address: CTF,
          abi: ctfAbi,
          functionName: "redeemPositions",
          args: [USDC_E, ZERO, pos.conditionId as `0x${string}`, [indexSet]],
        });
        results.push(`  CTF TX: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        results.push(`  Confirmed block ${receipt.blockNumber} — status: ${receipt.status}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 100) : String(e).slice(0, 100);
        results.push(`  CTF also failed: ${msg}`);
      }
    }

    // Check USDC balance after
    const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
    const balance = await publicClient.readContract({
      address: USDC_E,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    const usdcBalance = Number(balance) / 1e6;

    return Response.json({
      ok: true,
      attempted: toRedeem.length,
      results,
      walletBalance: Math.round(usdcBalance * 100) / 100,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
