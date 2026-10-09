# Set R2 credentials on Vercel production (run once after creating Cloudflare R2 API token).
# Usage:
#   $env:R2_ACCESS_KEY_ID = "your-access-key"
#   $env:R2_SECRET_ACCESS_KEY = "your-secret-key"
#   .\scripts\set-r2-vercel.ps1

param(
  [string]$AccessKeyId = $env:R2_ACCESS_KEY_ID,
  [string]$SecretAccessKey = $env:R2_SECRET_ACCESS_KEY,
  [string]$AccountId = "916b405a7f36a98d6e1e5be8c18aae59",
  [string]$BucketName = "ai-trading-scanner"
)

if (-not $AccessKeyId -or -not $SecretAccessKey) {
  Write-Error "Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY first."
  exit 1
}

Push-Location $PSScriptRoot\..

$AccountId | vercel env add R2_ACCOUNT_ID production --force
$BucketName | vercel env add R2_BUCKET_NAME production --force
$AccessKeyId | vercel env add R2_ACCESS_KEY_ID production --force
$SecretAccessKey | vercel env add R2_SECRET_ACCESS_KEY production --force

Write-Host "R2 env vars set on Vercel production. Run: vercel --prod"
Pop-Location
