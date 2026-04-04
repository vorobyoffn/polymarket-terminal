import { NextRequest } from "next/server";

const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

// USDC.e on Polygon
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
// USDC (native) on Polygon
const USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

// Polymarket proxy wallet
const POLYMARKET_PROXY = process.env.POLYMARKET_PROXY || "0x999c4Ca086561914928F423090ac2A218f125A61";

// ERC-20 balanceOf(address) selector
const BALANCE_OF_SELECTOR = "0x70a08231";

async function getErc20Balance(walletAddress: string, tokenAddress: string): Promise<number> {
  const paddedAddress = walletAddress.toLowerCase().replace("0x", "").padStart(64, "0");
  const data = BALANCE_OF_SELECTOR + paddedAddress;

  const res = await fetch(POLYGON_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: tokenAddress, data }, "latest"],
      id: 1,
    }),
  });

  const json = await res.json() as { result: string };
  const rawBalance = BigInt(json.result || "0x0");
  // USDC has 6 decimals
  return Number(rawBalance) / 1e6;
}

async function getMaticBalance(walletAddress: string): Promise<number> {
  const res = await fetch(POLYGON_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [walletAddress, "latest"],
      id: 1,
    }),
  });

  const json = await res.json() as { result: string };
  const rawBalance = BigInt(json.result || "0x0");
  return Number(rawBalance) / 1e18;
}

export async function GET(req: NextRequest) {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    return Response.json({ error: "No private key configured" }, { status: 400 });
  }

  try {
    // Derive EOA address from private key
    const { privateKeyToAccount } = await import("viem/accounts");
    const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    const eoaAddress = account.address;

    // Fetch balances for both EOA and Polymarket proxy wallet
    const [eoaUsdce, eoaUsdcNative, eoaMatic, proxyUsdce, proxyUsdcNative, proxyMatic] = await Promise.all([
      getErc20Balance(eoaAddress, USDC_ADDRESS),
      getErc20Balance(eoaAddress, USDC_NATIVE),
      getMaticBalance(eoaAddress),
      getErc20Balance(POLYMARKET_PROXY, USDC_ADDRESS),
      getErc20Balance(POLYMARKET_PROXY, USDC_NATIVE),
      getMaticBalance(POLYMARKET_PROXY),
    ]);

    const eoaUsdc = Math.round((eoaUsdce + eoaUsdcNative) * 100) / 100;
    const proxyUsdc = Math.round((proxyUsdce + proxyUsdcNative) * 100) / 100;

    // Also try to get Polymarket exchange balance via CLOB API (authenticated)
    let exchangeBalance = 0;
    try {
      const { ClobClient } = await import("@polymarket/clob-client");
      const { createWalletClient: cwc, http: httpTransport } = await import("viem");
      const { privateKeyToAccount: pk2a } = await import("viem/accounts");
      const { polygon: poly } = await import("viem/chains");

      const acc = pk2a(normalizedKey as `0x${string}`);
      const wc = cwc({ account: acc, chain: poly, transport: httpTransport(POLYGON_RPC) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tmpClient = new ClobClient("https://clob.polymarket.com", 137, wc as any);
      const creds = await tmpClient.createOrDeriveApiKey();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authed = new ClobClient("https://clob.polymarket.com", 137, wc as any, creds, 2, POLYMARKET_PROXY);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const balData = await (authed as any).getBalanceAllowance({ asset_type: "COLLATERAL" });
      if (balData?.balance) {
        exchangeBalance = parseFloat(balData.balance) / 1e6;
      }
    } catch {
      // Exchange balance query failed — that's ok, show on-chain data only
    }

    const totalUsdc = Math.round((eoaUsdc + proxyUsdc + exchangeBalance) * 100) / 100;

    return Response.json({
      eoa: {
        address: eoaAddress,
        usdc: eoaUsdc,
        matic: Math.round(eoaMatic * 10000) / 10000,
      },
      proxy: {
        address: POLYMARKET_PROXY,
        usdc: proxyUsdc,
        matic: Math.round(proxyMatic * 10000) / 10000,
      },
      exchange: Math.round(exchangeBalance * 100) / 100,
      totalUsdc,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Wallet balance error:", error);
    return Response.json({ error: "Failed to fetch balance" }, { status: 500 });
  }
}
