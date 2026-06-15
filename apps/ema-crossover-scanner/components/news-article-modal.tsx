"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsHeadline } from "@/lib/news";

function changeColorClass(value: number | null): string {
  if (value == null) return "text-[var(--muted)]";
  if (value > 0) return "text-[var(--green)]";
  if (value < 0) return "text-[var(--red)]";
  return "text-[var(--muted)]";
}

function formatSessionChange(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function longestSummary(...candidates: (string | null | undefined)[]): string | null {
  let best = "";
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > best.length) best = trimmed;
  }
  return best || null;
}

interface NewsArticleModalProps {
  article: NewsHeadline | null;
  onClose: () => void;
}

export function NewsArticleModal({ article, onClose }: NewsArticleModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [fetchedSummary, setFetchedSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!article) {
      setFetchedSummary(null);
      setSummaryLoading(false);
      return;
    }

    setFetchedSummary(null);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [article, handleClose]);

  useEffect(() => {
    if (!article) return;

    const controller = new AbortController();
    const hasYahooSummary = Boolean(article.summary?.trim());
    setSummaryLoading(!hasYahooSummary);

    void (async () => {
      try {
        const res = await fetch(
          `/api/news/preview?url=${encodeURIComponent(article.url)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { summary?: string | null };
        if (body.summary?.trim()) setFetchedSummary(body.summary.trim());
      } catch {
        // ignore preview fetch errors
      } finally {
        if (!controller.signal.aborted) setSummaryLoading(false);
      }
    })();

    return () => controller.abort();
  }, [article]);

  if (!article) return null;

  const summary =
    longestSummary(article.summary, fetchedSummary) ??
    (summaryLoading ? null : article.headline);

  return (
    <div
      className="news-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className="news-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-modal-title"
      >
        <button
          type="button"
          className="news-modal-close"
          onClick={handleClose}
          aria-label="Close"
        >
          ×
        </button>

        <div className="news-modal-header">
          <div className="news-modal-ticker">
            <span className="mono font-semibold text-[var(--accent)]">
              {article.displayTicker}
            </span>
            {article.dailyChange != null && (
              <span
                className={`mono text-sm font-semibold ${changeColorClass(article.dailyChange)}`}
              >
                {formatSessionChange(article.dailyChange)}
              </span>
            )}
          </div>
          <p id="news-modal-title" className="news-modal-headline">
            {article.headline}
          </p>
          <p className="news-modal-meta">
            {article.timeAgo} · {article.publisher}
          </p>
        </div>

        <div className="news-modal-body">
          {summaryLoading && !summary ? (
            <p className="news-modal-summary-loading">Loading summary…</p>
          ) : (
            <p className="news-modal-summary">{summary}</p>
          )}
        </div>

        <div className="news-modal-footer">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="news-modal-link"
          >
            Read full article →
          </a>
        </div>
      </div>
    </div>
  );
}
