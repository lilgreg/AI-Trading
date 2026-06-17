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

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_RETRY_FAILED_LIMIT = 25;
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
    const needsHeal = hasUnscanned || hasStaleChartRows;

    const status = await buildStatusFromMeta(meta);

    if (status.cacheEmpty || hasUnscanned) {
      scheduleScanJob({});
    } else if (status.stale) {
      scheduleScanJob({});
    }

    let responseSnapshot = snapshot;
    if (snapshot && needsHeal && (heal || hasUnscanned)) {
      try {
        responseSnapshot =
          (await healCacheOnRead(snapshot, {}, { maxSymbols: 2 })) ?? snapshot;
      } catch {
        // return cached snapshot if inline heal fails
      }
    }

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
      },
      { headers: { "Cache-Control": "no-store" } },
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
