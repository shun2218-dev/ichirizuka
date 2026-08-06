/**
 * VDOT（Jack Daniels）による実力の推定と、そこから導くトレーニングペース。
 *
 * 数式が閉じた形で書けるモデルを選んだ理由は docs/specification.md を参照。
 * ここは React にもシートにも依存しない純粋関数だけを置く。
 */

import type { Run } from "./sheet";

export const MARATHON_M = 42195;

/** 走速度 v（m/分）で必要な酸素摂取量 mL/kg/min（Daniels & Gilbert） */
function vo2At(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/**
 * t 分の全力走で使える VDOT の割合。
 * 短いほど 100% を超え、長くなるほど下がる（マラソンなら 8 割前後）。
 */
function fractionAt(t: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
}

/** 距離（m）と所要時間（秒）から VDOT。読めない入力は null */
export function vdotOf(distanceM: number, sec: number): number | null {
  if (!(distanceM > 0) || !(sec > 0)) return null;
  const minutes = sec / 60;
  const v = distanceM / minutes;
  const f = fractionAt(minutes);
  if (!(f > 0)) return null;
  const vdot = vo2At(v) / f;
  return Number.isFinite(vdot) && vdot > 0 ? vdot : null;
}

/**
 * VDOT の `fraction` 倍の強度で走れる速度（m/分）。
 *
 * `vo2At` は v の二次式なので、解の公式で閉じた形で解ける（反復は要らない）。
 */
function velocityAt(vdot: number, fraction: number): number {
  const target = vdot * fraction;
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + target);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/**
 * VDOT から距離（m）の予測タイム（秒）。
 *
 * 速度が上がれば要求 VDOT も上がる（単調増加）ので二分法で挟む。
 * 距離ごとに「その時間で使える割合」が変わるため、単純な比例では出せない。
 */
export function predictSec(vdot: number, distanceM: number): number {
  let lo = 50;
  let hi = 800;
  for (let i = 0; i < 60; i++) {
    const v = (lo + hi) / 2;
    const required = vo2At(v) / fractionAt(distanceM / v);
    if (required < vdot) lo = v;
    else hi = v;
  }
  return (distanceM / ((lo + hi) / 2)) * 60;
}

/** 秒/km に直す。v は m/分 */
const paceOf = (v: number) => 60000 / v;

/** すべて 秒/km */
export type TrainingPaces = {
  /** E は幅で示す。1 つの数字にすると「その速さで走るもの」と読めてしまう */
  easyFast: number;
  easySlow: number;
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
};

/**
 * E ペースの強度域（%VDOT）。
 *
 * 「イージーは 59–74%VO2max」という言い方が広く使われているが、その上端をそのまま
 * ペースに直すと公表されている E ペースより 40 秒/km ほど速くなる。**E は速すぎる側に
 * 外すと目的そのものを壊す**（楽に走るための指示で楽でなくなる）ので、生理学的な帯では
 * なく公表ペースに合うほうを採った。VDOT 40 / 50 / 60 で数秒差に収まることを確認済み。
 */
const EASY_RANGE: [number, number] = [0.55, 0.63];

/**
 * 各ペースの強度。%VDOT で与える。
 *
 * T と I は「何分もつか」から導ける（T = 60 分走れる強度、I = ちょうど 100%）ので、
 * 定数を置かずに fractionAt から取る。M は予測マラソンペースそのもの。
 * R は無酸素側で、この式の外挿になるため目安として扱う。
 */
export function trainingPaces(vdot: number): TrainingPaces {
  return {
    easySlow: paceOf(velocityAt(vdot, EASY_RANGE[0])),
    easyFast: paceOf(velocityAt(vdot, EASY_RANGE[1])),
    marathon: predictSec(vdot, MARATHON_M) / (MARATHON_M / 1000),
    threshold: paceOf(velocityAt(vdot, fractionAt(60))),
    interval: paceOf(velocityAt(vdot, 1)),
    repetition: paceOf(velocityAt(vdot, 1.05)),
  };
}

export type RaceEquivalent = { label: string; distanceM: number; sec: number };

const RACE_DISTANCES: { label: string; distanceM: number }[] = [
  { label: "5km", distanceM: 5000 },
  { label: "10km", distanceM: 10000 },
  { label: "ハーフ", distanceM: 21097.5 },
  { label: "フル", distanceM: MARATHON_M },
];

export function raceEquivalents(vdot: number): RaceEquivalent[] {
  return RACE_DISTANCES.map((d) => ({ ...d, sec: predictSec(vdot, d.distanceM) }));
}

export type VdotEstimate = {
  vdot: number;
  /** 根拠にした 1 本。どのランから出したかを画面で言えるようにする */
  run: Run;
};

/** VDOT を出すのに使う最短距離。これより短いと 1 本の走りのばらつきが乗りすぎる */
const MIN_DISTANCE_KM = 3;

/**
 * 期間内でいちばん高い VDOT を出したランを採る。
 *
 * ここで使えるのは**レースではなく普段の練習**なので、全力で走った 1 本が無ければ
 * 実力より低く出る。つまりこの値は下限で、上振れの心配より下振れを疑うほうが正しい。
 */
export function estimateVdot(runs: Run[], from: Date): VdotEstimate | null {
  let best: VdotEstimate | null = null;
  for (const run of runs) {
    if (run.start < from || run.distance < MIN_DISTANCE_KM) continue;
    const vdot = vdotOf(run.distance * 1000, run.movingSec);
    if (vdot !== null && (!best || vdot > best.vdot)) best = { vdot, run };
  }
  return best;
}

/**
 * マラソンの予測が素直に当たるとされる週間距離の目安（km）。
 *
 * 短い距離の実績からマラソンを外挿すると速すぎる予測が出るが、原因は心肺能力では
 * なく走り込み量。ここに届いていない場合、予測は楽観側とみなす。
 */
export const MARATHON_WEEKLY_KM = 64;

/** 30km 走をしていないうちは、後半の失速を予測に織り込めない */
export const MARATHON_LONG_RUN_KM = 30;

export type GoalGap = {
  goalSec: number;
  /** そのタイムで走るのに必要な VDOT */
  goalVdot: number;
  /** 必要 VDOT − 今の VDOT。プラスなら足りていない */
  vdotGap: number;
  /** 予測タイム − 目標タイム（秒）。プラスなら目標のほうが速い */
  secGap: number;
};

/**
 * 目標タイムと今の実力の差。
 *
 * 「そのタイムで走る」ことと「その VDOT を持っている」ことは同じなので、
 * 目標タイムをそのまま VDOT に直して引き算する。
 */
export function goalGap(vdot: number, goalSec: number): GoalGap | null {
  const goalVdot = vdotOf(MARATHON_M, goalSec);
  if (goalVdot === null) return null;
  return {
    goalSec,
    goalVdot,
    vdotGap: goalVdot - vdot,
    secGap: predictSec(vdot, MARATHON_M) - goalSec,
  };
}

export type MarathonOutlook = {
  /** VDOT どおりに走れた場合（秒） */
  optimistic: number;
  /** 走り込み量を踏まえた現実的な側（秒）。足りていれば optimistic と同じ */
  realistic: number;
  weeklyKm: number;
  longestKm: number;
  /** 走り込み量が目安に届いているか */
  ready: boolean;
};

/**
 * 走り込み量で予測を割り引く。
 *
 * **係数 0.12 は経験則で、根拠のある定数ではない。** 週の走行距離が目安の半分なら
 * 1 割強遅く見る、という程度の意味しか持たせていない。1 つの数字を信じさせるより
 * 幅で見せるほうが誠実なので、optimistic と realistic の 2 つを返す。
 */
export function marathonOutlook(
  vdot: number,
  weeklyKm: number,
  longestKm: number,
): MarathonOutlook {
  const optimistic = predictSec(vdot, MARATHON_M);
  const volume = Math.min(1, weeklyKm / MARATHON_WEEKLY_KM);
  const long = Math.min(1, longestKm / MARATHON_LONG_RUN_KM);
  const shortfall = 1 - Math.min(volume, long);

  return {
    optimistic,
    realistic: optimistic * (1 + shortfall * 0.12),
    weeklyKm,
    longestKm,
    ready: shortfall <= 0,
  };
}
