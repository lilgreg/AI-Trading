import { resolveLogoUrl, shouldUseInitialsOnly } from "./symbol-logo";
import type { StockScanResult } from "./types";

const BACKFILL_CONCURRENCY = 10;

/** Probe and fill missing logoUrl on cached scan rows (legacy snapshots). */
export async function backfillMissingLogoUrls(
  results: StockScanResult[],
): Promise<{ results: StockScanResult[]; changed: boolean }> {
  const needsBackfill = results.filter(
    (row) => !row.logoUrl?.trim() && !shouldUseInitialsOnly(row.symbol),
  );

  if (needsBackfill.length === 0) {
    return { results, changed: false };
  }

  const updatedBySymbol = new Map(results.map((row) => [row.symbol, row]));

  for (let i = 0; i < needsBackfill.length; i += BACKFILL_CONCURRENCY) {
    const batch = needsBackfill.slice(i, i + BACKFILL_CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const logoUrl = await resolveLogoUrl({
          displayTicker: row.displayTicker,
          tradingViewSymbol: row.tradingViewSymbol,
          yahooSymbol: row.symbol,
          companyName: row.name,
        });
        if (logoUrl) {
          updatedBySymbol.set(row.symbol, { ...row, logoUrl });
        }
      }),
    );
  }

  const updated = results.map((row) => updatedBySymbol.get(row.symbol) ?? row);
  const changed = updated.some((row, index) => row.logoUrl !== results[index]?.logoUrl);
  return { results: updated, changed };
}
