import type { Run } from "./sheet";

/** これより短い記録は誤タップ扱いで集計から外す（km） */
export const NOISE_KM = 0.4;

/**
 * シートの日時は Asia/Tokyo の壁時計そのまま。サーバーは UTC で動くので、
 * 「今」も同じ壁時計に合わせてから比べる。
 */
export function wallClockNow(timeZone = process.env.APP_TIMEZONE ?? "Asia/Tokyo"): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 月曜 00:00 起点 */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const shift = (s.getDay() + 6) % 7;
  s.setDate(s.getDate() - shift);
  return s;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

function aggregate(runs: Run[]) {
  const km = sum(runs.map((r) => r.distance));
  const sec = sum(runs.map((r) => r.movingSec));
  const hrs = runs.map((r) => r.hr).filter((h): h is number => h !== null);
  return {
    runs: runs.length,
    km,
    sec,
    kcal: sum(runs.map((r) => r.kcal)),
    elevation: sum(runs.map((r) => r.elevation)),
    pace: km > 0 ? sec / km : 0,
    hr: hrs.length ? Math.round(sum(hrs) / hrs.length) : null,
    longest: runs.length ? Math.max(...runs.map((r) => r.distance)) : 0,
  };
}

export type Bucket = ReturnType<typeof aggregate>;

function inRange(runs: Run[], from: Date, to: Date) {
  return runs.filter((r) => r.start >= from && r.start < to);
}

export type WeekBucket = Bucket & { start: Date; isCurrent: boolean };

export function weeklySeries(runs: Run[], now: Date, weeks = 52): WeekBucket[] {
  const currentWeek = startOfWeek(now);
  const out: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(currentWeek, -7 * i);
    const end = addDays(start, 7);
    out.push({ ...aggregate(inRange(runs, start, end)), start, isCurrent: i === 0 });
  }
  return out;
}

export type MonthBucket = Bucket & { key: string; label: string };

export function monthlySeries(runs: Run[], now: Date, months = 12): MonthBucket[] {
  const out: MonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({
      ...aggregate(inRange(runs, start, end)),
      key: monthKey(start),
      label: `${start.getFullYear()}年${start.getMonth() + 1}月`,
    });
  }
  return out;
}

/** 「◯km 以上のランでいちばん速かった 1 本」を距離帯ごとに */
const PB_TIERS: { label: string; min: number }[] = [
  { label: "3km+", min: 3 },
  { label: "5km+", min: 5 },
  { label: "10km+", min: 10 },
  { label: "15km+", min: 15 },
  { label: "ハーフ+", min: 21.097 },
  { label: "30km+", min: 30 },
];

export function personalBests(runs: Run[]) {
  return PB_TIERS.map(({ label, min }) => {
    const pool = runs.filter((r) => r.distance >= min);
    if (!pool.length) return { label, min, run: null as Run | null, count: 0 };
    const best = pool.reduce((a, b) => (b.pace < a.pace ? b : a));
    return { label, min, run: best, count: pool.length };
  });
}

export function buildOverview(allRuns: Run[], now: Date) {
  const runs = allRuns.filter((r) => r.distance >= NOISE_KM);
  const skipped = allRuns.length - runs.length;

  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const last7 = inRange(runs, addDays(tomorrow, -7), tomorrow);
  const prev7 = inRange(runs, addDays(tomorrow, -14), addDays(tomorrow, -7));
  const last28 = inRange(runs, addDays(tomorrow, -28), tomorrow);
  const thisYear = inRange(runs, new Date(now.getFullYear(), 0, 1), tomorrow);

  const weeks = weeklySeries(runs, now, 52);
  const currentWeek = weeks[weeks.length - 1];

  const acute = aggregate(last7).km;
  const chronic = aggregate(last28).km / 4;
  const load = chronic > 0 ? acute / chronic : null;

  // 「1 回以上走った週」が何週続いているか（今週はまだ走っていなくても途切れ扱いにしない）
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].runs > 0) streak++;
    else if (i !== weeks.length - 1) break;
  }

  const last = runs[runs.length - 1] ?? null;
  const restDays = last ? Math.floor((+today - +startOfDay(last.start)) / 86400000) : null;

  const targetKm = Number(process.env.WEEKLY_TARGET_KM ?? 30) || 30;

  return {
    runs,
    skipped,
    last,
    restDays,
    targetKm,
    week: { ...currentWeek, target: targetKm },
    last7: aggregate(last7),
    prev7: aggregate(prev7),
    last28: aggregate(last28),
    thisYear: aggregate(thisYear),
    total: aggregate(runs),
    weeks,
    months: monthlySeries(runs, now, 12),
    bests: personalBests(runs),
    load,
    streak,
  };
}

export type Overview = ReturnType<typeof buildOverview>;
