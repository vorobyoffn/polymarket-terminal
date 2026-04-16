#!/bin/bash
# Polymarket Auto-Trading Bot — runs in background
cd "$(dirname "$0")"

# Prevent Mac from sleeping
caffeinate -d &
CAFF_PID=$!

echo "🤖 Starting Polymarket Trading Bot..."
echo "   Press Ctrl+C to stop"
echo "   Dashboard: http://localhost:3001"
echo ""

# Start the Next.js server
npm run dev -- --port 3001 &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  sleep 3
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ 2>/dev/null | grep -q "200"; then
    echo "✅ Server ready at http://localhost:3001"
    break
  fi
done

# Start the auto-trader in live mode
sleep 5
curl -s -X POST "http://localhost:3001/api/auto-trade" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","mode":"live","bankroll":562,"scanIntervalSec":60,"minLor":0.5,"minEdge":0.03,"maxConcurrentTrades":5}'

echo ""
echo "🟢 Auto-trader running in LIVE mode"
echo "   Scanning every 60 seconds"
echo "   Dashboard: http://localhost:3001/btc"
echo ""

# Keep running until Ctrl+C
trap "echo 'Stopping...'; kill $SERVER_PID $CAFF_PID 2>/dev/null; exit" SIGINT SIGTERM
wait $SERVER_PID
