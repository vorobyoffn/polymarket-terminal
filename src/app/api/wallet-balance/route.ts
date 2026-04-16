// Simple wallet balance check — uses node:https to avoid IPv6 issues

const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

async function rpcCall(method: string, params: unknown[]): Promise<string> {
  const https = await import("node:https");
  const dns = await import("node:dns");
  dns.setDefaultResultOrder("ipv4first");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 10000);
    const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
    const url = new URL(POLYGON_RPC);

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      family: 4,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(data) as { result?: string };
          resolve(j.result || "0x0");
        } catch { resolve("0x0"); }
      });
    });
    req.on("error", () => { clearTimeout(timer); resolve("0x0"); });
    req.write(body);
    req.end();
  });
}

export async function GET() {
  try {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      return Response.json({ eoa: { address: "", usdc: 0, matic: 0 }, proxy: { address: "", usdc: 0, matic: 0 }, exchange: 0, totalUsdc: 0 });
    }

    const { privateKeyToAccount } = await import("viem/accounts");
    const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    const eoaAddress = account.address;
    const paddedEoa = eoaAddress.toLowerCase().replace("0x", "").padStart(64, "0");

    // Only check EOA USDC.e and POL — skip proxy and exchange to keep it fast
    const [usdcHex, polHex] = await Promise.all([
      rpcCall("eth_call", [{ to: USDC_ADDRESS, data: "0x70a08231" + paddedEoa }, "latest"]),
      rpcCall("eth_getBalance", [eoaAddress, "latest"]),
    ]);

    const usdc = Number(BigInt(usdcHex)) / 1e6;
    const pol = Number(BigInt(polHex)) / 1e18;

    return Response.json({
      eoa: { address: eoaAddress, usdc: Math.round(usdc * 100) / 100, matic: Math.round(pol * 10000) / 10000 },
      proxy: { address: "", usdc: 0, matic: 0 },
      exchange: 0,
      totalUsdc: Math.round(usdc * 100) / 100,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Return zeroes instead of 500 to stop hammering
    return Response.json({
      eoa: { address: "", usdc: 0, matic: 0 },
      proxy: { address: "", usdc: 0, matic: 0 },
      exchange: 0,
      totalUsdc: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
