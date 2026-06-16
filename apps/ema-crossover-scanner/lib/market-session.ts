/** US equities session segments in America/New_York. */
export type UsMarketSession = "pre" | "regular" | "afterHours" | "closed";

export interface SessionChanges {
  preMarketChange: number | null;
  regularMarketChange: number | null;
  postMarketChange: number | null;
}

interface NyClock {
  dayOfWeek: number;
  minutesSinceMidnight: number;
}

function getNyClock(at: Date): NyClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekday = get("weekday");
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));

  return {
    dayOfWeek: dayMap[weekday] ?? 0,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

/** Current US equities session (Eastern Time). */
export function getUsMarketSession(at: Date = new Date()): UsMarketSession {
  const { dayOfWeek, minutesSinceMidnight: m } = getNyClock(at);

  // No regular session on weekends; extended hours still apply Mon–Fri only.
  if (dayOfWeek === 0 || dayOfWeek === 6) return "closed";

  const preStart = 4 * 60; // 4:00 AM ET
  const regStart = 9 * 60 + 30; // 9:30 AM ET
  const regEnd = 16 * 60; // 4:00 PM ET
  const ahEnd = 20 * 60; // 8:00 PM ET

  if (m >= preStart && m < regStart) return "pre";
  if (m >= regStart && m < regEnd) return "regular";
  if (m >= regEnd && m < ahEnd) return "afterHours";
  return "closed";
}

function hasSessionValue(value: number | null | undefined): value is number {
  return value != null;
}

/** True on weekdays after 4:00 AM ET — today's pre-market window has started. */
export function isAfterPreMarketStart(at: Date = new Date()): boolean {
  const { dayOfWeek, minutesSinceMidnight: m } = getNyClock(at);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  return m >= 4 * 60;
}

/** Pre-market % from the completed session day — visible until next 4 AM ET pre-market. */
export function shouldShowPre(
  session: UsMarketSession = getUsMarketSession(),
): boolean {
  return (
    session === "pre" ||
    session === "regular" ||
    session === "afterHours" ||
    session === "closed"
  );
}

/** After-hours % visible during AH and overnight closed until next 4 AM ET. */
export function shouldShowAfterHours(
  session: UsMarketSession = getUsMarketSession(),
): boolean {
  return session === "afterHours" || session === "closed";
}

/** Regular session % visible from pre-market onward (yesterday's completed move). */
export function shouldShowRegular(
  session: UsMarketSession = getUsMarketSession(),
): boolean {
  return (
    session === "pre" ||
    session === "regular" ||
    session === "afterHours" ||
    session === "closed"
  );
}

/**
 * Session column visibility rules (ET):
 * - Pre: show when we have data — persists through closed overnight until next 4 AM ET
 * - Reg: show during regular + AH + closed (completed regular move)
 * - AH: show during AH + closed overnight until next 4 AM
 */
export function filterSessionChangesForMarket(
  changes: SessionChanges,
  session: UsMarketSession = getUsMarketSession(),
): SessionChanges {
  const pre =
    shouldShowPre(session) && hasSessionValue(changes.preMarketChange)
      ? changes.preMarketChange
      : null;

  const regular =
    shouldShowRegular(session) && hasSessionValue(changes.regularMarketChange)
      ? changes.regularMarketChange
      : null;

  const postMarket =
    shouldShowAfterHours(session) && hasSessionValue(changes.postMarketChange)
      ? changes.postMarketChange
      : null;

  return {
    preMarketChange: pre,
    regularMarketChange: regular,
    postMarketChange: postMarket,
  };
}
