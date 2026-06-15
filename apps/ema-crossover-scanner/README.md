# EMA Crossover Scanner

Rank stocks by how recently the **20 EMA crossed above the 50 EMA** — with **instant load** from a server-precomputed cache.

## What it does

- Precomputes scans on the server (Vercel Cron every 30 min)
- **Instant dashboard** — reads cached JSON snapshot in &lt;500ms
- Dual cross columns: **Cross 1h** and **Cross 4h** (independent sort)
- Merges **TradingView watchlist** + blue-chip defaults from env
- Pattern detection on 1h/4h bars (DB, DT, HS, IH&S — Active only in UI)
- Links each row to **TradingView** for chart review

## Architecture

```
Vercel Cron (*/30) ──► /api/cron/scan ──► runBackgroundScan()
                                              │
                                              ▼
                                    saveSnapshot() ──► Vercel Blob (prod)
                                              │        .cache/ (local dev)
                                              ▼
User opens app ──► GET /api/scan ──► loadSnapshot() ──► instant JSON
                      │
                      ├─ cache empty/stale? ──► kick off background scan
                      └─ ?force=true ──► rescan async, return current cache

Client polls every 30s while scanInProgress or stale
```

### Cache layers

1. **In-memory** — warm lambda reads (same instance)
2. **Vercel Blob** — cross-instance persistence in production (`BLOB_READ_WRITE_TOKEN`)
3. **Local file** — `.cache/scan-snapshot.json` for dev without Blob

### Endpoints

| Route | Purpose |
|-------|---------|
| `GET /api/scan` | Return cached snapshot + `{ stale, scanInProgress, cacheEmpty }` |
| `GET /api/scan?force=true` | Return cache immediately, start background rescan |
| `GET /api/scan?status=true` | Lightweight status poll |
| `POST /api/scan` | Synchronous full scan (admin; may take minutes) |
| `GET /api/cron/scan` | Cron job — protected by `CRON_SECRET` |

## Local development

```bash
cd ema-crossover-scanner
npm install
cp .env.example .env.local
# Populate TRADINGVIEW_WATCHLIST_URL and/or WATCHLIST_SYMBOLS

# Seed cache (first run — takes a few minutes)
npm run scan

npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — loads instantly from `.cache/scan-snapshot.json`.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRADINGVIEW_WATCHLIST_URL` | recommended | — | Shared TV watchlist to merge |
| `WATCHLIST_SYMBOLS` | optional | — | Extra comma/newline symbols |
| `INCLUDE_BLUE_CHIPS` | | `true` | Include built-in large-cap list |
| `HISTORY_DAYS` | | `120` | Lookback for EMA (60–365) |
| `BLOB_READ_WRITE_TOKEN` | **Vercel prod** | — | Vercel Blob store for shared cache |
| `CRON_SECRET` | **Vercel prod** | — | Bearer token for cron route |
| `SCAN_STALE_MINUTES` | | `30` | Cache TTL before auto-refresh |

## Pattern data vs TradingView

| Option | Feasibility | Notes |
|--------|-------------|-------|
| **Yahoo Finance 1h bars (current)** | ✅ Used | Stable on Vercel serverless; 4h bars aggregated in NY timezone to align with TV session buckets |
| TV shared watchlist HTML | ✅ Used | Symbol list only — already merged via `TRADINGVIEW_WATCHLIST_URL` |
| `scanner.tradingview.com` unofficial REST | ❌ Not used | Undocumented, no SLA, often blocked/rate-limited from datacenter IPs; violates TV ToS |
| TV chart websocket (`data.tradingview.com`) | ❌ Not used | Requires session auth + persistent connection — poor fit for cron/serverless |
| TV auto-chart-pattern labels | ❌ N/A | No public API; proprietary visual recognition |

**Recommendation:** Keep Yahoo for price, EMA, and pattern bar data. Pattern columns are **algorithmic approximations** (40-day window, neckline-break confirmation) — they will not match TradingView's built-in pattern badges exactly. Each row links to TradingView for manual verification.

## Deploy to Vercel

1. Push to GitHub and import in [Vercel](https://vercel.com/new)
2. **Create a Blob store** (Storage → Blob) and connect `BLOB_READ_WRITE_TOKEN`
3. Set env vars: `TRADINGVIEW_WATCHLIST_URL`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`
4. Deploy — `vercel.json` registers cron: `*/30 * * * *` → `/api/cron/scan`
5. Optionally trigger first scan: `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_APP.vercel.app/api/cron/scan`

### Vercel checklist

- [ ] Blob store created + token linked to project
- [ ] `CRON_SECRET` set (random string; Vercel Cron sends it automatically when configured in dashboard)
- [ ] `TRADINGVIEW_WATCHLIST_URL` set
- [ ] Cron enabled on Pro plan (Hobby supports cron with limits)
- [ ] Function max duration 300s (configured in `vercel.json`)

## Disclaimer

This tool is for research and education only. It is **not** financial advice. Verify signals on TradingView before trading.
