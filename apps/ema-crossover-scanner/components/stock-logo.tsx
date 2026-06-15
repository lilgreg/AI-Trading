"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildLogoUrlChain,
  logoBadgeColor,
  logoInitials,
} from "@/lib/symbol-logo";

interface StockLogoProps {
  displayTicker: string;
  tradingViewSymbol?: string | null;
  yahooSymbol?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
  className?: string;
}

export function StockLogo({
  displayTicker,
  tradingViewSymbol,
  yahooSymbol,
  companyName,
  logoUrl,
  className = "",
}: StockLogoProps) {
  const urls = useMemo(
    () =>
      buildLogoUrlChain(
        displayTicker,
        tradingViewSymbol,
        yahooSymbol ?? displayTicker,
        logoUrl,
        companyName,
      ),
    [displayTicker, tradingViewSymbol, yahooSymbol, logoUrl, companyName],
  );

  const initials = logoInitials(displayTicker);
  const badgeColor = logoBadgeColor(displayTicker);

  const [urlIndex, setUrlIndex] = useState(0);

  useEffect(() => {
    setUrlIndex(0);
  }, [urls]);

  const showPlaceholder = urls.length === 0 || urlIndex >= urls.length;

  if (showPlaceholder) {
    return (
      <span
        className={`stock-logo-placeholder inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none text-white ${className}`}
        style={{ backgroundColor: badgeColor }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={urls[urlIndex]}
      alt=""
      width={26}
      height={26}
      loading="lazy"
      decoding="async"
      className={`stock-logo h-[26px] w-[26px] shrink-0 rounded-md object-contain bg-[var(--surface-2)] ${className}`}
      onError={() => setUrlIndex((i) => i + 1)}
    />
  );
}
