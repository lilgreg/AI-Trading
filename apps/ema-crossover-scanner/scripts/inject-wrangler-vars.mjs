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

const newsPollMs =
  process.env.NEXT_PUBLIC_NEWS_POLL_MS?.trim() ??
  process.env.NEWS_POLL_MS?.trim() ??
  "20000";

function escapeTomlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

let toml = readFileSync(tomlPath, "utf8");

toml = toml.replace(
  /^NEXT_PUBLIC_NEWS_POLL_MS = .*$/m,
  `NEXT_PUBLIC_NEWS_POLL_MS = ${escapeTomlString(newsPollMs)}`,
);

writeFileSync(tomlPath, toml);
console.log("[inject-wrangler-vars] Updated wrangler.toml [vars]");
