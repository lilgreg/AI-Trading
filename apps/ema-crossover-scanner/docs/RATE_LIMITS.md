# EMA Scanner — Cloudflare Workers rate limits

Production: https://ai-trading-scanner.lilgreg1.workers.dev

## What triggers limits

Cloudflare Workers free tier enforces:

- **Error 1027** — too many requests (burst or daily)
- **HTTP 429** — rate limited at the edge
- **~100,000 requests/day** per worker (account-wide on free)

Common causes: multiple browser tabs, aggressive client polling, background heal on every `/api/scan` GET, and Yahoo subrequests inside scan handlers.

## Safeguards (shipped)

| Layer | Behavior |
|-------|----------|
| `custom-worker.ts` + `lib/worker-request-guard.ts` | Per-isolate burst cap (~40 API req/min); early 429 + `Retry-After` |
| `app/api/scan/route.ts` | No auto-heal unless `?heal=1`; no stale/full scan on GET (cron + `?force=true` only); `Cache-Control: private, max-age=45` on read-only GET |
| `lib/scan-scheduler.ts` | Dedupes stacked `scheduleScanJob` calls |
| `lib/client-poll.ts` | Exponential backoff; persists rate-limit expiry in `localStorage` |
| `app/page.tsx` | Page Visibility pauses polling; single poll coordinator; session-aware intervals (see below) |
| `lib/poll-intervals.ts` | Faster polls 9:30–16:00 ET; slower pre/after/closed |
| `lib/yahoo-cache.ts` | Per-kind R2 TTL: quotes/news ~2 min; charts 15 min |

## Session-aware client polling

| Data | Regular session (9:30–16:00 ET) | Pre / after / closed |
|------|----------------------------------|----------------------|
| Quotes | 90s poll, 2 min cache | 3 min poll, 2 min cache |
| News | 2 min poll, 2 min cache | 5 min poll, 2 min cache |
| Charts / crosses | 15 min cache (unchanged) | 15 min cache |

Env vars (wrangler `[vars]` / `next.config.ts`):

- `YAHOO_QUOTE_CACHE_TTL_MS`, `YAHOO_NEWS_CACHE_TTL_MS`, `YAHOO_CHART_CACHE_TTL_MS`
- `NEXT_PUBLIC_QUOTES_POLL_MS_MARKET`, `NEXT_PUBLIC_QUOTES_POLL_MS_OFF`
- `NEXT_PUBLIC_NEWS_POLL_MS_MARKET`, `NEXT_PUBLIC_NEWS_POLL_MS_OFF`

## Expected request budget (one tab, foreground)

Approximate **per hour** with one tab visible during **regular session**:

| Endpoint | Interval | ~req/hr |
|----------|----------|---------|
| `/api/scan` (read) | coordinator ~3 min effective | ~20 |
| `/api/scan?status=true` | 3 min | ~20 |
| `/api/quotes` | 90s (chunked) | ~40 |
| `/api/news` | 2 min | ~30 |
| Heal (`?heal=1`) | 5 min when needed | ~0–12 |

**~110–120 Worker requests/hour/tab** during market hours → **~2,400–2,900/day** for a single tab left open on a weekday. Off-hours polling is slower (3 min quotes, 5 min news). Well under 100k if you use **one tab**.

## What you should do

1. **Close extra tabs** — each tab multiplies polling.
2. **Background tabs pause** — polling stops when the tab is hidden (Visibility API).
3. If you see “Rate limited — retrying in ~Xs”, wait; backoff doubles up to 5 min.
4. Full universe rescans run on **nightly cron** (4 chunks) or **Rescan now** (`?force=true`).

## Verify production

```bash
cd apps/ema-crossover-scanner
npm run verify:prod
```

Or manually:

```bash
curl.exe -s -o NUL -w "scan: %{http_code}\n" https://ai-trading-scanner.lilgreg1.workers.dev/api/scan
curl.exe -s -o NUL -w "news: %{http_code}\n" https://ai-trading-scanner.lilgreg1.workers.dev/api/news
```

## When 429 / 1027 clears

- Cloudflare daily counters reset on a **UTC day boundary** (typically midnight UTC).
- Burst limits recover within **1–5 minutes** once traffic stops.
- After limits clear, push/deploy is already live; refresh one tab and run `npm run verify:prod`.

## Optional paid plan

Paid Workers raises CPU time and removes some free-tier constraints but **does not remove** the 100k/day request cap entirely on all plans. For higher traffic, consider Workers Paid + caching, or moving scan cron to a dedicated worker with stricter auth.
