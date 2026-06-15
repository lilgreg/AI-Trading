"use client";

import { useState } from "react";
import { logoInitials, tradingViewLogoUrl } from "@/lib/symbol-logo";

interface StockLogoProps {
  displayTicker: string;
  tradingViewSymbol?: string | null;
  className?: string;
}

export function StockLogo({
  displayTicker,
  tradingViewSymbol,
  className = "",
}: StockLogoProps) {
  const [failed, setFailed] = useState(false);
  const initials = logoInitials(displayTicker);

  if (failed) {
    return (
      <span
        className={`stock-logo-placeholder inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[10px] font-semibold leading-none text-[var(--muted)] ${className}`}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={tradingViewLogoUrl(displayTicker, tradingViewSymbol)}
      alt=""
      width={26}
      height={26}
      loading="lazy"
      decoding="async"
      className={`stock-logo h-[26px] w-[26px] shrink-0 rounded-md object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
