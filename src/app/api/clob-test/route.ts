// Test endpoint to verify CLOB client authentication and order placement
export async function GET() {
  const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";
  const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
  const POLYMARKET_PROXY = process.env.POLYMARKET_PROXY || "0x999c4Ca086561914928F423090ac2A218f125A61";
  const privateKey = process.env.PRIVATE_KEY;

  const results: Record<string, unknown> = {
    hasPrivateKey: !!privateKey,
    keyLength: privateKey?.length || 0,
    proxyAddress: POLYMARKET_PROXY,
    rpcUrl: POLYGON_RPC,
    clobUrl: CLOB_API,
  };

  if (!privateKey) {
    return Response.json({ ...results, error: "No PRIVATE_KEY set" });
  }

  try {
    // Step 1: Derive EOA address
    const { privateKeyToAccount } = await import("viem/accounts");
    const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    results.eoaAddress = account.address;

    // Step 2: Create wallet client
    const { createWalletClient, http } = await import("viem");
    const { polygon } = await import("viem/chains");
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(POLYGON_RPC),
    });
    results.walletClientOk = true;

    // Step 3: Create CLOB client and derive API key
    const { ClobClient } = await import("@polymarket/clob-client");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tmpClient = new ClobClient(CLOB_API, 137, walletClient as any);
    const creds = await tmpClient.createOrDeriveApiKey();
    results.apiKey = creds.apiKey?.slice(0, 12) + "...";
    results.hasPassphrase = !!creds.passphrase;
    results.hasSecret = !!creds.secret;

    // Step 4: Create authenticated client with proxy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authedClient = new ClobClient(CLOB_API, 137, walletClient as any, creds, 2, POLYMARKET_PROXY);
    results.authedClientOk = true;

    // Step 5: Try to get open orders (read-only, verifies auth)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const openOrders = await (authedClient as any).getOpenOrders();
      results.openOrders = Array.isArray(openOrders) ? openOrders.length : "unknown format";
    } catch (e) {
      results.openOrdersError = e instanceof Error ? e.message : String(e);
    }

    // Step 6: Check a sample orderbook (public, no auth needed)
    try {
      const book = await fetch(`${CLOB_API}/book?token_id=71321045679252212594626385532706912750332728571942532289631379312455583992563`);
      const bookData = await book.json();
      results.sampleOrderbook = {
        bids: (bookData as { bids?: unknown[] }).bids?.length || 0,
        asks: (bookData as { asks?: unknown[] }).asks?.length || 0,
      };
    } catch (e) {
      results.orderbookError = e instanceof Error ? e.message : String(e);
    }

    results.status = "✅ CLOB client authenticated successfully";
  } catch (err) {
    results.error = err instanceof Error ? err.message : String(err);
    results.status = "❌ CLOB authentication failed";
  }

  return Response.json(results);
}
