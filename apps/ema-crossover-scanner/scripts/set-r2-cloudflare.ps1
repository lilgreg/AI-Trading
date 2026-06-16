# Set R2 credentials as Cloudflare Worker secrets (run once after creating R2 API token).
# Requires: wrangler login
#
# Usage:
#   $AccountId = "..."
#   $BucketName = "ai-trading-scanner"
#   $AccessKeyId = "..."
#   $SecretAccessKey = "..."
#   .\scripts\set-r2-cloudflare.ps1

param(
  [string]$AccountId = $env:R2_ACCOUNT_ID,
  [string]$BucketName = $env:R2_BUCKET_NAME,
  [string]$AccessKeyId = $env:R2_ACCESS_KEY_ID,
  [string]$SecretAccessKey = $env:R2_SECRET_ACCESS_KEY
)

if (-not $AccountId -or -not $BucketName -or -not $AccessKeyId -or -not $SecretAccessKey) {
  Write-Error "Set R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
  exit 1
}

$AccountId | wrangler secret put R2_ACCOUNT_ID
$BucketName | wrangler secret put R2_BUCKET_NAME
$AccessKeyId | wrangler secret put R2_ACCESS_KEY_ID
$SecretAccessKey | wrangler secret put R2_SECRET_ACCESS_KEY

Write-Host "R2 secrets set on ai-trading-scanner worker. Run: npm run deploy"
