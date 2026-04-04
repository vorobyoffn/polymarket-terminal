"use client";

import Header from "@/components/layout/Header";
import {
  Bot, Plus, Trash2, Play, Square, Settings2,
  Zap, TrendingUp, ChevronDown, ChevronUp,
  AlertTriangle, Code, BarChart2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useStore, type BotStrategy } from "@/lib/store";

type RuleType = "price_threshold" | "volume_spike" | "time_based" | "category_filter";

interface Rule {
  type: RuleType;
  label: string;
  params: Record<string, string | number>;
}

const RULE_TEMPLATES: { type: RuleType; label: string; desc: string; defaults: Record<string, string | number> }[] = [
  { type: "price_threshold", label: "Price Threshold", desc: "Buy when YES price drops below / above a level", defaults: { operator: "below", threshold: 0.30 } },
  { type: "volume_spike", label: "Volume Spike", desc: "Act when volume exceeds N× 24h average", defaults: { multiplier: 3, action: "buy_yes" } },
  { type: "time_based", label: "Time-Based", desc: "Buy markets expiring within N days", defaults: { maxDays: 7, minPrice: 0.10, maxPrice: 0.90 } },
  { type: "category_filter", label: "Category Filter", desc: "Only trade markets matching keywords", defaults: { keywords: "bitcoin,crypto", action: "buy_yes" } },
];

function genBotId() { return `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

export default function CustomBotsPage() {
  const { bots, addBot, updateBot, removeBot } = useStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRules, setNewRules] = useState<Rule[]>([]);
  const [expandedBot, setExpandedBot] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const addRule = (type: RuleType) => {
    const template = RULE_TEMPLATES.find((t) => t.type === type);
    if (!template) return;
    setNewRules((prev) => [...prev, { type, label: template.label, params: { ...template.defaults } }]);
  };

  const removeRule = (idx: number) => setNewRules((prev) => prev.filter((_, i) => i !== idx));

  const createBot = () => {
    if (!newName || newRules.length === 0) return;
    addBot({
      id: genBotId(),
      name: newName,
      enabled: false,
      rules: newRules,
      createdAt: new Date().toISOString(),
    });
    setNewName("");
    setNewRules([]);
    setCreating(false);
  };

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Custom Bots"
        subtitle="Build rule-based automated trading strategies"
        actions={
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs rounded hover:bg-accent-green/20 transition-colors">
            <Plus className="w-3 h-3" /> New Bot
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Bot creation form */}
        {creating && (
          <div className="px-6 py-4 border-b border-border bg-bg-secondary/50">
            <div className="text-text-primary text-xs font-semibold mb-3 flex items-center gap-2">
              <Code className="w-3.5 h-3.5 text-accent-cyan" /> Create New Bot
            </div>
            <div className="flex items-center gap-3 mb-3">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bot name..."
                className="flex-1 max-w-xs bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan" />
            </div>

            {/* Rule templates */}
            <div className="text-text-muted text-[10px] uppercase tracking-wider mb-2">Add Rules</div>
            <div className="flex gap-2 mb-3">
              {RULE_TEMPLATES.map((t) => (
                <button key={t.type} onClick={() => addRule(t.type)}
                  className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary border border-border rounded text-[10px] text-text-secondary hover:border-accent-cyan/40 hover:text-accent-cyan transition-colors">
                  <Plus className="w-2.5 h-2.5" /> {t.label}
                </button>
              ))}
            </div>

            {/* Added rules */}
            {newRules.length > 0 && (
              <div className="space-y-2 mb-3">
                {newRules.map((rule, i) => (
                  <div key={i} className="bg-bg-tertiary border border-border rounded p-3 flex items-center gap-3">
                    <Zap className="w-3 h-3 text-accent-yellow flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-text-primary text-xs font-semibold">{rule.label}</div>
                      <div className="text-text-muted text-[10px] font-mono mt-0.5">
                        {Object.entries(rule.params).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </div>
                    </div>
                    <button onClick={() => removeRule(i)} className="p-1 text-text-muted hover:text-accent-red"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={createBot} disabled={!newName || newRules.length === 0}
                className="flex items-center gap-1 px-3 py-1.5 bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs rounded hover:bg-accent-green/20 transition-colors disabled:opacity-40">
                <Bot className="w-3 h-3" /> Create Bot
              </button>
              <button onClick={() => { setCreating(false); setNewRules([]); setNewName(""); }}
                className="px-3 py-1.5 text-text-muted text-xs hover:text-text-secondary transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {bots.length === 0 && !creating && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6 min-h-[60vh]">
            <Bot className="w-12 h-12 text-accent-green/30" />
            <div>
              <div className="text-text-primary text-sm font-semibold mb-1">Custom Bot Builder</div>
              <div className="text-text-muted text-xs max-w-md">
                Build rule-based bots that automatically scan Polymarket and trade based on your criteria:
                price thresholds, volume spikes, time-based entries, and category filters.
              </div>
            </div>
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-2 px-4 py-2 bg-accent-green/10 border border-accent-green/30 text-accent-green text-sm rounded hover:bg-accent-green/20 transition-colors">
              <Plus className="w-4 h-4" /> Create Your First Bot
            </button>
          </div>
        )}

        {/* Bot list */}
        {bots.length > 0 && (
          <div className="p-6 space-y-3">
            <div className="text-text-muted text-[10px] uppercase tracking-wider flex items-center gap-1">
              <BarChart2 className="w-3 h-3" /> Your Bots ({bots.length})
            </div>
            {bots.map((bot) => {
              const rules = bot.rules as Rule[];
              const isExpanded = expandedBot === bot.id;
              return (
                <div key={bot.id} className="bg-bg-secondary border border-border rounded overflow-hidden">
                  <div className="p-4 flex items-center gap-3 cursor-pointer hover:bg-bg-tertiary/30 transition-colors"
                    onClick={() => setExpandedBot(isExpanded ? null : bot.id)}>
                    <Bot className={`w-4 h-4 ${bot.enabled ? "text-accent-green" : "text-text-muted"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-text-primary text-xs font-semibold">{bot.name}</div>
                      <div className="text-text-muted text-[10px]">{rules.length} rule{rules.length !== 1 ? "s" : ""} · Created {new Date(bot.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {bot.enabled ? (
                        <>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/30">Running</span>
                          <button onClick={(e) => { e.stopPropagation(); updateBot(bot.id, { enabled: false }); }}
                            className="p-1 rounded hover:bg-accent-red/10 text-accent-red"><Square className="w-3 h-3" /></button>
                        </>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); updateBot(bot.id, { enabled: true }); }}
                          className="p-1 rounded hover:bg-accent-green/10 text-accent-green"><Play className="w-3 h-3" /></button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); removeBot(bot.id); }}
                        className="p-1 rounded hover:bg-accent-red/10 text-text-muted hover:text-accent-red"><Trash2 className="w-3 h-3" /></button>
                      {isExpanded ? <ChevronUp className="w-3 h-3 text-text-muted" /> : <ChevronDown className="w-3 h-3 text-text-muted" />}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-border">
                      <div className="text-text-muted text-[10px] uppercase tracking-wider mt-3 mb-2">Rules</div>
                      <div className="space-y-1.5">
                        {rules.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 rounded">
                            <Zap className="w-3 h-3 text-accent-yellow flex-shrink-0" />
                            <span className="text-text-primary text-xs">{r.label}</span>
                            <span className="text-text-muted text-[10px] font-mono ml-auto">
                              {Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(", ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
