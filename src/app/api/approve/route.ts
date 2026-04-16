// One-time USDC.e approval for Polymarket exchanges
export async function POST() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) return Response.json({ error: "No PRIVATE_KEY" }, { status: 400 });

  try {
    const { createWalletClient, createPublicClient, http, parseAbi } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { polygon } = await import("viem/chains");

    const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);

    const rpc = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
    const walletClient = createWalletClient({ account, chain: polygon, transport: http(rpc, { timeout: 30000 }) });
    const publicClient = createPublicClient({ chain: polygon, transport: http(rpc, { timeout: 30000 }) });

    const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
    const CTF = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const;
    const NEG = "0xC5d563A36AE78145C45a50134d48A1215220f80a" as const;
    const NEG2 = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const; // Neg Risk CTF Exchange v2 (weather markets)
    const MAX = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const abi = parseAbi(["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);

    const results: string[] = [];

    // CTF Exchange
    const a1 = await publicClient.readContract({ address: USDC_E, abi, functionName: "allowance", args: [account.address, CTF] });
    if (a1 === BigInt(0)) {
      const h1 = await walletClient.writeContract({ address: USDC_E, abi, functionName: "approve", args: [CTF, MAX] });
      await publicClient.waitForTransactionReceipt({ hash: h1 });
      results.push(`CTF approved: ${h1}`);
    } else {
      results.push("CTF already approved");
    }

    // Neg Risk Exchange
    const a2 = await publicClient.readContract({ address: USDC_E, abi, functionName: "allowance", args: [account.address, NEG] });
    if (a2 === BigInt(0)) {
      const h2 = await walletClient.writeContract({ address: USDC_E, abi, functionName: "approve", args: [NEG, MAX] });
      await publicClient.waitForTransactionReceipt({ hash: h2 });
      results.push(`NegRisk approved: ${h2}`);
    } else {
      results.push("NegRisk already approved");
    }

    // Neg Risk Exchange v2 (weather/multi-outcome markets)
    const a3 = await publicClient.readContract({ address: USDC_E, abi, functionName: "allowance", args: [account.address, NEG2] });
    if (a3 === BigInt(0)) {
      const h3 = await walletClient.writeContract({ address: USDC_E, abi, functionName: "approve", args: [NEG2, MAX] });
      await publicClient.waitForTransactionReceipt({ hash: h3 });
      results.push(`NegRisk v2 approved: ${h3}`);
    } else {
      results.push("NegRisk v2 already approved");
    }

    return Response.json({ ok: true, results, address: account.address });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
