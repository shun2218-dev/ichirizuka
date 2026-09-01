import type { Daily, DailyMetricKey, FitSummary, Run } from "./sheet";

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

/**
 * 週の目標距離。シートの設定 → 環境変数 → 既定値の順。
 *
 * シートを優先するのは、再デプロイなしで変えられるほうが実用に耐えるから。
 * メニュー生成も同じ値を使うので、解決の順番はここ 1 か所に置く。
 */
export function resolveTargetKm(weeklyTargetKm?: number | null): number {
  return weeklyTargetKm ?? (Number(process.env.WEEKLY_TARGET_KM ?? 30) || 30);
}

export function buildOverview(allRuns: Run[], now: Date, weeklyTargetKm?: number | null) {
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

  const targetKm = resolveTargetKm(weeklyTargetKm);

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

/* ── 日次のコンディション ───────────────────── */

/**
 * 表示する指標と単位。桁数は「見て意味がある精度」で決める
 * （体重の 0.1kg は意味があるが、歩数の 0.1 歩は意味がない）。
 *
 * avgDigits は平均と前週比に使う。安静時心拍の 0.5bpm の差は読みたいので
 * 実測値より 1 桁細かくする。歩数だけは小数にしても意味がない。
 */
export const DAILY_METRICS: {
  key: DailyMetricKey;
  label: string;
  unit: string;
  digits: number;
  avgDigits: number;
}[] = [
  { key: "restingHr", label: "安静時心拍数", unit: "bpm", digits: 0, avgDigits: 1 },
  { key: "hrv", label: "HRV", unit: "ms", digits: 0, avgDigits: 1 },
  { key: "vo2max", label: "VO2max", unit: "mL/kg/min", digits: 1, avgDigits: 1 },
  { key: "weight", label: "体重", unit: "kg", digits: 1, avgDigits: 1 },
  { key: "steps", label: "歩数", unit: "歩", digits: 0, avgDigits: 0 },
  { key: "sleepHours", label: "睡眠", unit: "時間", digits: 1, avgDigits: 1 },
];

/** null を除いた平均。1 つも無ければ null */
function mean(values: (number | null)[]): number | null {
  const ns = values.filter((v): v is number => v !== null);
  return ns.length ? sum(ns) / ns.length : null;
}

export type DailyMetricSummary = {
  key: DailyMetricKey;
  label: string;
  unit: string;
  digits: number;
  avgDigits: number;
  /** いちばん新しい記録。指標ごとに欠測日が違うので日付も持つ */
  latest: { value: number; date: Date } | null;
  last7: number | null;
  prev7: number | null;
  /** 直近7日 − 前の7日。どちらかが欠けていれば null */
  delta: number | null;
  /** 直近7日のうち記録があった日数 */
  covered: number;
};

export type ConditionWeek = {
  start: Date;
  km: number;
  restingHr: number | null;
  hrv: number | null;
};

/** 日次の指標を、走行距離と同じ週の区切り（月曜起点）に寄せる */
function conditionWeeks(days: Daily[], weeks: WeekBucket[]): ConditionWeek[] {
  const byWeek = new Map<string, Daily[]>();
  for (const d of days) {
    const key = dayKey(startOfWeek(d.date));
    const bucket = byWeek.get(key);
    if (bucket) bucket.push(d);
    else byWeek.set(key, [d]);
  }

  return weeks.map((w) => {
    const bucket = byWeek.get(dayKey(w.start)) ?? [];
    const avg = (key: DailyMetricKey) => {
      const v = mean(bucket.map((d) => d[key]));
      return v === null ? null : Math.round(v);
    };
    return { start: w.start, km: w.km, restingHr: avg("restingHr"), hrv: avg("hrv") };
  });
}

export function buildCondition(allDays: Daily[], weeks: WeekBucket[], now: Date) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  // 未来日の行（シートの打ち間違い）は平均を狂わせるだけなので落とす
  const days = allDays.filter((d) => d.date < tomorrow);

  const inRange = (from: Date, to: Date) => days.filter((d) => d.date >= from && d.date < to);
  const last7 = inRange(addDays(tomorrow, -7), tomorrow);
  const prev7 = inRange(addDays(tomorrow, -14), addDays(tomorrow, -7));

  const metrics: DailyMetricSummary[] = DAILY_METRICS.map((m) => {
    const recorded = days.filter((d) => d[m.key] !== null);
    const newest = recorded[recorded.length - 1];
    const a = mean(last7.map((d) => d[m.key]));
    const b = mean(prev7.map((d) => d[m.key]));
    return {
      ...m,
      latest: newest ? { value: newest[m.key] as number, date: newest.date } : null,
      last7: a,
      prev7: b,
      delta: a !== null && b !== null ? a - b : null,
      covered: last7.filter((d) => d[m.key] !== null).length,
    };
  });

  return {
    days,
    metrics,
    /** 値が 1 つも入っていない指標は、そもそも送られていないので表から外す */
    available: metrics.filter((m) => m.latest !== null),
    weeks: conditionWeeks(days, weeks),
  };
}

