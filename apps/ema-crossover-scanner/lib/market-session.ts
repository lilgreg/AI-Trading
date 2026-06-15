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

/**
 * Hide session segments that have not started today or carry stale prior-day values.
 * During pre-market, Yahoo still returns yesterday's regularMarketChange — drop it.
 */
export function filterSessionChangesForMarket(
  changes: SessionChanges,
  session: UsMarketSession = getUsMarketSession(),
): SessionChanges {
  switch (session) {
    case "pre":
      return {
        preMarketChange: changes.preMarketChange,
        regularMarketChange: null,
        postMarketChange: null,
      };
    case "regular":
      return {
        preMarketChange: changes.preMarketChange,
        regularMarketChange: changes.regularMarketChange,
        postMarketChange: null,
      };
    case "afterHours":
      return changes;
    case "closed":
      // Overnight / weekend: keep last regular + after-hours for daily % display.
      return {
        preMarketChange: null,
        regularMarketChange: changes.regularMarketChange,
        postMarketChange: changes.postMarketChange,
      };
  }
}
