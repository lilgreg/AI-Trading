# EMA Crossover Scanner

Rank stocks by how recently the **20 EMA crossed above the 50 EMA** — with **instant load** from a server-precomputed cache and **live price/session updates**.

## What it does

- Precomputes EMA/pattern scans on the server (Vercel Cron daily on Hobby; client triggers rescan when stale)
- **Instant dashboard** — reads cached JSON snapshot in &lt;500ms
- **Live prices** — lightweight `/api/quotes` poll every ~45s (price + Pre/Reg/AH session %)
- Dual cross columns: **Cross 1h** and **Cross 4h** (independent sort)
- Merges **TradingView watchlist** (~233 symbols) + blue-chip defaults from env
- Pattern detection on 1h/4h bars (DB, DT, HS, IH&S — Active only in UI)
- Links each row to **TradingView** for chart review

## Real-time vs scan data

| Data | Freshness | How |
|------|-----------|-----|
| Price, Pre/Reg/AH % | Near real-time (~45s) | Client polls `GET /api/quotes` — Yahoo quotes only |
| EMA values, crosses, patterns | Minutes (full rescan) | Background `runBackgroundScan()` — fetches 1h bars + computes EMAs |
| Tick-by-tick | Not supported | Would need websockets / streaming quotes architecture |

Full EMA/pattern rescans take **several minutes** for ~230 symbols. On Vercel Hobby, cron runs **once daily** (`0 0 * * *`); the client polls `GET /api/scan?status=true` every 60s and triggers a background rescan when cache is older than **15 minutes** (configurable via `SCAN_STALE_MINUTES`).

## Architecture

```
Vercel Cron (daily) ──► /api/cron/scan ──► runBackgroundScan()
                                              │
                                              ▼
                                    saveSnapshot() ──► Cloudflare R2 (prod)
                                              │        .cache/ (local dev)
                                              ▼
User opens app ──► GET /api/scan ──► loadSnapshot() ──► instant JSON
                      │
                      ├─ cache empty/stale? ──► kick off background scan
                      └─ ?force=true ──► rescan async, return current cache

Client (every 60s) ──► GET /api/scan?status=true
                      └─ stale? ──► triggers background rescan + "Updating…"

Client (every 45s) ──► GET /api/quotes ──► merge price/session % into table
```

### Cache layers

1. **In-memory** — warm lambda reads (same instance)
2. **Cloudflare R2** — cross-instance persistence in production (S3-compatible API)
3. **Local file** — `.cache/scan-snapshot.json` for dev without R2

### Endpoints

| Route | Purpose |
|-------|---------|
| `GET /api/scan` | Return cached snapshot + `{ stale, scanInProgress, cacheEmpty }` |
| `GET /api/scan?force=true` | Return cache immediately, start background rescan |
| `GET /api/scan?status=true` | Lightweight status poll; triggers rescan if stale |
| `GET /api/quotes` | Live price + session % for all cached symbols |
| `POST /api/scan` | Synchronous full scan (admin; may take minutes) |
| `GET /api/cron/scan` | Cron job — protected by `CRON_SECRET` |

## Local development

```bash
cd ema-crossover-scanner
npm install
cp .env.example .env.local
# Populate TRADINGVIEW_WATCHLIST_URL and/or WATCHLIST_SYMBOLS

# Seed cache with FULL watchlist (first run — takes a few minutes)
npm run scan

npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — loads instantly from `.cache/scan-snapshot.json`.

Without R2 env vars, the app uses the local `.cache/` directory only. Production on Vercel requires R2 credentials.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRADINGVIEW_WATCHLIST_URL` | recommended | — | Shared TV watchlist to merge (~233 symbols) |
| `WATCHLIST_SYMBOLS` | optional | — | Extra comma/newline symbols |
| `INCLUDE_BLUE_CHIPS` | | `true` | Include built-in large-cap list (30 symbols) |
| `HISTORY_DAYS` | | `120` | Lookback for EMA (60–365) |
| `R2_ACCOUNT_ID` | **Vercel prod** | — | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | **Vercel prod** | — | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | **Vercel prod** | — | R2 API token secret |
| `R2_BUCKET_NAME` | **Vercel prod** | — | R2 bucket for scan snapshots |
| `CRON_SECRET` | **Vercel prod** | — | Bearer token for cron route |
| `SCAN_STALE_MINUTES` | | `15` | Cache TTL before client/cron auto-refresh |
| `YAHOO_TIMEOUT_MS` | | `20000` | Yahoo chart/quote timeout (ms) |
| `YAHOO_RETRY_TIMEOUT_MS` | | `30000` | Timeout for Yahoo v8 retry pass |
| `FINNHUB_API_KEY` | **recommended (Vercel)** | — | Free hourly bar fallback when Yahoo throttles (~symbol 120+) |
| `POLYGON_API_KEY` | optional | — | Hourly bar fallback via Polygon aggregates |
| `TWELVE_DATA_API_KEY` | optional | — | Hourly bar fallback via Twelve Data |
| `ALPHA_VANTAGE_API_KEY` | optional | — | Hourly bar fallback via AV intraday (strict free-tier limits) |

