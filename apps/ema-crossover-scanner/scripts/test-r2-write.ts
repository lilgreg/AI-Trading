/**
 * Quick R2 connectivity test. Requires R2_* env vars (e.g. from .env.local).
 * Usage: npx tsx scripts/test-r2-write.ts
 */
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME ?? "ai-trading-scanner";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const testKey = "ema-scanner/r2-test.json";
const payload = { ok: true, testedAt: new Date().toISOString() };

async function main() {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    }),
  );
  console.log(`Wrote s3://${bucket}/${testKey}`);

  const got = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: testKey }),
  );
  const body = await got.Body?.transformToString();
  console.log("Read back:", body);
}

main().catch((err) => {
  console.error("R2 test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
