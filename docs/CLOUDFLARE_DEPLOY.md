# Deploy AI Trading Scanner to Cloudflare Workers

This app uses **Next.js + OpenNext** on Cloudflare Workers (not Pages).

Production builds use **Webpack** (`next build --webpack`). Next.js 16 defaults to Turbopack, which causes `ChunkLoadError` on Workers until OpenNext fully supports Turbopack production builds.

Primary deploy path: **GitHub Actions** (`.github/workflows/deploy-cloudflare.yml`) — not bare local `wrangler deploy`.

---

## What you need before the site works

### Required GitHub repository secrets (8)

Set once in GitHub → **Settings** → **Secrets and variables** → **Actions**.

| Secret name | What it is | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Upload Worker + populate R2 cache | Cloudflare → My Profile → **API Tokens** → **Edit Cloudflare Workers** template + **Account → Workers R2 Storage → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Dashboard → **Workers & Pages** → Overview → **Account ID** |
| `R2_ACCOUNT_ID` | Same as Cloudflare account ID | R2 overview page |
| `R2_ACCESS_KEY_ID` | R2 API token access key | R2 → **Manage R2 API Tokens** → Object Read & Write |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret | Shown once when token is created |
| `R2_BUCKET_NAME` | Scan cache bucket name | e.g. `ai-trading-scanner` |
| `TRADINGVIEW_WATCHLIST_URL` | Shared TV watchlist URL | TradingView watchlist share link |
| `FINNHUB_API_KEY` | Hourly bar fallback when Yahoo throttles | [finnhub.io/register](https://finnhub.io/register) |

### Optional GitHub secrets

| Secret name | Purpose |
|---|---|
| `CRON_SECRET` | Bearer token for manual `/api/cron/*` HTTP triggers |
| `POLYGON_API_KEY` | Optional bar fallback |
| `TWELVE_DATA_API_KEY` | Optional bar fallback |
| `ALPHA_VANTAGE_API_KEY` | Optional bar fallback |
| `FMP_API_KEY` | Symbol logo fallback |
| `NEXT_PUBLIC_NEWS_POLL_MS` | Client news poll interval (default `20000`) |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin after custom domain cutover |

---

## Cloudflare dashboard setup (one-time)

### 1. R2 buckets

CI creates these if missing:

| Bucket | Purpose |
|---|---|
| `ai-trading-scanner` | Scan snapshot + lock JSON (S3 API via `R2_*` secrets) |
| `ai-trading-scanner-opennext-cache` | OpenNext incremental SSR cache |

You can also create them manually: **R2 Object Storage** → **Create bucket**.

### 2. R2 API token (scan cache)

1. **R2** → **Manage R2 API Tokens** → **Create API token**
2. **Object Read & Write** on `ai-trading-scanner` (or all buckets)
3. Save **Access Key ID** and **Secret Access Key** → GitHub secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

### 3. Worker name

Worker name is **`ai-trading-scanner`** (`wrangler.toml`). First successful CI run creates/updates it.

### 4. Attach custom domain (after CI succeeds)

**Do not** add `[[routes]]` or `custom_domain` in `wrangler.toml` — attach in the dashboard only.

1. Remove the domain from **Vercel** (or any **Cloudflare Pages** project) first — otherwise you get **409 Conflict**.
2. **Workers & Pages** → **ai-trading-scanner** → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.
3. Add your apex (e.g. `ai-trading-scanner.com`) and **www** if needed.
4. Cloudflare provisions SSL when the zone is on your account.

### 5. DNS cutover from Vercel

1. Note current DNS at your registrar / Cloudflare zone.
2. After Worker custom domain is attached, Cloudflare creates/updates DNS records automatically (or add a CNAME to the Worker).
3. Verify `https://<your-domain>/api/scan` returns cached JSON.
4. **Disconnect Vercel**: delete or pause the Vercel project (`ai-trading-scanner.vercel.app`) so traffic and cron do not split across hosts.

### 6. Cron triggers

Four nightly jobs are defined in `wrangler.toml` and handled by `custom-worker.ts` → `scheduled()` (not HTTP). Confirm under **Workers & Pages** → **ai-trading-scanner** → **Triggers** → **Cron Triggers**.

---

## How deploy works (CI)

On push to `main` (paths: `apps/ema-crossover-scanner/**`):

1. `npm ci`
2. Create R2 buckets if missing
3. Inject `NEXT_PUBLIC_*` into `wrangler.toml`
4. `wrangler secret bulk` from GitHub secrets
5. `npm run build` → `next build --webpack` (standalone output)
6. `npm run build:worker` → `opennextjs-cloudflare build --skipNextBuild`
7. `opennextjs-cloudflare deploy` (Worker + assets + R2 incremental cache)

---

## Expected URLs

| URL | When |
|---|---|
| `https://ai-trading-scanner.<your-subdomain>.workers.dev` | Always (smoke test / pre-cutover) |
| Your custom apex + www | After dashboard domain attach |

Find your workers.dev subdomain: **Workers & Pages** → **Overview** → **Subdomain** (e.g. `lilgreg1.workers.dev` → `https://ai-trading-scanner.lilgreg1.workers.dev`).

---

## Local deploy (after `wrangler login`)

```bash
cd apps/ema-crossover-scanner
cp .dev.vars.example .dev.vars   # fill values locally — never commit
export NEXT_PUBLIC_NEWS_POLL_MS=20000
node scripts/inject-wrangler-vars.mjs
npm run pages:build
npx opennextjs-cloudflare deploy
```

Preview locally:

```bash
npm run preview
# Cron test: wrangler dev --test-scheduled
# curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

---

## Node / runtime flags (audit)

| Dependency / API | Workers requirement |
|---|---|
| `@aws-sdk/client-s3` | `nodejs_compat` (R2 S3-compatible API) |
| `node:crypto` (`createHash` in scan-job) | `nodejs_compat` |
| `node:fs/promises` (scan-storage local dev fallback) | Dev only; production uses R2 |
| `yahoo-finance2`, `undici` | `serverExternalPackages` + `nodejs_compat` |
| `@opennextjs/cloudflare` | OpenNext deploy; **not** `@cloudflare/next-on-pages` |

---

## Troubleshooting

| Log / symptom | Fix |
|---|---|
| `Missing secret: CLOUDFLARE_*` or `R2_*` | Add GitHub secrets; redeploy |
| `Authentication error` / `wrangler whoami` failed | Regenerate API token with Workers Scripts Edit + R2 Storage Edit |
| `No R2 binding "NEXT_INC_CACHE_R2_BUCKET"` | Ensure `open-next.config.ts` uses `r2IncrementalCache` and `wrangler.toml` has the binding |
| `ChunkLoadError` on SSR chunks | Ensure `package.json` uses `next build --webpack` |
| Scan cache empty in prod | Set all `R2_*` secrets; check R2 bucket for `ema-scanner/snapshot.json` |
| Yahoo throttles after ~120 symbols | Set `FINNHUB_API_KEY` |
| Custom domain 409 | Remove domain from Vercel/Pages first; attach on Worker in dashboard |
| Long `POST /api/scan` times out | Enable paid Workers; uncomment `[limits] cpu_ms = 300000` in `wrangler.toml` |

```bash
cd apps/ema-crossover-scanner
npx wrangler tail ai-trading-scanner
```

---

## Disconnect Vercel (post-cutover checklist)

- [ ] Custom domain serves from Cloudflare Worker
- [ ] `/api/scan` and `/api/quotes` work on production domain
- [ ] R2 snapshot updates after cron or manual scan
- [ ] Delete or archive Vercel project `ai-trading-scanner`
- [ ] Remove Vercel DNS records if any remain at registrar