Optional R2 object keys (defaults: `ema-scanner/snapshot.json`, `ema-scanner/scan-lock.json`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SCAN_CACHE_OBJECT_KEY` | `ema-scanner/snapshot.json` | Snapshot object key in R2 |
| `SCAN_LOCK_OBJECT_KEY` | `ema-scanner/scan-lock.json` | Scan lock object key in R2 |

### Chart data provider chain

Hourly bars are fetched via `lib/chart-data.ts` — each symbol tries providers **in order until one succeeds**:

1. Yahoo v8 direct (`query1` / `query2`)
2. Yahoo Spark API (lightweight keyless Yahoo endpoint)
3. Yahoo v8 range param (alternate endpoint rotation)
4. yahoo-finance2 library
5. Yahoo v8 retry (longer timeout)
6. Finnhub candles (requires `FINNHUB_API_KEY`)
7. Polygon / Twelve Data / Alpha Vantage (optional keys)
8. Stooq CSV (keyless; often blocked by bot protection)

**For reliable production scans**, set a free [Finnhub API key](https://finnhub.io/register) as `FINNHUB_API_KEY` on Vercel (`ai-trading-scanner` project). Without it, scans may fail after Yahoo rate-limits around symbol #120.

## Pattern data vs TradingView

| Option | Feasibility | Notes |
|--------|-------------|-------|
| **Yahoo Finance 1h bars (current)** | ✅ Used | Primary source with retries, staggered requests, v8 fallback, and in-scan bar cache |
| Finnhub / Polygon / Twelve Data / Alpha Vantage | ✅ Optional | Env-key fallbacks when Yahoo throttles (~symbol 120+ in full scans) |
| TV shared watchlist HTML | ✅ Used | Symbol list only — already merged via `TRADINGVIEW_WATCHLIST_URL` |
| `scanner.tradingview.com` unofficial REST | ❌ Not used | Undocumented, no SLA, often blocked/rate-limited from datacenter IPs; violates TV ToS |
| TV chart websocket (`data.tradingview.com`) | ❌ Not used | Requires session auth + persistent connection — poor fit for cron/serverless |
| TV auto-chart-pattern labels | ❌ N/A | No public API; proprietary visual recognition |

**Recommendation:** Keep Yahoo for price, EMA, and pattern bar data. Pattern columns are **algorithmic approximations** (40-day window, neckline-break confirmation) — they will not match TradingView's built-in pattern badges exactly. Each row links to TradingView for manual verification.

## Cloudflare R2 setup (scan cache)

The app stores the precomputed scan snapshot and scan lock in **Cloudflare R2** (S3-compatible). Vercel hosts Next.js; R2 replaces the previous Vercel Blob store.

### 1. Create an R2 bucket

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Go to **R2 Object Storage** → **Create bucket**
3. Name it (e.g. `ai-trading-scanner-cache`) — note the name for `R2_BUCKET_NAME`

### 2. Create an API token

1. In R2, open **Manage R2 API Tokens** (or **Account** → **R2** → **Manage API tokens**)
2. **Create API token** with **Object Read & Write** on your bucket (or all buckets)
3. Save the **Access Key ID** and **Secret Access Key** (shown once)
4. Copy your **Account ID** from the R2 overview page (used in the S3 endpoint)

### 3. Set Vercel environment variables

In the Vercel project (`ai-trading-scanner`), add:

| Variable | Value |
|----------|-------|
| `R2_ACCOUNT_ID` | Your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Token access key |
| `R2_SECRET_ACCESS_KEY` | Token secret |
| `R2_BUCKET_NAME` | Bucket name from step 1 |

Redeploy after saving. The first successful scan writes `ema-scanner/snapshot.json` to R2. No migration from Vercel Blob is required — run a fresh scan or trigger cron.

**Removed:** `BLOB_READ_WRITE_TOKEN` and the `@vercel/blob` dependency are no longer used.

## Deploy to Vercel

1. Push to GitHub and import in [Vercel](https://vercel.com/new)
2. Configure **Cloudflare R2** (see above) and set `R2_*` env vars
3. Set env vars: `TRADINGVIEW_WATCHLIST_URL`, `CRON_SECRET`, **`FINNHUB_API_KEY`** (free at [finnhub.io/register](https://finnhub.io/register))
4. Deploy — `vercel.json` registers cron: `0 0 * * *` → `/api/cron/scan` (daily on Hobby)
5. Optionally trigger first scan: `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_APP.vercel.app/api/cron/scan`

### Vercel checklist

- [ ] R2 bucket created + `R2_*` env vars set on project
- [ ] `CRON_SECRET` set (random string; Vercel Cron sends it automatically when configured in dashboard)
- [ ] `TRADINGVIEW_WATCHLIST_URL` set (full watchlist — not blue chips only)
- [ ] **`FINNHUB_API_KEY` set** (backup when Yahoo throttles after ~120 symbols)
- [ ] Cron enabled (Hobby: daily limit)
- [ ] Function max duration 300s (configured in `vercel.json`)

## Disclaimer

This tool is for research and education only. It is **not** financial advice. Verify signals on TradingView before trading.
