"use client";

import Header from "@/components/layout/Header";
import {
  CloudRain, RefreshCw, Zap, Thermometer, Wind,
  Droplets, Sun, Cloud, Clock, Target, TrendingUp,
  BarChart2, AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface WeatherSignal {
  marketId: string;
  marketQuestion: string;
  marketPrice: number;
  forecastProb: number;
  edge: number;
  direction: "BUY_YES" | "BUY_NO";
  ev: number;
  location: string;
  metric: string;
  confidence: number;
  expiryDate: string;
  daysToExpiry: number;
}

interface WeatherData {
  location: string;
  temp: number;
  humidity: number;
  windSpeed: number;
  condition: string;
}

const CITIES: { name: string; lat: number; lon: number }[] = [
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { name: "Chicago", lat: 41.88, lon: -87.63 },
  { name: "Miami", lat: 25.76, lon: -80.19 },
  { name: "London", lat: 51.51, lon: -0.13 },
];

// Strict weather/climate keyword matching
const WEATHER_REGEX = /\b(temperature|degrees|fahrenheit|celsius|heat\s?wave|cold\s?snap|rain(?:fall)?|snow(?:fall)?|hurricane|typhoon|tornado|cyclone|flood(?:ing)?|drought|wildfire|blizzard|frost|ice\s?storm|el\s?ni[nñ]o|la\s?ni[nñ]a|monsoon|hail|thunderstorm|wind\s?(?:speed|chill)|weather\s+event|climate\s+(?:disaster|event|record)|record\s+(?:high|low|heat|cold|temp))\b/i;

// Exclude political/geopolitical markets that contain climate-adjacent words
const EXCLUDE_REGEX = /\b(election|nato|troops|ukraine|russia|sovereignty|congress|president|vote|war|military|sanctions|ceasefire|treaty|parliament|legislation|government)\b/i;

function WeatherIcon({ condition }: { condition: string }) {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle")) return <CloudRain className="w-4 h-4 text-accent-cyan" />;
  if (c.includes("cloud")) return <Cloud className="w-4 h-4 text-text-muted" />;
  if (c.includes("clear") || c.includes("sun")) return <Sun className="w-4 h-4 text-accent-yellow" />;
  return <Cloud className="w-4 h-4 text-text-muted" />;
}

export default function WeatherArbPage() {
  const [weather, setWeather] = useState<WeatherData[]>([]);
  const [signals, setSignals] = useState<WeatherSignal[]>([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [weatherMatchCount, setWeatherMatchCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch live weather from Open-Meteo
      const results: WeatherData[] = [];
      for (const city of CITIES) {
        try {
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`
          );
          if (res.ok) {
            const data = await res.json() as {
              current: { temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number };
            };
            const wmo = data.current.weather_code;
            const condition = wmo <= 3 ? "Clear" : wmo <= 49 ? "Cloudy" : wmo <= 69 ? "Rain" : wmo <= 79 ? "Snow" : "Storm";
            results.push({
              location: city.name,
              temp: Math.round(data.current.temperature_2m * 10) / 10,
              humidity: data.current.relative_humidity_2m,
              windSpeed: Math.round(data.current.wind_speed_10m * 10) / 10,
              condition,
            });
          }
        } catch { /* skip city */ }
      }
      setWeather(results);

      // Fetch ALL Polymarket markets and strictly filter for weather
      const mktsRes = await fetch("/api/markets?limit=500");
      if (mktsRes.ok) {
        const events = await mktsRes.json() as { markets?: { id: string; question: string; outcomePrices: string; endDate: string; active?: boolean; closed?: boolean }[] }[];
        const allMarkets = events.flatMap((e) => e.markets || []).filter(m => m.active !== false && m.closed !== true);
        setTotalScanned(allMarkets.length);

        // Strict weather filtering: must match weather regex AND not match exclusion regex
        const weatherMarkets = allMarkets.filter((m) => {
          const q = (m.question || "");
          return WEATHER_REGEX.test(q) && !EXCLUDE_REGEX.test(q);
        });
        setWeatherMatchCount(weatherMarkets.length);

        // Build real signals from actual weather markets
        const sigs: WeatherSignal[] = weatherMarkets.map((m) => {
          const prices = JSON.parse(m.outcomePrices || "[]") as string[];
          const yesPrice = parseFloat(prices[0] || "0.5");
          const daysToExpiry = Math.ceil((new Date(m.endDate).getTime() - Date.now()) / 86400000);

          // TODO: Build real forecast model based on historical weather data
          // For now, show the market data without fake forecast
          return {
            marketId: m.id,
            marketQuestion: m.question,
            marketPrice: yesPrice,
            forecastProb: yesPrice, // No forecast model yet
            edge: 0,
            direction: "BUY_YES" as const,
            ev: 0,
            location: "—",
            metric: "—",
            confidence: 0,
            expiryDate: new Date(m.endDate).toISOString().split("T")[0],
            daysToExpiry: Math.max(1, daysToExpiry),
          };
        });
        setSignals(sigs);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Weather Arb"
        subtitle="Compare live weather data to Polymarket weather/climate markets"
        actions={
          <button onClick={fetchWeather} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs rounded hover:bg-accent-cyan/20 transition-colors disabled:opacity-40">
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {loading ? "Scanning…" : "Scan Weather"}
          </button>
        }
      />

      {/* Weather tiles */}
      {weather.length > 0 && (
        <div className="px-6 py-3 border-b border-border bg-bg-secondary">
          <div className="text-text-muted text-[10px] uppercase tracking-wider mb-2">Live Weather Data</div>
          <div className="grid grid-cols-5 gap-3">
            {weather.map((w) => (
              <div key={w.location} className="bg-bg-tertiary/50 border border-border rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <WeatherIcon condition={w.condition} />
                  <span className="text-text-primary text-xs font-semibold">{w.location}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="flex items-center gap-0.5 text-text-muted text-[9px]"><Thermometer className="w-2.5 h-2.5" />Temp</div>
                    <div className="text-xs font-mono text-text-primary">{w.temp}°C</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-0.5 text-text-muted text-[9px]"><Droplets className="w-2.5 h-2.5" />Humid</div>
                    <div className="text-xs font-mono text-text-primary">{w.humidity}%</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-0.5 text-text-muted text-[9px]"><Wind className="w-2.5 h-2.5" />Wind</div>
                    <div className="text-xs font-mono text-text-primary">{w.windSpeed}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      {totalScanned > 0 && (
        <div className="px-6 py-2 border-b border-border grid grid-cols-4 gap-4 bg-bg-secondary">
          {[
            { label: "Markets Scanned", value: totalScanned, icon: BarChart2 },
            { label: "Weather Markets", value: weatherMatchCount, icon: CloudRain },
            { label: "Signals", value: signals.filter(s => s.edge > 0.03).length, icon: Target },
            { label: "Avg Edge", value: signals.length > 0 ? `${(signals.reduce((s, x) => s + x.edge, 0) / signals.length * 100).toFixed(1)}%` : "—", icon: TrendingUp },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex flex-col">
              <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5"><Icon className="w-2.5 h-2.5" />{label}</div>
              <div className="text-text-primary text-sm font-mono font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* No weather markets found */}
      {totalScanned > 0 && weatherMatchCount === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
          <AlertTriangle className="w-12 h-12 text-accent-yellow/40" />
          <div>
            <div className="text-text-primary text-sm font-semibold mb-1">No Weather Markets Found</div>
            <div className="text-text-muted text-xs max-w-md">
              Scanned {totalScanned} Polymarket markets — none are currently weather/climate related.
              Polymarket occasionally lists hurricane, temperature record, wildfire, and drought markets.
              The scanner will find them when they appear.
            </div>
          </div>
          <div className="text-text-muted text-[10px] mt-2">
            Monitoring for: temperature, rainfall, snow, hurricane, tornado, flood, drought, wildfire, blizzard, heatwave
          </div>
        </div>
      )}

      {/* Weather markets found */}
      {signals.length > 0 && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 py-2 border-b border-border grid grid-cols-[2.5fr_1fr_1fr_1fr_0.8fr_0.8fr] gap-3 text-[10px] text-text-muted uppercase tracking-wider">
            <span>Market</span><span>Expiry</span><span>Market Price</span><span>Forecast</span><span>Edge</span><span>Direction</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {signals.map((s) => (
              <div key={s.marketId} className="px-6 py-3 border-b border-border grid grid-cols-[2.5fr_1fr_1fr_1fr_0.8fr_0.8fr] gap-3 items-center hover:bg-bg-tertiary/40 transition-colors">
                <div className="min-w-0">
                  <div className="text-text-primary text-xs font-medium truncate">{s.marketQuestion}</div>
                  <div className="text-text-muted text-[10px] flex items-center gap-2 mt-0.5">
                    <Clock className="w-2.5 h-2.5" />{s.daysToExpiry}d · {s.expiryDate}
                  </div>
                </div>
                <span className="text-xs text-text-secondary font-mono">{s.daysToExpiry}d</span>
                <span className="text-xs font-mono text-text-primary">{(s.marketPrice * 100).toFixed(1)}¢</span>
                <span className="text-xs font-mono text-accent-cyan">{s.forecastProb > 0 ? `${(s.forecastProb * 100).toFixed(1)}¢` : "—"}</span>
                <span className="text-xs font-mono text-accent-yellow">{s.edge > 0 ? `${(s.edge * 100).toFixed(1)}%` : "—"}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                  s.edge > 0
                    ? s.direction === "BUY_YES"
                      ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                      : "bg-accent-red/10 text-accent-red border-accent-red/30"
                    : "bg-bg-tertiary text-text-muted border-border"
                }`}>{s.edge > 0 ? (s.direction === "BUY_YES" ? "YES" : "NO") : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && signals.length === 0 && weather.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
          <CloudRain className="w-12 h-12 text-accent-cyan/30" />
          <div>
            <div className="text-text-primary text-sm font-semibold mb-1">Weather Arbitrage Scanner</div>
            <div className="text-text-muted text-xs max-w-md">
              Fetches live weather data from Open-Meteo and scans Polymarket for weather/climate markets
              (hurricanes, temperature records, wildfires, droughts, etc.) to find mispricings.
            </div>
          </div>
          <button onClick={fetchWeather}
            className="flex items-center gap-2 px-4 py-2 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-sm rounded hover:bg-accent-cyan/20 transition-colors">
            <Zap className="w-4 h-4" /> Scan Weather Markets
          </button>
        </div>
      )}

      {loading && signals.length === 0 && weather.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-accent-cyan animate-spin" />
          <div className="text-text-secondary text-sm">Fetching weather data & scanning markets…</div>
        </div>
      )}
    </div>
  );
}
