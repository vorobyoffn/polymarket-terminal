// Whale Copy Trading Engine
// Monitors profitable Polymarket wallets and mirrors their trades.

const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";
const GAMMA_API = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

async function cloudGet<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WhaleWallet {
  address: string;
  label: string;
  lastChecked: string;
}

export interface WhaleActivity {
  walletAddress: string;
  walletLabel: string;
  marketId: string;
  marketQuestion: string;
  tokenId: string;
  side: "BUY" | "SELL";
  outcome: "YES" | "NO";
  price: number;
  size: number;
  timestamp: string;
}

export interface CopySignal {
  activity: WhaleActivity;
  marketPrice: number;
  slippage: number;
  shouldCopy: boolean;
  reason: string;
}

export interface CopyTraderState {
  running: boolean;
  wallets: WhaleWallet[];
  recentActivity: WhaleActivity[];
  signals: CopySignal[];
  tradesExecuted: number;
  lastScanTime: string | null;
  scanCount: number;
  error: string | null;
}

// ── Known profitable wallets ─────────────────────────────────────────────────

const DEFAULT_WHALES: WhaleWallet[] = [
  { address: "0x1B6E5EE3a01e52e25441CD09CCE7eec25Bd7a437", label: "Whale Alpha", lastChecked: "" },
  { address: "0xD91a4966a34e27B68f665c94C3F06fA37C7a0A52", label: "Domer", lastChecked: "" },
];

// ── Singleton state ──────────────────────────────────────────────────────────

let state: CopyTraderState = {
  running: false,
  wallets: DEFAULT_WHALES,
  recentActivity: [],
  signals: [],
  tradesExecuted: 0,
  lastScanTime: null,
  scanCount: 0,
  error: null,
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

// ── Activity Scanner ─────────────────────────────────────────────────────────

async function fetchWalletPositions(wallet: WhaleWallet): Promise<WhaleActivity[]> {
  const activities: WhaleActivity[] = [];
  try {
    // Use the data API to get wallet's current positions
    const positions = await cloudGet<Record<string, unknown>[]>(
      `https://data-api.polymarket.com/positions?user=${wallet.address}&sizeThreshold=50&limit=20`,
      10000
    );
    for (const pos of (positions || []).slice(0, 10)) {
      activities.push({
        walletAddress: wallet.address,
        walletLabel: wallet.label,
        marketId: (pos.market as string) || (pos.conditionId as string) || "",
        marketQuestion: (pos.title as string) || (pos.market as string) || "Unknown",
        tokenId: (pos.asset as string) || "",
        side: "BUY",
        outcome: (pos.outcome as string) === "No" ? "NO" : "YES",
        price: parseFloat((pos.avgPrice as string) || "0") || parseFloat((pos.curPrice as string) || "0") || 0.5,
        size: Math.abs(parseFloat((pos.size as string) || "0") || 0),
        timestamp: (pos.timestamp as string) || new Date().toISOString(),
      });
    }
  } catch {
    // Data API may not be accessible for all wallets
  }
  return activities;
}

async function scanWhales() {
  try {
    state.error = null;
    state.lastScanTime = new Date().toISOString();
    state.scanCount++;

    const allActivity: WhaleActivity[] = [];
    for (const wallet of state.wallets) {
      try {
        const activity = await fetchWalletPositions(wallet);
        allActivity.push(...activity);
        wallet.lastChecked = new Date().toISOString();
      } catch { /* skip */ }
    }

    state.recentActivity = allActivity
      .filter(a => a.size > 0)
      .sort((a, b) => b.size - a.size);

    // Generate copy signals for large positions
    state.signals = state.recentActivity
      .filter(a => a.side === "BUY" && a.size >= 50)
      .slice(0, 15)
      .map(a => ({
        activity: a,
        marketPrice: a.price,
        slippage: 0,
        shouldCopy: a.size >= 100,
        reason: a.size >= 100
          ? `${a.walletLabel} holds $${a.size.toFixed(0)} on ${a.outcome}`
          : "Position too small to copy",
      }));

    console.log(`[CopyTrader] Scan #${state.scanCount}: ${state.wallets.length} wallets, ${state.recentActivity.length} positions, ${state.signals.filter(s => s.shouldCopy).length} signals`);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getCopyState(): CopyTraderState {
  return { ...state };
}

export function startCopyTrader(intervalSec = 120) {
  if (state.running) return;
  state.running = true;
  scanWhales();
  pollTimer = setInterval(scanWhales, intervalSec * 1000);
  console.log(`[CopyTrader] Started — polling every ${intervalSec}s`);
}

export function stopCopyTrader() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state.running = false;
}

export function addWhaleWallet(address: string, label: string) {
  if (state.wallets.find(w => w.address.toLowerCase() === address.toLowerCase())) return;
  state.wallets.push({ address, label, lastChecked: "" });
}

export function removeWhaleWallet(address: string) {
  state.wallets = state.wallets.filter(w => w.address.toLowerCase() !== address.toLowerCase());
}
