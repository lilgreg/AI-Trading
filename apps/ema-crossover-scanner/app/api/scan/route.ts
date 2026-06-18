import { NextRequest, NextResponse } from "next/server";
import { backfillMissingLogoUrls } from "@/lib/logo-backfill";
import {
  rowNeedsChartHeal,
  symbolsWithStaleChartErrors,
} from "@/lib/chart-error-sanitize";
import {
  buildCacheStatus,
  buildStatusFromMeta,
  loadScanMeta,
  loadSnapshot,
  recoverStuckScanState,
  saveSnapshot,
  toCachedResponse,
  type ScanSnapshot,
} from "@/lib/scan-cache";
import {
  countCross4hGapRows,
  countRetryableResults,
  hasUnscannedRows,
  healCacheOnRead,
  retryFailedSymbols,
  scanAndMergeSymbol,
} from "@/lib/scan-job";
import { isCloudflareWorkersRuntime } from "@/lib/runtime";
import {
  scheduleBackgroundTask,
  scheduleScanJob,
} from "@/lib/scan-scheduler";
import { enrichSnapshotSessions } from "@/lib/session-snapshot";
import {
  applyQuoteUpdates,
  isStaleSessionSnapshot,
} from "@/lib/quote-updates";
import { fetchQuoteUpdates } from "@/lib/quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_RETRY_FAILED_LIMIT = 25;
const WORKERS_QUOTE_ENRICH_LIMIT = 24;
/** Short CDN/browser cache for read-only scan GETs — absorbs repeat polls. */
const SCAN_READ_CACHE_MAX_AGE_SEC = 45;

async function enrichScanResponseQuotes(
  snapshot: ScanSnapshot | null,
  options: { persist?: boolean } = {},
): Promise<ScanSnapshot | null> {
  if (!snapshot?.results?.length) return snapshot;

  const existingBySymbol = new Map(
    snapshot.results.map((row) => [row.symbol, row]),
  );
  const quoteTargets = snapshot.results.filter(
    (row) =>
      !row.error &&
      (row.price == null || isStaleSessionSnapshot(row.sessionSnapshotDate)),
  );
  if (quoteTargets.length === 0) return snapshot;

  const symbols = quoteTargets.map((row) => row.symbol);
  const quotes = await fetchQuoteUpdates(symbols, {
    offset: 0,
    limit: WORKERS_QUOTE_ENRICH_LIMIT,
    existingBySymbol,
  });
  if (!quotes.length) return snapshot;

  const results = applyQuoteUpdates(snapshot.results, quotes);
  const updated = { ...snapshot, results };

  if (options.persist) {
    const changed = results.some(
      (row, index) =>
        row.price !== snapshot.results[index]?.price ||
        row.preMarketChange !== snapshot.results[index]?.preMarketChange ||
        row.regularMarketChange !== snapshot.results[index]?.regularMarketChange ||
        row.postMarketChange !== snapshot.results[index]?.postMarketChange ||
        row.sessionSnapshotDate !== snapshot.results[index]?.sessionSnapshotDate,
    );
    if (changed) {
      await saveSnapshot({
        ...updated,
        lastSavedAt: new Date().toISOString(),
      });
    }
  }

  return updated;
}
const HEAL_MAX_SYMBOLS = 12;
const HEAL_MAX_ROUNDS = 1;
const SESSION_ENRICH_MAX = 40;

function parseForce(searchParams: URLSearchParams): boolean {
  return searchParams.get("force") === "true";
}

function parseHeal(searchParams: URLSearchParams): boolean {
  const heal = searchParams.get("heal");
  return heal === "1" || heal === "true";
}

function parseStatusOnly(searchParams: URLSearchParams): boolean {
  return searchParams.get("status") === "true";
}

function snapshotLooksCorrupted(snapshot: ScanSnapshot | null): boolean {
  if (!snapshot?.results?.length) return false;
  const notScanned = snapshot.results.filter(
    (row) => row.error === "Not scanned yet",
  ).length;
  return notScanned / snapshot.results.length > 0.2;
}

async function ensureLogoBackfill(
  snapshot: ScanSnapshot | null,
): Promise<ScanSnapshot | null> {
  if (!snapshot?.results?.length) return snapshot;

  const { results, changed } = await backfillMissingLogoUrls(snapshot.results);
  if (!changed) return snapshot;

  const updated = { ...snapshot, results };
  void saveSnapshot(updated);
  return updated;
}

