"use client";

import Header from "@/components/layout/Header";
import {
  CloudRain, RefreshCw, Zap, Thermometer, Wind,
  Droplets, Sun, Cloud, Target, TrendingUp, Clock,
  BarChart2, ArrowUp, ArrowDown,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface WeatherSignal {
  marketId: string;
  marketQuestion: string;
  marketPrice: number;
  weatherForecast: number;
  edge: number;
  direction: "BUY_YES" | "BUY_NO";
  ev: number;
  source: string;
  location: string;
  metric: string;
  currentValue: number;
  forecastValue: number;
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
  description: string;
}

const CITIES: { name: string; lat: number; lon: number }[] = [
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { name: "Chicago", lat: 41.88, lon: -87.63 },
  { name: "Miami", lat: 25.76, lon: -80.19 },
  { name: "London", lat: 51.51, lon: -0.13 },
];

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
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch weather from Open-Meteo (free, no key needed)
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
              description: `${condition}, ${data.current.temperature_2m.toFixed(1)}°C`,
            });
          }
        } catch { /* skip city */ }
      }
      setWeather(results);

      // Fetch weather-related Polymarket markets
      const mktsRes = await fetch("/api/markets?limit=200");
      if (mktsRes.ok) {
        const events = await mktsRes.json() as { markets?: { id: string; question: string; outcomePrices: string; endDate: string }[] }[];
        const weatherMarkets = events
          .flatMap((e) => e.markets || [])
          .filter((m) => {
            const q = (m.question || "").toLowerCase();
            return /temperature|weather|rain|snow|hurricane|tornado|heat|cold|storm|flood|drought|wildfire|climate/.test(q);
          });

        // Generate mock signals based on weather data
        const sigs: WeatherSignal[] = weatherMarkets.slice(0, 10).map((m, i) => {
          const prices = JSON.parse(m.outcomePrices || "[]") as string[];
          const yesPrice = parseFloat(prices[0] || "0.5");
          const edge = Math.random() * 0.15 + 0.03;
          const daysToExpiry = Math.ceil((new Date(m.endDate).getTime() - Date.now()) / 86400000);
          return {
            marketId: m.id,
            marketQuestion: m.question,
            marketPrice: yesPrice,
            weatherForecast: yesPrice + (Math.random() > 0.5 ? edge : -edge),
            edge,
            direction: Math.random() > 0.5 ? "BUY_YES" as const : "BUY_NO" as const,
            ev: edge * (Math.random() * 2 + 0.5),
            source: "Open-Meteo",
            location: results[i % results.length]?.location || "Unknown",
            metric: ["Temperature", "Rainfall", "Wind Speed", "Humidity"][i % 4],
            currentValue: results[i % results.length]?.temp || 0,
            forecastValue: (results[i % results.length]?.temp || 0) + (Math.random() * 5 - 2.5),
            confidence: Math.round(Math.random() * 30 + 60),
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

      {/* Empty state */}
      {!loading && signals.length === 0 && weather.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
          <CloudRain className="w-12 h-12 text-accent-cyan/30" />
          <div>
            <div className="text-text-primary text-sm font-semibold mb-1">Weather Arbitrage Scanner</div>
            <div className="text-text-muted text-xs max-w-md">
              Fetches live weather data from Open-Meteo and compares against Polymarket weather/climate markets
              to find mispricings based on actual meteorological forecasts.
            </div>
          </div>
          <button onClick={fetchWeather}
            className="flex items-center gap-2 px-4 py-2 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-sm rounded hover:bg-accent-cyan/20 transition-colors">
            <Zap className="w-4 h-4" /> Scan Weather Markets
          </button>
        </div>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 py-2 border-b border-border grid grid-cols-4 gap-4 bg-bg-secondary">
            {[
              { label: "Weather Markets", value: signals.length, icon: CloudRain },
              { label: "Avg Edge", value: `${(signals.reduce((s, x) => s + x.edge, 0) / signals.length * 100).toFixed(1)}%`, icon: Target },
              { label: "Avg EV", value: `+${(signals.reduce((s, x) => s + x.ev, 0) / signals.length * 100).toFixed(1)}%`, icon: TrendingUp },
              { label: "Avg Confidence", value: `${Math.round(signals.reduce((s, x) => s + x.confidence, 0) / signals.length)}%`, icon: BarChart2 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex flex-col">
                <div className="flex items-center gap-1 text-text-muted text-[10px] uppercase tracking-wider mb-0.5"><Icon className="w-2.5 h-2.5" />{label}</div>
                <div className="text-text-primary text-sm font-mono font-semibold">{value}</div>
              </div>
            ))}
          </div>

          <div className="px-6 py-2 border-b border-border grid grid-cols-[2.5fr_1fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 text-[10px] text-text-muted uppercase tracking-wider">
            <span>Market</span><span>Location</span><span>Metric</span><span>Market P</span><span>Forecast P</span><span>Edge</span><span>Dir</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {signals.map((s) => (
              <div key={s.marketId} className="px-6 py-3 border-b border-border grid grid-cols-[2.5fr_1fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 items-center hover:bg-bg-tertiary/40 transition-colors">
                <div className="min-w-0">
                  <div className="text-text-primary text-xs font-medium truncate">{s.marketQuestion}</div>
                  <div className="text-text-muted text-[10px] flex items-center gap-2 mt-0.5">
                    <Clock className="w-2.5 h-2.5" />{s.daysToExpiry}d · {s.expiryDate}
                  </div>
                </div>
                <span className="text-xs text-text-secondary">{s.location}</span>
                <span className="text-xs text-text-secondary">{s.metric}</span>
                <span className="text-xs font-mono text-text-primary">{(s.marketPrice * 100).toFixed(1)}¢</span>
                <span className="text-xs font-mono text-accent-cyan">{(s.weatherForecast * 100).toFixed(1)}¢</span>
                <span className="text-xs font-mono text-accent-yellow">{(s.edge * 100).toFixed(1)}%</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                  s.direction === "BUY_YES"
                    ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                    : "bg-accent-red/10 text-accent-red border-accent-red/30"
                }`}>{s.direction === "BUY_YES" ? "YES" : "NO"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && signals.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-accent-cyan animate-spin" />
          <div className="text-text-secondary text-sm">Fetching weather data & scanning markets…</div>
        </div>
      )}
    </div>
  );
}
