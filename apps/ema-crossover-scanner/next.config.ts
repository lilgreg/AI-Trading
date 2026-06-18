import type { NextConfig } from "next";

function publicEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

const nextConfig: NextConfig = {
  // Required by OpenNext Cloudflare (expects .next/standalone/ when using --skipNextBuild)
  output: "standalone",
  serverExternalPackages: ["yahoo-finance2", "undici"],
  env: {
    NEXT_PUBLIC_NEWS_POLL_MS: publicEnv(
      "NEXT_PUBLIC_NEWS_POLL_MS",
      publicEnv("NEWS_POLL_MS", "120000"),
    ),
    NEXT_PUBLIC_QUOTES_POLL_MS_MARKET: publicEnv(
      "NEXT_PUBLIC_QUOTES_POLL_MS_MARKET",
      "90000",
    ),
    NEXT_PUBLIC_QUOTES_POLL_MS_OFF: publicEnv(
      "NEXT_PUBLIC_QUOTES_POLL_MS_OFF",
      "180000",
    ),
    NEXT_PUBLIC_NEWS_POLL_MS_MARKET: publicEnv(
      "NEXT_PUBLIC_NEWS_POLL_MS_MARKET",
      "120000",
    ),
    NEXT_PUBLIC_NEWS_POLL_MS_OFF: publicEnv(
      "NEXT_PUBLIC_NEWS_POLL_MS_OFF",
      "300000",
    ),
    NEXT_PUBLIC_STATUS_POLL_MS: publicEnv(
      "NEXT_PUBLIC_STATUS_POLL_MS",
      "180000",
    ),
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
