/**
 * 週次の練習メニューを組む。
 *
 * ペースは VDOT から出したものをそのまま使う（lib/vdot.ts）。**目標タイムから
 * 逆算したペースは使わない。** 目標が今の実力とかけ離れている場合、達成不能な
 * メニューが出て怪我に繋がるため。目標との差は「あとどれくらい必要か」として
 * 別に示す。
 *
 * ここは React にもシートにも依存しない純粋関数だけを置く。
 */

import type { TrainingPaces } from "./vdot";
import { MARATHON_WEEKLY_KM } from "./vdot";

export type WorkoutKind = "easy" | "long" | "threshold" | "interval" | "marathon";

export type PlannedWorkout = {
  /** 0=日 … 6=土。走れる曜日の指定が無ければ null */
  day: number | null;
  kind: WorkoutKind;
  /** その練習で走る距離 km（質練習はウォームアップ・クールダウンを含まない） */
  km: number;
  /** 秒/km。速いほうの端 */
  paceSec: number;
  /**
   * 幅で示すときの遅いほうの端。E は 1 つの数字にすると「その速さで走るもの」と
   * 読めてしまい、速すぎる側に倒れる。実測で easy が 1 割しか無い状況では特に。
   */
  paceSecSlow?: number;
  note: string;
};

export type Phase = "maintain" | "base" | "build" | "peak" | "taper";

export type WeeklyPlan = {
  phase: Phase;
  weeksToRace: number | null;
  totalKm: number;
  workouts: PlannedWorkout[];
  /** なぜこの内容になったかの説明。そのまま画面に出す */
  notes: string[];
  /** 目標の週間距離まで、レースまでに届かないと判断したとき */
  outOfReach: boolean;
};

/**
 * 質練習の量の上限（週間距離に対する割合）。
 *
 * Daniels の目安をそのまま使う。**回数ではなく量で縛る**のが要点で、走れる日数が
 * 少なくても 80/20 が崩れない。当初は「日数が少ないときは質の回数を保って E を削る」
 * と考えていたが、週 2 日で質 2 回だと easy が 0 になり、配分の原則と正面から
 * ぶつかるので採らなかった。
 */
const THRESHOLD_SHARE = 0.1;
const INTERVAL_SHARE = 0.08;

/**
 * 1 週あたりの増やし幅。
 *
 * ACWR（直近 7 日 ÷ 直近 28 日の週平均）が「積み上げやすいゾーン」0.8–1.3 に
 * 収まるように、生成の側で最初から抑える。急に増やす提案が出ない作りにしておく。
 */
const WEEKLY_GROWTH = 1.1;

/** ACWR がこれを超えていたら、その週は増やさない */
const LOAD_CEILING = 1.3;

/** ロング走は週の 3 割弱。マラソン練習でもここは 30km で頭打ちにする */
const LONG_SHARE = 0.28;
const LONG_CAP_KM = 30;

/**
 * 1 本あたりの伸ばし幅。
 *
 * 週の量を抑えていても、走れる日が少ないと 1 本が跳ねる（週 2 日で 23km なら
 * 1 本 12km）。直近でいちばん長かった距離から急に伸ばさないよう、本数側にも
 * 上限を置く。
 */
const SESSION_GROWTH = 1.15;

/** テーパーで落とす割合。強度は残して量だけ落とす */
const TAPER_SHARE = 0.7;

/** 走れる曜日の指定が無いときに想定する週あたりの日数 */
const DEFAULT_DAYS = 4;

export type PlanInput = {
  paces: TrainingPaces;
  /** 直近 28 日の週平均（km）。積み上げの起点 */
  chronicKm: number;
  /** 直近でいちばん長かった 1 本（km）。1 本あたりの上限に使う */
  longestRecentKm: number;
  /** ACWR。判定できないときは null */
  load: number | null;
  /** 走れる曜日。空なら指定なし */
  trainingDays: number[];
  /** 週の目標距離。これを超えて増やす提案はしない */
  targetKm: number | null;
  /** レースまでの週数。未定なら null */
  weeksToRace: number | null;
  /** 疲労のサイン（安静時心拍の上昇 / HRV の低下）が出ているか */
  fatigued: boolean;
};

function phaseOf(weeksToRace: number | null): Phase {
  if (weeksToRace === null) return "maintain";
  if (weeksToRace <= 2) return "taper";
  if (weeksToRace <= 6) return "peak";
  if (weeksToRace <= 12) return "build";
  return "base";
}

