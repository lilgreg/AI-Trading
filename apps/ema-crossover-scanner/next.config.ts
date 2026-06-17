import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required by OpenNext Cloudflare (expects .next/standalone/ when using --skipNextBuild)
  output: "standalone",
  serverExternalPackages: ["yahoo-finance2", "undici"],
  env: {
    NEXT_PUBLIC_NEWS_POLL_MS:
      process.env.NEWS_POLL_MS ?? process.env.NEXT_PUBLIC_NEWS_POLL_MS ?? "20000",
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
