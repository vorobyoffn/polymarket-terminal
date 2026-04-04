"use client";

import Header from "@/components/layout/Header";
import {
  Settings, Shield, Key, Globe, Server, Wallet,
  Save, AlertTriangle, CheckCircle, Eye, EyeOff,
  RefreshCw,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";

export default function SettingsPage() {
  const {
    tradingMode, setTradingMode,
    balance, setBalance,
    privateKey, setPrivateKey,
    rpcUrl, setRpcUrl,
    clobApiKey, setClobApiKey,
  } = useStore();

  const [showKey, setShowKey] = useState(false);
  const [showClobKey, setShowClobKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [localBal, setLocalBal] = useState(balance);
  const [localKey, setLocalKey] = useState(privateKey);
  const [localRpc, setLocalRpc] = useState(rpcUrl);
  const [localClob, setLocalClob] = useState(clobApiKey);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    setLocalBal(balance);
    setLocalKey(privateKey);
    setLocalRpc(rpcUrl);
    setLocalClob(clobApiKey);
  }, [balance, privateKey, rpcUrl, clobApiKey]);

  const saveSettings = () => {
    setBalance(localBal);
    setPrivateKey(localKey);
    setRpcUrl(localRpc);
    setClobApiKey(localClob);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Settings"
        subtitle="Configure trading mode, API keys, and connections"
        actions={
          <button onClick={saveSettings}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs rounded hover:bg-accent-green/20 transition-colors">
            {saved ? <CheckCircle className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            {saved ? "Saved!" : "Save Settings"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Trading Mode */}
        <div className="bg-bg-secondary border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-accent-cyan" />
            <span className="text-text-primary text-sm font-semibold">Trading Mode</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setTradingMode("paper")}
              className={`p-4 rounded border transition-colors text-left ${
                tradingMode === "paper"
                  ? "bg-accent-yellow/5 border-accent-yellow/40 ring-1 ring-accent-yellow/20"
                  : "border-border hover:border-accent-yellow/20"
              }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-3 h-3 rounded-full border-2 ${tradingMode === "paper" ? "border-accent-yellow bg-accent-yellow" : "border-text-muted"}`} />
                <span className={`text-sm font-semibold ${tradingMode === "paper" ? "text-accent-yellow" : "text-text-secondary"}`}>Paper Trading</span>
              </div>
              <p className="text-text-muted text-[10px] ml-5">Simulated trades with virtual balance. No real money at risk.</p>
            </button>
            <button onClick={() => setTradingMode("live")}
              className={`p-4 rounded border transition-colors text-left ${
                tradingMode === "live"
                  ? "bg-accent-green/5 border-accent-green/40 ring-1 ring-accent-green/20"
                  : "border-border hover:border-accent-green/20"
              }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-3 h-3 rounded-full border-2 ${tradingMode === "live" ? "border-accent-green bg-accent-green" : "border-text-muted"}`} />
                <span className={`text-sm font-semibold ${tradingMode === "live" ? "text-accent-green" : "text-text-secondary"}`}>Live Trading</span>
              </div>
              <p className="text-text-muted text-[10px] ml-5">Real orders on Polymarket CLOB. Requires funded wallet + API keys.</p>
            </button>
          </div>
          {tradingMode === "live" && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-accent-red/5 border border-accent-red/20 rounded text-[10px] text-accent-red">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              Live mode places real trades with real money. Make sure your wallet is funded and all API keys are configured.
            </div>
          )}
        </div>

        {/* Balance */}
        <div className="bg-bg-secondary border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-4 h-4 text-accent-green" />
            <span className="text-text-primary text-sm font-semibold">Paper Balance</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-text-muted text-xs">Starting balance $</span>
            <input type="number" value={localBal} onChange={(e) => setLocalBal(parseFloat(e.target.value) || 10000)}
              className="w-32 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm font-mono text-text-primary focus:outline-none focus:border-accent-cyan" />
            <button onClick={() => setLocalBal(10000)}
              className="flex items-center gap-1 px-2 py-1 text-text-muted text-[10px] hover:text-text-secondary"><RefreshCw className="w-2.5 h-2.5" /> Reset to $10,000</button>
          </div>
        </div>

        {/* API Keys */}
        <div className="bg-bg-secondary border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <Key className="w-4 h-4 text-accent-yellow" />
            <span className="text-text-primary text-sm font-semibold">API Keys & Credentials</span>
          </div>
          <div className="space-y-4">
            {/* Private Key */}
            <div>
              <label className="text-text-muted text-[10px] uppercase tracking-wider block mb-1">Polygon Wallet Private Key</label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 pr-10 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
                />
                <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-text-muted text-[9px] mt-1">Used to sign orders on Polymarket CLOB. Export from MetaMask → Account Details.</p>
            </div>

            {/* CLOB API Key */}
            <div>
              <label className="text-text-muted text-[10px] uppercase tracking-wider block mb-1">Polymarket CLOB API Key</label>
              <div className="relative">
                <input
                  type={showClobKey ? "text" : "password"}
                  value={localClob}
                  onChange={(e) => setLocalClob(e.target.value)}
                  placeholder="API key..."
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 pr-10 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
                />
                <button onClick={() => setShowClobKey(!showClobKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                  {showClobKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-text-muted text-[9px] mt-1">Auto-derived from private key, or paste your Relayer API key here.</p>
            </div>

            {/* RPC URL */}
            <div>
              <label className="text-text-muted text-[10px] uppercase tracking-wider block mb-1">Polygon RPC URL</label>
              <input value={localRpc} onChange={(e) => setLocalRpc(e.target.value)}
                className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-cyan" />
              <p className="text-text-muted text-[9px] mt-1">Default: polygon-rpc.com. Use Alchemy/Infura for better reliability.</p>
            </div>
          </div>
        </div>

        {/* Connection Status */}
        <div className="bg-bg-secondary border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-accent-cyan" />
            <span className="text-text-primary text-sm font-semibold">Connection Status</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Polygon RPC", status: true, url: localRpc },
              { label: "Polymarket CLOB", status: true, url: "clob.polymarket.com" },
              { label: "Gamma API", status: true, url: "gamma-api.polymarket.com" },
            ].map((conn) => (
              <div key={conn.label} className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 rounded">
                <span className={`w-2 h-2 rounded-full ${conn.status ? "bg-accent-green" : "bg-accent-red"}`} />
                <div>
                  <div className="text-text-primary text-xs">{conn.label}</div>
                  <div className="text-text-muted text-[9px] font-mono">{conn.url}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