/**
 * 目標の週間距離まで、レースまでに届くか。
 *
 * 週 `WEEKLY_GROWTH` 倍ずつ増やしたとして何週かかるかを対数で出し、テーパーの
 * 3 週を引いた残りと比べる。**届かないなら黙って詰め込まず、そう表示する。**
 */
function reachable(chronicKm: number, weeksToRace: number | null): boolean {
  if (weeksToRace === null || chronicKm <= 0) return true;
  if (chronicKm >= MARATHON_WEEKLY_KM) return true;
  const weeksNeeded = Math.log(MARATHON_WEEKLY_KM / chronicKm) / Math.log(WEEKLY_GROWTH);
  return weeksNeeded <= weeksToRace - 3;
}

export function buildWeeklyPlan(input: PlanInput): WeeklyPlan {
  const { paces, chronicKm, longestRecentKm, load, trainingDays, targetKm, weeksToRace, fatigued } =
    input;
  const phase = phaseOf(weeksToRace);
  const notes: string[] = [];

  /* ── 週の量を決める ───────────────────── */

  let totalKm = chronicKm * WEEKLY_GROWTH;

  if (targetKm !== null && totalKm > targetKm) {
    // 目標に届いているなら伸ばさない。目標は上限として扱う
    totalKm = Math.max(targetKm, chronicKm);
    notes.push(`週の目標 ${Math.round(targetKm)}km に届いているので、量は増やさない。`);
  }

  if (load !== null && load > LOAD_CEILING) {
    totalKm = chronicKm;
    notes.push(`直近の負荷が高い（${load.toFixed(2)}）ので、今週は量を増やさない。`);
  }

  if (fatigued) {
    totalKm = Math.min(totalKm, chronicKm);
    notes.push("安静時心拍か HRV に疲労のサインが出ている。量を増やさず質を 1 つ減らす。");
  }

  if (phase === "taper") {
    totalKm = chronicKm * TAPER_SHARE;
    notes.push("レースが近いので量を落とす。強度は残す。");
  }

  totalKm = Math.max(0, Math.round(totalKm * 10) / 10);

  /* ── 質練習の本数を決める ─────────────── */

  const days = trainingDays.length || DEFAULT_DAYS;
  let quality = days >= 4 ? 2 : days >= 2 ? 1 : 0;

  // 基礎期は土台を作る時期なので質を欲張らない
  if (phase === "base") quality = Math.min(quality, 1);
  if (fatigued || (load !== null && load > LOAD_CEILING)) quality = Math.max(0, quality - 1);
  // 走る日が 1 日しかないなら、その 1 本は土台に使う
  if (days <= 1) quality = 0;

  /* ── 各練習を組み立てる ───────────────── */

  const workouts: PlannedWorkout[] = [];

  // 1 本の上限。直近の最長から急に伸ばさない
  const sessionCap =
    Math.round(
      Math.max(
        3,
        Math.min(LONG_CAP_KM, longestRecentKm > 0 ? longestRecentKm * SESSION_GROWTH : LONG_CAP_KM),
      ) * 10,
    ) / 10;

  // ロング走。量が少ないうちは無理に伸ばさない
  const longKm = Math.min(sessionCap, Math.round(totalKm * LONG_SHARE * 10) / 10);
  if (longKm > 0 && days >= 2) {
    workouts.push({
      day: null,
      kind: "long",
      km: longKm,
      paceSec: paces.easyFast,
      paceSecSlow: paces.easySlow,
      note:
        phase === "peak" || phase === "taper"
          ? "後半だけマラソンペースに上げてもよい"
          : "会話できる速さを保つ。距離を稼ぐのが目的",
    });
  }

  if (quality >= 1) {
    const km = Math.max(3, Math.round(totalKm * THRESHOLD_SHARE * 10) / 10);
    workouts.push({
      day: null,
      kind: "threshold",
      km,
      paceSec: paces.threshold,
      note: "20分走 or 5分×4本（つなぎ 1分）。前後にウォームアップとクールダウン",
    });
  }

  if (quality >= 2) {
    // 仕上げの時期はレースペースの体感を作るほうが効く
    const useMarathonPace = phase === "peak" || phase === "taper";
    const km = Math.max(
      3,
      Math.round(totalKm * (useMarathonPace ? THRESHOLD_SHARE : INTERVAL_SHARE) * 10) / 10,
    );
    workouts.push({
      day: null,
      kind: useMarathonPace ? "marathon" : "interval",
      km,
      paceSec: useMarathonPace ? paces.marathon : paces.interval,
      note: useMarathonPace
        ? "本番のペース感覚を作る。単独走で通す"
        : "3〜5分 × 4〜5本（つなぎはジョグ）。前後にウォームアップとクールダウン",
    });
  }

  // 残りをイージーに割る。ここが 8 割側の土台になる
  const qualityKm = workouts.reduce((a, w) => a + (w.kind === "easy" || w.kind === "long" ? 0 : w.km), 0);
  const easyCount = Math.max(0, days - workouts.length);
  let leftover = Math.max(0, totalKm - workouts.reduce((a, w) => a + w.km, 0));

  if (easyCount > 0 && leftover > 0) {
    const each = Math.min(sessionCap, Math.round((leftover / easyCount) * 10) / 10);
    for (let i = 0; i < easyCount; i++) {
      workouts.push({
        day: null,
        kind: "easy",
        km: each,
        paceSec: paces.easyFast,
        paceSecSlow: paces.easySlow,
        note: "楽に。速くしない",
      });
      leftover -= each;
    }
  }

  // 走れる日が少ないと、上のループでは週の量が入りきらない。ロング走に寄せて
  // 吸収し、それでも余るなら黙って捨てずに理由を出す。
  const long = workouts.find((w) => w.kind === "long");
  if (leftover > 0.1 && long) {
    const add = Math.min(leftover, sessionCap - long.km);
    long.km = Math.round((long.km + add) * 10) / 10;
    leftover -= add;
  }
  if (leftover > 0.5) {
    notes.push(
      `走れる日が ${days} 日だと、週 ${Math.round(totalKm)}km は 1 本あたりが大きくなりすぎる。` +
        "走る日を増やすか、量の目標を下げる。",
    );
  }

  // 見出しの合計は、実際に置いた練習の合計にそろえる（入りきらなかった分を
  // 走ったことにしない）
  totalKm = Math.round(workouts.reduce((a, w) => a + w.km, 0) * 10) / 10;

  assignDays(workouts, trainingDays);

  /* ── 補足 ─────────────────────────────── */

  if (quality === 0 && days > 1) {
    notes.push("今週は質練習を置いていない。土台を戻すことを優先する。");
  }
  // ロング走は easy 側なので質には数えない。テーパーは量だけ落とすので、
  // 質の割合が上がるのは意図どおり（そこで注意を出しても意味がない）
  if (phase !== "taper" && totalKm > 0 && qualityKm / totalKm > 0.25) {
    notes.push("質の割合が高い週になっている。イージーを削らないこと。");
  }

  const outOfReach = !reachable(chronicKm, weeksToRace);
  if (outOfReach) {
    notes.push(
      `週 ${Math.round(chronicKm)}km から目安の週 ${MARATHON_WEEKLY_KM}km までは、` +
        "安全に増やせる幅ではレースに間に合わない。距離を詰め込まず、走れる範囲で仕上げる。",
    );
  }

  return { phase, weeksToRace, totalKm, workouts, notes, outOfReach };
}

