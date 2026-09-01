/**
 * 「今週のメニュー」を週の頭で確定させる。
 *
 * 生成そのものは lib/plan.ts。ここは**何を入力に取るか**だけを決める層で、
 * すべての入力を**その週の月曜 00:00 時点**で切る。
 *
 * 見るたびに直近 28 日から組み直していたときは、週の途中で 1 本走るだけで
 * 週の合計も本数もペースも変わっていた。**提案が動くと従いようがない**ので、
 * 週内は同じ内容を出し、切り替わりを月曜に寄せる。
 *
 * 週の頭より前のデータしか使わないため、結果はその週のあいだ変わらない
 * （過去の行を後からシートに足したときだけ動く）。
 *
 * React にもシートの取得にも依存しない純粋関数。
 */

import { NOISE_KM, addDays, startOfWeek } from "./metrics";
import type { WeeklyPlan } from "./plan";
import { buildWeeklyPlan } from "./plan";
import type { Daily, Run, Settings } from "./sheet";
import { estimateVdot, trainingPaces } from "./vdot";

/** 実力の推定に使う期間（日）。画面の「今の実力」と同じ幅にそろえる */
const LOOKBACK_DAYS = 180;

/**
 * 疲労のサインのしきい値。前週比の測定ノイズを越える程度という目安で、
 * 根拠のある定数ではない。**質練習を減らす方向にしか使わない**ので、
 * 外しても危険側には倒れない。
 */
const FATIGUE_RESTING_BPM = 1.5;
const FATIGUE_HRV_MS = 3;

export type WeekPlan = {
  /** この内容を確定させた時点（月曜 00:00）。週の途中では動かない */
  weekStart: Date;
  /** 次に組み直される時点（翌週の月曜 00:00） */
  nextAt: Date;
  plan: WeeklyPlan;
};

export type WeekPlanInput = {
  runs: Run[];
  /** Daily タブ。未設定なら空配列でよい（疲労の判定をしないだけ） */
  days: Daily[];
  settings: Settings;
  /** 週の目標距離。buildOverview が解決した値をそのまま渡す */
  targetKm: number | null;
  now: Date;
};

/**
 * その週のメニューを組む。実力を推定できるランが無ければ null
 * （根拠が無いままペースを出すと、目安ではなく当てずっぽうになる）。
 */
export function planForWeek({ runs, days, settings, targetKm, now }: WeekPlanInput): WeekPlan | null {
  const weekStart = startOfWeek(now);

  // 今週走った分は入力に混ぜない。混ぜると走るたびに内容が変わる
  const past = runs.filter((r) => r.distance >= NOISE_KM && r.start < weekStart);

  const from = addDays(weekStart, -LOOKBACK_DAYS);
  const vdot = estimateVdot(past, from);
  if (!vdot) return null;

  const kmIn = (a: Date, b: Date) =>
    past.filter((r) => r.start >= a && r.start < b).reduce((sum, r) => sum + r.distance, 0);

  const chronicKm = kmIn(addDays(weekStart, -28), weekStart) / 4;
  const acuteKm = kmIn(addDays(weekStart, -7), weekStart);
  const load = chronicKm > 0 ? acuteKm / chronicKm : null;

  const longestRecentKm = Math.max(0, ...past.filter((r) => r.start >= from).map((r) => r.distance));

  const weeksToRace = settings.raceDate
    ? Math.floor((+settings.raceDate - +weekStart) / (86400000 * 7))
    : null;

  const plan = buildWeeklyPlan({
    paces: trainingPaces(vdot.vdot),
    chronicKm,
    longestRecentKm,
    load,
    trainingDays: settings.trainingDays,
    targetKm,
    weeksToRace,
    fatigued: fatiguedAt(days, weekStart),
  });

  return { weekStart, nextAt: addDays(weekStart, 7), plan };
}

/** 安静時心拍が上がっている / HRV が下がっているか。基準日より前の 7 日 vs その前の 7 日 */
function fatiguedAt(days: Daily[], at: Date): boolean {
  const delta = (key: "restingHr" | "hrv") => {
    const mean = (a: Date, b: Date) => {
      const ns = days
        .filter((d) => d.date >= a && d.date < b)
        .map((d) => d[key])
        .filter((v): v is number => v !== null);
      return ns.length ? ns.reduce((x, y) => x + y, 0) / ns.length : null;
    };
    const last = mean(addDays(at, -7), at);
    const prev = mean(addDays(at, -14), addDays(at, -7));
    return last !== null && prev !== null ? last - prev : null;
  };

  const resting = delta("restingHr");
  const hrv = delta("hrv");
  return (
    (resting !== null && resting > FATIGUE_RESTING_BPM) || (hrv !== null && hrv < -FATIGUE_HRV_MS)
  );
}
