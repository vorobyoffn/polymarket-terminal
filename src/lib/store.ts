"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TradingMode = "paper" | "live";

export interface BotStrategy {
  id: string;
  name: string;
  enabled: boolean;
  rules: unknown[];
  createdAt: string;
}

export interface CopyTarget {
  address: string;
  label: string;
  enabled: boolean;
  categories: string[];
}

export const FALLBACK_TRADING_ADDRESS = "0x33f2c6D0ADe8f914E31E4092A34b629b17294Fc0";

interface AppState {
  // Mode
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;

  // Balance
  balance: number;
  setBalance: (balance: number) => void;

  // Connected wallet (from wagmi). When null, API calls fall back to FALLBACK_TRADING_ADDRESS.
  connectedAddress: string | null;
  setConnectedAddress: (addr: string | null) => void;

  // Settings
  privateKey: string;
  setPrivateKey: (key: string) => void;
  rpcUrl: string;
  setRpcUrl: (url: string) => void;
  clobApiKey: string;
  setClobApiKey: (key: string) => void;

  // Bots
  bots: BotStrategy[];
  addBot: (bot: BotStrategy) => void;
  updateBot: (id: string, updates: Partial<BotStrategy>) => void;
  removeBot: (id: string) => void;

  // Copy targets
  copyTargets: CopyTarget[];
  addCopyTarget: (target: CopyTarget) => void;
  updateCopyTarget: (address: string, updates: Partial<CopyTarget>) => void;
  removeCopyTarget: (address: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      tradingMode: "live",
      setTradingMode: (mode) => set({ tradingMode: mode }),
      balance: 518,
      setBalance: (balance) => set({ balance }),
      connectedAddress: null,
      setConnectedAddress: (connectedAddress) => set({ connectedAddress }),
      privateKey: "",
      setPrivateKey: (privateKey) => set({ privateKey }),
      rpcUrl: "https://polygon-rpc.com",
      setRpcUrl: (rpcUrl) => set({ rpcUrl }),
      clobApiKey: "",
      setClobApiKey: (clobApiKey) => set({ clobApiKey }),
      bots: [],
      addBot: (bot) => set((s) => ({ bots: [...s.bots, bot] })),
      updateBot: (id, u) => set((s) => ({ bots: s.bots.map((b) => b.id === id ? { ...b, ...u } : b) })),
      removeBot: (id) => set((s) => ({ bots: s.bots.filter((b) => b.id !== id) })),
      copyTargets: [],
      addCopyTarget: (t) => set((s) => ({ copyTargets: [...s.copyTargets, t] })),
      updateCopyTarget: (addr, u) => set((s) => ({ copyTargets: s.copyTargets.map((t) => t.address === addr ? { ...t, ...u } : t) })),
      removeCopyTarget: (addr) => set((s) => ({ copyTargets: s.copyTargets.filter((t) => t.address !== addr) })),
    }),
    {
      name: "polymarket-terminal-store",
      version: 2,
      migrate: (persisted: unknown) => {
        const state = persisted as Record<string, unknown>;
        // Force live mode and reset paper balance
        return { ...state, tradingMode: "live", balance: 518 };
      },
    }
  )
);