/**
 * 曜日を割り当てる。
 *
 * ロング走は週末（日曜 → 土曜の順で探す）に置き、質練習はできるだけ離す。
 * 指定が無ければ曜日を決めない（天候や仕事の都合を知らないので押し付けない）。
 */
function assignDays(workouts: PlannedWorkout[], trainingDays: number[]): void {
  if (!trainingDays.length) return;

  const free = [...new Set(trainingDays)].sort((a, b) => a - b);
  const take = (day: number) => {
    const i = free.indexOf(day);
    if (i >= 0) free.splice(i, 1);
    return day;
  };

  const long = workouts.find((w) => w.kind === "long");
  if (long) {
    const weekend = free.includes(0) ? 0 : free.includes(6) ? 6 : free[free.length - 1];
    long.day = take(weekend);
  }

  // 質練習は間隔を空けたいので、残りの日から等間隔に選ぶ
  const quality = workouts.filter((w) => w.kind !== "long" && w.kind !== "easy");
  for (let i = 0; i < quality.length && free.length; i++) {
    const at = Math.floor((free.length - 1) * (quality.length === 1 ? 0.5 : i / (quality.length - 1)));
    quality[i].day = take(free[at]);
  }

  for (const w of workouts) {
    if (w.day === null && free.length) w.day = take(free[0]);
  }
}
