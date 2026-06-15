# AI Trading

Monorepo for AI-assisted trading tools. The first app is the **EMA Crossover Scanner** — ranks stocks by how recently the 20 EMA crossed above the 50 EMA, with TradingView watchlist support.

## Apps

| App | Path | Description |
|-----|------|-------------|
| EMA Crossover Scanner | [`apps/ema-crossover-scanner`](./apps/ema-crossover-scanner) | Blue-chip + TradingView watchlist scanner |

## Quick start

```bash
cd apps/ema-crossover-scanner
npm install
cp .env.example .env.local
npm run dev
```

## Deploy (Vercel)

Import this repository in Vercel and set **Root Directory** to:

```
apps/ema-crossover-scanner
```

Optional env vars: `WATCHLIST_SYMBOLS`, `INCLUDE_BLUE_CHIPS`, `HISTORY_DAYS`.

## Disclaimer

For research and education only. Not financial advice.
