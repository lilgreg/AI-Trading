#!/usr/bin/env node
/**
 * Writes NEXT_PUBLIC_* values into wrangler.toml [vars] before deploy.
 * Values are public (same as browser bundle) — not Worker secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tomlPath = resolve(root, "wrangler.toml");

const MIN_POLL_MS = 10_000;

function safePollMs(raw, fallback) {
  const trimmed = raw?.trim();
  const ms = Number(trimmed && trimmed.length > 0 ? trimmed : fallback);
  if (!Number.isFinite(ms) || ms < MIN_POLL_MS) return String(fallback);
  return String(ms);
}

const vars = {
  NEXT_PUBLIC_NEWS_POLL_MS: safePollMs(
    process.env.NEXT_PUBLIC_NEWS_POLL_MS ?? process.env.NEWS_POLL_MS,
    120_000,
  ),
  NEXT_PUBLIC_NEWS_POLL_MS_MARKET: safePollMs(
    process.env.NEXT_PUBLIC_NEWS_POLL_MS_MARKET,
    120_000,
  ),
  NEXT_PUBLIC_NEWS_POLL_MS_OFF: safePollMs(
    process.env.NEXT_PUBLIC_NEWS_POLL_MS_OFF,
    300_000,
  ),
  NEXT_PUBLIC_QUOTES_POLL_MS_MARKET: safePollMs(
    process.env.NEXT_PUBLIC_QUOTES_POLL_MS_MARKET,
    90_000,
  ),
  NEXT_PUBLIC_QUOTES_POLL_MS_OFF: safePollMs(
    process.env.NEXT_PUBLIC_QUOTES_POLL_MS_OFF,
    180_000,
  ),
  NEXT_PUBLIC_STATUS_POLL_MS: safePollMs(
    process.env.NEXT_PUBLIC_STATUS_POLL_MS,
    180_000,
  ),
};

function escapeTomlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

let toml = readFileSync(tomlPath, "utf8");

for (const [key, value] of Object.entries(vars)) {
  const pattern = new RegExp(`^${key} = .*$`, "m");
  toml = toml.replace(pattern, `${key} = ${escapeTomlString(value)}`);
}

writeFileSync(tomlPath, toml);
console.log("[inject-wrangler-vars] Updated wrangler.toml [vars]");
