import https from "https";
import dns from "dns";

// Force IPv4 lookups to avoid IPv6 connectivity issues
const lookup: dns.LookupFunction = (hostname, options, cb) => {
  if (typeof options === "function") {
    cb = options as typeof cb;
    options = {};
  }
  dns.lookup(hostname, { ...(options as object), family: 4 }, cb as Parameters<typeof dns.lookup>[2]);
};

const agent = new https.Agent({ lookup } as Parameters<typeof https.Agent>[0]);

export function httpsGet<T>(url: string, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Timeout after ${timeoutMs}ms`)); });
    req.on("error", reject);
  });
}
