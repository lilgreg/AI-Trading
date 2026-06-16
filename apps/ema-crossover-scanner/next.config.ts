import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["yahoo-finance2", "undici"],
  env: {
    NEXT_PUBLIC_NEWS_POLL_MS:
      process.env.NEWS_POLL_MS ?? process.env.NEXT_PUBLIC_NEWS_POLL_MS ?? "20000",
  },
};

export default nextConfig;