export type Condition = ReturnType<typeof buildCondition>;

/**
 * 強度の 3 分割。
 *
 * 80/20 は閾値（LT1 / LT2）で切る 3 ゾーンモデルの話で、HealthFit の 5 ゾーン
 * （%最大心拍）とは切り方が違う。5 ゾーンを %最大心拍に直したうえで割り当てる。
 */
export type IntensityBand = "easy" | "moderate" | "hard";

/** LT1 / LT2 の目安（%最大心拍）。実測ではないので境界そのものに幅がある */
const EASY_BELOW_PCT = 80;
const HARD_FROM_PCT = 90;

/**
 * ゾーン i がどの帯に入るかを、**帯の中点**の %最大心拍で決める。
 *
 * 下限で判定すると設定変更をまたいだときに同じゾーンが別の帯へ落ちる。実際に
 * 境界が 195 → 194 に変わった記録があり、ゾーン 4 の下限は 156/195 = 80.0% と
 * 155/194 = 79.9% で easy と moderate に割れてしまう。中点なら両方 moderate。
 */
function bandOfZone(run: FitSummary, i: number): IntensityBand | null {
  const max = run.maxHrSetting;
  const upper = run.zoneBounds[i];
  if (!max || !upper) return null;

  const lower = i === 0 ? 0 : (run.zoneBounds[i - 1] ?? 0);
  const mid = (((lower + upper) / 2) / max) * 100;
  return mid < EASY_BELOW_PCT ? "easy" : mid < HARD_FROM_PCT ? "moderate" : "hard";
}

export type IntensitySplit = {
  /** 秒 */
  easy: number;
  moderate: number;
  hard: number;
  total: number;
  /** 集計に使えたラン数（ゾーンの境界が読めたもの） */
  runs: number;
};

export function intensitySplit(fit: FitSummary[]): IntensitySplit {
  const out: IntensitySplit = { easy: 0, moderate: 0, hard: 0, total: 0, runs: 0 };
  for (const run of fit) {
    let used = false;
    run.zoneSec.forEach((sec, i) => {
      const band = bandOfZone(run, i);
      if (!band || sec <= 0) return;
      out[band] += sec;
      out.total += sec;
      used = true;
    });
    if (used) out.runs++;
  }
  return out;
}

export type IntensityWeek = IntensitySplit & { start: Date; isCurrent: boolean };

/** 週ごとの内訳。区切りは走行距離と同じ月曜起点にそろえる */
export function intensityWeeks(fit: FitSummary[], now: Date, weeks = 26): IntensityWeek[] {
  const currentWeek = startOfWeek(now);
  const out: IntensityWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(currentWeek, -7 * i);
    const end = addDays(start, 7);
    const inWeek = fit.filter((r) => r.start >= start && r.start < end);
    out.push({ ...intensitySplit(inWeek), start, isCurrent: i === 0 });
  }
  return out;
}

/**
 * Running の行のうち、何本が Fit タブと突き合ったか。
 *
 * 取り込みを始める前のランには FIT が無い。「8 割が moderate」のような数字を、
 * 一部のランだけから出していないかを画面で言えるようにする。
 */
export function fitCoverage(runs: Run[], fit: FitSummary[], from: Date) {
  const seen = new Set(fit.map((r) => r.start.getTime()));
  const target = runs.filter((r) => r.distance >= NOISE_KM && r.start >= from);
  return {
    withFit: target.filter((r) => seen.has(r.start.getTime())).length,
    total: target.length,
  };
}