function queueStaleChartRescans(snapshot: ScanSnapshot | null): void {
  const staleSymbols = snapshot?.results
    ? symbolsWithStaleChartErrors(snapshot.results)
    : [];
  if (staleSymbols.length === 0) return;

  for (const symbol of staleSymbols.slice(0, 12)) {
    void scanAndMergeSymbol(symbol).catch(() => undefined);
  }
}

function scheduleCross4hGapHeal(initialSnapshot: ScanSnapshot | null): void {
  if (!initialSnapshot?.results?.length) return;
  if (countCross4hGapRows(initialSnapshot.results) === 0) return;

  scheduleBackgroundTask(async () => {
    const { sleep } = await import("@/lib/request-limit");
    for (let round = 0; round < 20; round += 1) {
      const fresh = await loadSnapshot({ enrich: false });
      if (!fresh?.results?.length || countCross4hGapRows(fresh.results) === 0) {
        break;
      }
      try {
        await healCacheOnRead(fresh, {}, { maxSymbols: 4 });
      } catch {
        break;
      }
      await sleep(2_000);
    }
  });
}

function scheduleDeferredReadMaintenance(
  snapshot: ScanSnapshot | null,
  options: { heal?: boolean } = {},
): void {
  scheduleBackgroundTask(async () => {
    let current = snapshot;
    try {
      if (
        current?.results?.length &&
        countRetryableResults(current.results) > 0 &&
        !hasUnscannedRows(current.results)
      ) {
        const retried = await retryFailedSymbols({}, {
          maxSymbols: SYNC_RETRY_FAILED_LIMIT,
        });
        if (retried) current = retried;
      }

      current = await ensureLogoBackfill(current);

      const needsHeal =
        current?.results?.length &&
        (hasUnscannedRows(current.results) ||
          current.results.some(rowNeedsChartHeal));

      if (options.heal && needsHeal) {
        await recoverStuckScanState(current);
        for (let round = 0; round < HEAL_MAX_ROUNDS; round += 1) {
          if (!current?.results?.length) break;
          const stillNeedsHeal =
            hasUnscannedRows(current.results) ||
            current.results.some(rowNeedsChartHeal);
          if (!stillNeedsHeal) break;
          const healed = await healCacheOnRead(current, {}, {
            maxSymbols: HEAL_MAX_SYMBOLS,
          });
          if (healed) current = healed;
        }
      } else if (current) {
        queueStaleChartRescans(current);
      }

      if (current?.results?.length) {
        const { results, changed } = await enrichSnapshotSessions(
          current.results,
          { maxSymbols: SESSION_ENRICH_MAX },
        );
        if (changed) {
          current = {
            ...current,
            results,
            lastSavedAt: new Date().toISOString(),
          };
          await saveSnapshot(current);
        }
      }
    } catch {
      // best-effort background maintenance
    }
  });
}

