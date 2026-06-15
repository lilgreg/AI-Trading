# EMA Crossover Scanner

Rank stocks by how recently the **20 EMA crossed above the 50 EMA** — built for TradingView workflows with a deploy-ready Next.js dashboard.

## What it does

- Scans a default **blue-chip** universe (AAPL, MSFT, NVDA, etc.)
- Merges in **your TradingView watchlist** (paste or upload `.txt` export)
- Computes daily 20/50 EMAs from Yahoo Finance OHLC data
- Sorts by **most recent bullish crossover first**
- Links each row to **TradingView** for chart review

## TradingView watchlist setup

TradingView does not expose a public REST API for personal watchlists. Use one of these:

1. **Export from TradingView** (recommended)
   - Open your watchlist → **Advanced view** → **Download list as TXT**
   - Upload the file in the dashboard, or paste the contents

2. **Environment variable** (for Vercel/production)
   ```env
   WATCHLIST_SYMBOLS=NASDAQ:AAPL,NYSE:JPM,NASDAQ:NVDA
   ```

Symbols can use TradingView format (`NASDAQ:AAPL`) or plain tickers (`AAPL`). Class shares like `BRK.B` are converted for Yahoo (`BRK-B`).

## Local development

```bash
cd ema-crossover-scanner
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCHLIST_SYMBOLS` | — | Comma/newline-separated symbols |
| `INCLUDE_BLUE_CHIPS` | `true` | Include built-in large-cap list |
| `HISTORY_DAYS` | `120` | Lookback for EMA calculation (60–365) |

## API

`GET /api/scan`

Query params:

- `watchlist` — inline symbol list (TradingView export text)
- `symbols` — additional symbols
- `blueChips=false` — skip default blue chips
- `onlyAbove=true` — filter to stocks where 20 EMA > 50 EMA now
- `days=120` — history window

## Deploy to Vercel + GitHub

1. Create a new GitHub repo and push this project:
   ```bash
   git add .
   git commit -m "Initial EMA crossover scanner"
   git remote add origin https://github.com/YOUR_USER/ema-crossover-scanner.git
   git push -u origin main
   ```

2. Import the repo in [Vercel](https://vercel.com/new)
3. Add env vars (`WATCHLIST_SYMBOLS`, etc.) in Project Settings
4. Deploy — Vercel auto-detects Next.js

## Roadmap ideas

- [ ] Scheduled scans (Vercel Cron) + email/Slack alerts on new crosses
- [ ] TradingView Lightweight Charts embed per symbol
- [ ] Pine Script alert webhook ingestion
- [ ] Optional TradingView Desktop bridge for live watchlist sync

## Disclaimer

This tool is for research and education only. It is **not** financial advice. Verify signals on TradingView before trading.
