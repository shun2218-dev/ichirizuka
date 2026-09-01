/**
 * 今週のメニューを外から取れるようにする口。
 *
 * ダッシュボードを**開かないと出てこない**状態だと、週の頭に何を走るかが手元に
 * 来ない。生成そのものはアプリの中にしか無いので（VDOT もペースも lib/）、
 * 週 1 回ここを叩いて自分に配る形にする。配る側は apps-script/weekly-plan.gs。
 *
 * 内容は画面と同じ `planForWeek`。週の途中に叩いても同じものが返る。
 */

import { NextResponse } from "next/server";

import { KIND_LABELS, PHASE_LABELS, km, pace, shortDate, weekday } from "@/lib/format";
import { dayKey, resolveTargetKm, startOfWeek, wallClockNow } from "@/lib/metrics";
import { fetchDaily, fetchRuns, fetchSettings } from "@/lib/sheet";
import type { WeekPlan } from "@/lib/weekPlan";
import { planForWeek } from "@/lib/weekPlan";

// ビルド時に 1 回だけ評価されて固まらないようにする。シートの取得自体は
// lib/sheet.ts 側でタグ付きキャッシュに載るので、毎回取りに行くわけではない。
export const dynamic = "force-dynamic";

export async function GET() {
  // fetchDaily / fetchSettings は投げない契約
  const dailyPromise = fetchDaily();
  const settingsPromise = fetchSettings();

  let runs;
  try {
    ({ runs } = await fetchRuns());
  } catch (err) {
    // 取れなかったことを 200 で返すと、配る側が気づけない
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const now = wallClockNow();
  const settings = (await settingsPromise).settings;
  const days = (await dailyPromise).days;

  const weekPlan = planForWeek({
    runs,
    days,
    settings,
    targetKm: resolveTargetKm(settings.weeklyTargetKm),
    now,
  });

  const weekStart = weekPlan?.weekStart ?? startOfWeek(now);

  return NextResponse.json({
    ok: true,
    weekStart: dayKey(weekStart),
    weekLabel: `${shortDate(weekStart)} の週`,
    nextAt: weekPlan ? dayKey(weekPlan.nextAt) : null,
    plan: weekPlan?.plan ?? null,
    text: weekPlan
      ? planText(weekPlan)
      : "直近180日に3km以上のランが無いので、今週のメニューは出せません。\n" +
        "実力の推定ができないままペースを出しても目安になりません。",
  });
}

/**
 * メール本文。等幅で読まれるとは限らないので桁を揃えず、1 本を 2 行に分ける
 * （スマホで折り返されても読めるほうを取る）。
 */
function planText({ plan, weekStart, nextAt }: WeekPlan): string {
  const lines: string[] = [];

  lines.push(`${PHASE_LABELS[plan.phase]}`);
  if (plan.weeksToRace !== null) lines.push(`レースまで${plan.weeksToRace}週`);
  lines.push(`合計 ${km(plan.totalKm)}km・${plan.workouts.length}本`);
  lines.push("");

  for (const w of plan.workouts) {
    const range = w.paceSecSlow ? `${pace(w.paceSec)}〜${pace(w.paceSecSlow)}` : pace(w.paceSec);
    lines.push(`${weekday(w.day)} ${KIND_LABELS[w.kind]} ${km(w.km)}km ${range}/km`);
    lines.push(`   ${w.note}`);
  }

  if (plan.notes.length) {
    lines.push("");
    lines.push("調整の理由");
    for (const n of plan.notes) lines.push(`- ${n}`);
  }

  lines.push("");
  lines.push(
    `この内容は ${shortDate(weekStart)}（月）時点の記録で確定したもので、週の途中では変わらない。` +
      `次に組み直すのは ${shortDate(nextAt)}（月）。`,
  );
  lines.push("提案であって処方ではないので、天候と予定に合わせて動かしてよい。");

  return lines.join("\n");
}