function buildForceScanResponse(
  snapshot: Pick<ScanSnapshot, "scannedAt" | "symbolCount"> | null,
  status: Awaited<ReturnType<typeof buildCacheStatus>>,
  message: string,
): NextResponse {
  if (isCloudflareWorkersRuntime()) {
    return NextResponse.json(
      {
        scannedAt: snapshot?.scannedAt ?? null,
        symbolCount: snapshot?.symbolCount ?? 0,
        scanInProgress: true,
        stale: status.stale,
        cacheEmpty: status.cacheEmpty,
        staleAfterMinutes: status.staleAfterMinutes,
        lastError: status.lastError,
        scanStartedAt: status.scanStartedAt,
        message,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ...toCachedResponse(null, { ...status, scanInProgress: true }),
      scannedAt: snapshot?.scannedAt ?? null,
      symbolCount: snapshot?.symbolCount ?? 0,
      message,
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const force = parseForce(searchParams);
  const statusOnly = parseStatusOnly(searchParams);
  const heal = parseHeal(searchParams);
  const isWorkers = isCloudflareWorkersRuntime();

  if (statusOnly && isWorkers) {
    scheduleBackgroundTask(() => recoverStuckScanState(null));
    const statusPayload = await buildStatusFromMeta(await loadScanMeta());
    return NextResponse.json(statusPayload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (force && isWorkers) {
    scheduleBackgroundTask(() => recoverStuckScanState(null));
    const meta = await loadScanMeta();
    const statusPayload = await buildStatusFromMeta(meta);
    const snapshotStub = meta
      ? { scannedAt: meta.scannedAt, symbolCount: meta.symbolCount }
      : null;

    if (statusPayload.scanInProgress) {
      return buildForceScanResponse(
        snapshotStub,
        statusPayload,
        "Scan already in progress",
      );
    }

    scheduleScanJob({}, { force: true });
    return buildForceScanResponse(
      snapshotStub,
      { ...statusPayload, scanInProgress: true },
      "Rescan started",
    );
  }

  if (isWorkers && !force && !statusOnly) {
    scheduleBackgroundTask(async () => {
      await recoverStuckScanState(await loadSnapshot({ enrich: false }));
    });

    const [meta, snapshot] = await Promise.all([
      loadScanMeta(),
      loadSnapshot({ enrich: false }),
    ]);

    const hasUnscanned =
      snapshot?.results?.length ? hasUnscannedRows(snapshot.results) : false;
    const hasStaleChartRows =
      snapshot?.results?.length
        ? snapshot.results.some(rowNeedsChartHeal)
        : false;
    const cross4hGapCount = snapshot?.results?.length
      ? countCross4hGapRows(snapshot.results)
      : 0;
    const hasCross4hGaps = cross4hGapCount > 0;

    const status = await buildStatusFromMeta(meta);

    // Full universe scans run via cron chunks or explicit ?force=true — not on every GET.
    let responseSnapshot = snapshot;

    if (hasCross4hGaps && responseSnapshot) {
      try {
        responseSnapshot =
          (await healCacheOnRead(responseSnapshot, {}, { maxSymbols: 4 })) ??
          responseSnapshot;
      } catch {
        // return cached snapshot if inline cross4h heal fails
      }
    }

    if (heal) {
      const shouldInlineHeal =
        snapshot &&
        (hasUnscanned || hasStaleChartRows || hasCross4hGaps);
      if (shouldInlineHeal) {
        try {
          responseSnapshot =
            (await healCacheOnRead(snapshot, {}, { maxSymbols: 4 })) ?? snapshot;
        } catch {
          // return cached snapshot if inline heal fails
        }
      }

      scheduleCross4hGapHeal(responseSnapshot);

      if (responseSnapshot?.results?.length && hasUnscannedRows(responseSnapshot.results)) {
        scheduleBackgroundTask(async () => {
          const { sleep } = await import("@/lib/request-limit");
          for (let round = 0; round < 8; round += 1) {
            const fresh = await loadSnapshot({ enrich: false });
            if (!fresh?.results?.length || !hasUnscannedRows(fresh.results)) break;
            try {
              await healCacheOnRead(fresh, {}, { maxSymbols: 4 });
            } catch {
              break;
            }
            await sleep(2_000);
          }
        });
      }

      try {
        responseSnapshot = await enrichScanResponseQuotes(responseSnapshot, {
          persist: true,
        });
      } catch {
        // best-effort quote enrich for table display
      }
    } else if (
      responseSnapshot?.results?.some(
        (row) => isStaleSessionSnapshot(row.sessionSnapshotDate),
      )
    ) {
      try {
        responseSnapshot = await enrichScanResponseQuotes(responseSnapshot, {
          persist: true,
        });
      } catch {
        // best-effort stale session refresh
      }
    }

    const cacheControl =
      heal || force
        ? "no-store"
        : `private, max-age=${SCAN_READ_CACHE_MAX_AGE_SEC}`;

    return NextResponse.json(
      {
        ...toCachedResponse(responseSnapshot, status),
        unscannedCount:
          responseSnapshot?.results?.filter(
            (row) => row.error === "Not scanned yet",
          ).length ?? 0,
        chartRefreshPendingCount:
          responseSnapshot?.results?.filter(
            (row) =>
              row.error === "Chart data refresh pending" ||
              (row.ema20 == null && row.error != null && rowNeedsChartHeal(row)),
          ).length ?? 0,
        cross4hGapCount:
          responseSnapshot?.results?.length
            ? countCross4hGapRows(responseSnapshot.results)
            : 0,
      },
      { headers: { "Cache-Control": cacheControl } },
    );
  }

  let snapshot = await loadSnapshot();
  await recoverStuckScanState(snapshot);
  let status = await buildCacheStatus(snapshot);

  const hasUnscanned =
    snapshot?.results?.length ? hasUnscannedRows(snapshot.results) : false;
  const hasStaleChartRows =
    snapshot?.results?.length
      ? snapshot.results.some(rowNeedsChartHeal)
      : false;
  const needsHeal = hasUnscanned || hasStaleChartRows;

  if (statusOnly) {
    return NextResponse.json({
      scannedAt: snapshot?.scannedAt ?? null,
      completedAt: snapshot?.completedAt ?? null,
      symbolCount: snapshot?.symbolCount ?? 0,
      ...status,
    });
  }

  if (force) {
    if (status.scanInProgress) {
      return buildForceScanResponse(
        snapshot,
        status,
        "Scan already in progress",
      );
    }

    scheduleScanJob({}, { force: true });
    status = await buildCacheStatus(snapshot);
    return buildForceScanResponse(snapshot, status, "Rescan started");
  }

  if (status.cacheEmpty) {
    scheduleScanJob({});
  } else if (status.stale && !hasUnscanned) {
    scheduleScanJob({});
  }

  if (
    !heal &&
    !status.scanInProgress &&
    snapshot?.results?.length &&
    countRetryableResults(snapshot.results) > 0 &&
    !hasUnscanned
  ) {
    try {
      const retried = await retryFailedSymbols({}, {
        maxSymbols: SYNC_RETRY_FAILED_LIMIT,
      });
      if (retried) {
        snapshot = retried;
      }
    } catch {
      // return cached snapshot if inline retry fails
    }
  }

  snapshot = await ensureLogoBackfill(snapshot);

  const shouldHeal =
    heal && snapshot?.results?.length && needsHeal;

  if (shouldHeal) {
    await recoverStuckScanState(snapshot);
    try {
      for (let round = 0; round < HEAL_MAX_ROUNDS; round += 1) {
        if (!snapshot?.results?.length) break;
        const stillNeedsHeal =
          hasUnscannedRows(snapshot.results) ||
          snapshot.results.some(rowNeedsChartHeal);
        if (!stillNeedsHeal) break;
        const healed = await healCacheOnRead(snapshot, {}, {
          maxSymbols: HEAL_MAX_SYMBOLS,
        });
        if (healed) snapshot = healed;
      }
    } catch {
      // return best-effort snapshot if inline heal fails
    }
  } else if (!status.scanInProgress) {
    queueStaleChartRescans(snapshot);
  }

  if (snapshot?.results?.length) {
    try {
      const { results, changed } = await enrichSnapshotSessions(
        snapshot.results,
        { maxSymbols: SESSION_ENRICH_MAX },
      );
      if (changed) {
        snapshot = { ...snapshot, results, lastSavedAt: new Date().toISOString() };
        await saveSnapshot(snapshot);
      }
    } catch {
      // return best-effort snapshot if session enrich fails
    }
  }

  status = await buildCacheStatus(snapshot);

  const unscannedCount = snapshot?.results?.filter(
    (row) => row.error === "Not scanned yet",
  ).length ?? 0;
  const chartRefreshPendingCount = snapshot?.results?.filter(
    (row) =>
      row.error === "Chart data refresh pending" ||
      (row.ema20 == null && row.error != null && rowNeedsChartHeal(row)),
  ).length ?? 0;

  return NextResponse.json(
    { ...toCachedResponse(snapshot, status), unscannedCount, chartRefreshPendingCount },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(_request: NextRequest) {
  if (isCloudflareWorkersRuntime()) {
    await recoverStuckScanState(null);
    const meta = await loadScanMeta();
    const statusPayload = await buildStatusFromMeta(meta);
    const snapshotStub = meta
      ? { scannedAt: meta.scannedAt, symbolCount: meta.symbolCount }
      : null;

    if (statusPayload.scanInProgress) {
      return buildForceScanResponse(
        snapshotStub,
        statusPayload,
        "Scan already in progress",
      );
    }

    scheduleScanJob({}, { force: true });
    return buildForceScanResponse(
      snapshotStub,
      { ...statusPayload, scanInProgress: true },
      "Rescan started",
    );
  }

  const snapshot = await loadSnapshot();
  await recoverStuckScanState(snapshot);
  let status = await buildCacheStatus(snapshot);

  if (status.scanInProgress) {
    return buildForceScanResponse(
      snapshot,
      status,
      "Scan already in progress",
    );
  }

  scheduleScanJob({}, { force: true });
  status = await buildCacheStatus(snapshot);

  return buildForceScanResponse(snapshot, status, "Rescan started");
}
