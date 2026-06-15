import { runBackgroundScan } from "../lib/scan-job";

async function main() {
  console.log("Running full background scan…");
  const snapshot = await runBackgroundScan();
  if (!snapshot) {
    console.log("Skipped — another scan is already in progress.");
    return;
  }
  console.log(
    `Done: ${snapshot.symbolCount} symbols, completed ${snapshot.completedAt}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
