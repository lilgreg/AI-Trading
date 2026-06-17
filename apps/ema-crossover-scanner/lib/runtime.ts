/** Set in wrangler.toml [vars] for Cloudflare Workers deploys. */
export function isCloudflareWorkersRuntime(): boolean {
  return process.env.SCAN_RUNTIME === "cloudflare";
}
