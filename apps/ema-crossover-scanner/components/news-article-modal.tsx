"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNewsPreviewFresh,
  getCachedNewsPreview,
} from "@/lib/news-preview-cache";
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

const ADEQUATE_SUMMARY_LEN = 80;

function longestSummary(...candidates: (string | null | undefined)[]): string {
  let best = "";
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > best.length) best = trimmed;
  }
  return best;
}

function looksLikeFooterJunk(text: string): boolean {
  return /\b(Terms and Privacy Policy|Recommended Stories|Sign in to access your portfolio|ADVERTISEMENT|Privacy Dashboard)\b/i.test(
    text,
  );
}

function pickBestSummary(...candidates: (string | null | undefined)[]): string {
  const trimmed = candidates
    .map((c) => c?.trim())
    .filter((c): c is string => Boolean(c));
  const clean = trimmed.filter((t) => !looksLikeFooterJunk(t));
  return longestSummary(...(clean.length ? clean : trimmed));
}

function hasAdequateSummary(text: string | null | undefined): boolean {
  return Boolean(text?.trim() && text.trim().length >= ADEQUATE_SUMMARY_LEN);
}

interface NewsArticleModalProps {
  article: NewsHeadline | null;
  onClose: () => void;
}

export function NewsArticleModal({ article, onClose }: NewsArticleModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [displaySummary, setDisplaySummary] = useState("");
  const [previewPending, setPreviewPending] = useState(false);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!article) return;

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
    if (!article) {
      setDisplaySummary("");
      setPreviewPending(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const applyBest = (...candidates: (string | null | undefined)[]) => {
      if (cancelled) return;
      setDisplaySummary((prev) => pickBestSummary(prev, ...candidates));
    };

    const yahooSummary = article.summary?.trim() ?? "";
    const cachedPreview = getCachedNewsPreview(article.url);
    const seed = pickBestSummary(yahooSummary, cachedPreview);
    setDisplaySummary(seed);
    setPreviewPending(Boolean(article.url));

    void (async () => {
      try {
        const preview = await fetchNewsPreviewFresh(
          article.url,
          controller.signal,
          { headline: article.headline, yahooSummary: article.summary },
        );
        if (cancelled) return;
        applyBest(yahooSummary, preview);
      } catch {
        // ignore preview fetch errors
      } finally {
        if (cancelled) return;
        setPreviewPending(false);
        setDisplaySummary((prev) => {
          const best = pickBestSummary(prev, yahooSummary);
          if (hasAdequateSummary(best)) return best;
          return pickBestSummary(best, article.headline);
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [article]);

  if (!article) return null;

  const summaryText = pickBestSummary(
    displaySummary,
    article.summary,
    !previewPending ? article.headline : null,
  );
  const showLoadingHint = previewPending && !hasAdequateSummary(summaryText);

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
            {article.tradingViewUrl ? (
              <a
                href={article.tradingViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="symbol-link news-modal-ticker-link"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="mono font-semibold">{article.displayTicker}</span>
                {article.dailyChange != null && (
                  <span
                    className={`mono text-sm font-semibold ${changeColorClass(article.dailyChange)}`}
                  >
                    {formatSessionChange(article.dailyChange)}
                  </span>
                )}
              </a>
            ) : (
              <>
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
              </>
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
          {showLoadingHint && (
            <span className="news-modal-summary-status" aria-live="polite">
              Loading summary…
            </span>
          )}
          {summaryText ? (
            <div
              className={`news-modal-summary${showLoadingHint ? " news-modal-summary-pending" : ""}`}
            >
              {summaryText}
            </div>
          ) : (
            !previewPending && (
              <p className="news-modal-summary-empty">
                No summary available. Open the full article below.
              </p>
            )
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
