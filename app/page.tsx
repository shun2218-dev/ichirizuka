import ConditionChart from "@/components/ConditionChart";
import IntensityStrip from "@/components/IntensityStrip";
import PaceScatter from "@/components/PaceScatter";
import RefreshButton from "@/components/RefreshButton";
import YearStrip from "@/components/YearStrip";
import {
  clock,
  dateWithWeekday,
  decimal,
  effort,
  effortColor,
  hours,
  km,
  pace,
  shortDate,
  signed,
  timeOfDay,
} from "@/lib/format";
import type { Condition, DailyMetricSummary, IntensitySplit } from "@/lib/metrics";
import type { DailyMetricKey } from "@/lib/sheet";
import {
  addDays,
  buildCondition,
  buildOverview,
  fitCoverage,
  intensitySplit,
  intensityWeeks,
  startOfDay,
  wallClockNow,
} from "@/lib/metrics";
import type { DailyResult, FitResult, Settings } from "@/lib/sheet";
import {
  dailyCsvUrl,
  fetchDaily,
  fetchFit,
  fetchRuns,
  fetchSettings,
  sheetCsvUrl,
} from "@/lib/sheet";
import type { Phase, WeeklyPlan, WorkoutKind } from "@/lib/plan";
import { buildWeeklyPlan } from "@/lib/plan";
import type { MarathonOutlook, VdotEstimate } from "@/lib/vdot";
import {
  MARATHON_LONG_RUN_KM,
  MARATHON_WEEKLY_KM,
  estimateVdot,
  goalGap,
  marathonOutlook,
  raceEquivalents,
  trainingPaces,
} from "@/lib/vdot";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const PHASE_LABELS: Record<Phase, string> = {
  maintain: "積み上げ（レース日は未定）",
  base: "基礎づくり",
  build: "強化",
  peak: "仕上げ",
  taper: "調整（テーパー）",
};

const KIND_LABELS: Record<WorkoutKind, string> = {
  easy: "イージー",
  long: "ロング",
  threshold: "閾値（T）",
  interval: "インターバル（I）",
  marathon: "マラソンペース（M）",
};

export const revalidate = 600;

/** コンディションのグラフに出す週数。52 週だと 1 本ずつが細くて折れ線が読めない */
const CONDITION_WEEKS = 26;

/** 強度の配分を集計する期間。短すぎると 1 本の練習で数字が跳ねる */
const INTENSITY_DAYS = 84;

export default async function Page() {
  // fetchDaily / fetchFit は投げない契約なので、Running の失敗で早期 return しても
  // 未処理の拒否は出ない
  const dailyPromise = fetchDaily();
  const fitPromise = fetchFit();
  const settingsPromise = fetchSettings();

  let data: Awaited<ReturnType<typeof fetchRuns>>;
  try {
    data = await fetchRuns();
  } catch (err) {
    return <Setup message={err instanceof Error ? err.message : String(err)} />;
  }

  const now = wallClockNow();
  const settings = (await settingsPromise).settings;
  const o = buildOverview(data.runs, now, settings.weeklyTargetKm);
  const daily = await dailyPromise;

  if (!o.runs.length) {
    return <Setup message="シートは読めましたが、ランニングの行が見つかりませんでした。SHEET_GID が「Running」タブのものか確認してください。" />;
  }

  const weekPct = Math.min(100, (o.week.km / o.week.target) * 100);
  const deltaKm = o.last7.km - o.prev7.km;
  const recent = [...o.runs].reverse();
  const scatterFrom = addDays(startOfDay(now), -180);
  const scatterRuns = o.runs.filter((r) => r.start >= scatterFrom);
  const monthPeak = Math.max(...o.months.map((m) => m.km), 1);
  const condition = daily.days.length ? buildCondition(daily.days, o.weeks, now) : null;

  // 実力の推定は直近 180 日から。古い記録を混ぜると「今の実力」ではなくなる
  const vdotFrom = addDays(startOfDay(now), -180);
  const vdot = estimateVdot(o.runs, vdotFrom);
  const longestRecentKm = Math.max(
    0,
    ...o.runs.filter((r) => r.start >= vdotFrom).map((r) => r.distance),
  );
  const outlook = vdot ? marathonOutlook(vdot.vdot, o.last28.km / 4, longestRecentKm) : null;

  // レース日は未定でよいので、あるときだけ残り週数を出す
  const weeksToRace = settings.raceDate
    ? Math.floor((+settings.raceDate - +startOfDay(now)) / (86400000 * 7))
    : null;

  /**
   * 疲労のサイン。安静時心拍が上がっている / HRV が下がっているとき。
   *
   * しきい値（1.5bpm / 3ms）は前週比の測定ノイズを越える程度という目安で、
   * 根拠のある定数ではない。**質練習を減らす方向にしか使わない**ので、
   * 外しても危険側には倒れない。
   */
  const deltaOf = (key: DailyMetricKey) =>
    condition?.metrics.find((m) => m.key === key)?.delta ?? null;
  const restingDelta = deltaOf("restingHr");
  const hrvDelta = deltaOf("hrv");
  const fatigued =
    (restingDelta !== null && restingDelta > 1.5) || (hrvDelta !== null && hrvDelta < -3);

  const plan =
    vdot && outlook
      ? buildWeeklyPlan({
          paces: trainingPaces(vdot.vdot),
          chronicKm: o.last28.km / 4,
          longestRecentKm,
          load: o.load,
          trainingDays: settings.trainingDays,
          targetKm: o.targetKm,
          weeksToRace,
          fatigued,
        })
      : null;

  const fit = await fitPromise;
  const intensityFrom = addDays(startOfDay(now), -INTENSITY_DAYS);
  const intensity = intensitySplit(fit.runs.filter((r) => r.start >= intensityFrom));
  const coverage = fitCoverage(o.runs, fit.runs, intensityFrom);

  return (
    <>
      <header className="masthead">
        <Wordmark />
        <div className="masthead-meta">
          <span>
            {data.fetchedAt.toLocaleString("ja-JP", {
              timeZone: process.env.APP_TIMEZONE ?? "Asia/Tokyo",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            時点
          </span>
          <RefreshButton />
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">
            今週（{o.week.start.getMonth() + 1}/{o.week.start.getDate()} 月曜起点）
          </p>
          <div className="hero-figure">
            <span className="value">{km(o.week.km)}</span>
            <span className="unit">km</span>
          </div>
          <p className="hero-caption">
            {o.week.runs}本・走行 {hours(o.week.sec)}・平均 <strong>{pace(o.week.pace)}/km</strong>
            {o.week.hr ? <> ・平均心拍 {o.week.hr}bpm</> : null}
            <br />
            {o.restDays === 0
              ? "今日走っています。"
              : o.restDays === null
                ? null
                : `最後に走ったのは${o.restDays}日前（${dateWithWeekday(o.last!.start)}・${km(o.last!.distance, 2)}km）。`}
          </p>

          <div className="target">
            <div className="target-bar">
              <div className="target-fill" style={{ width: `${weekPct}%` }} />
            </div>
            <div className="target-legend">
              <span>目標 {o.week.target}km に対して {Math.round(weekPct)}%</span>
              <span>
                残り {km(Math.max(0, o.week.target - o.week.km))}km
              </span>
            </div>
          </div>
        </div>

        <dl className="hero-side">
          <div className="stat">
            <dt>直近7日</dt>
            <dd>
              {km(o.last7.km)}
              <small>km</small>{" "}
              <small className={deltaKm >= 0 ? "delta-up" : "delta-down"}>
                {signed(deltaKm)}
              </small>
            </dd>
          </div>
          <div className="stat">
            <dt>直近28日</dt>
            <dd>
              {km(o.last28.km)}
              <small>km</small>
            </dd>
          </div>
          <div className="stat">
            <dt>{now.getFullYear()}年</dt>
            <dd>
              {km(o.thisYear.km, 0)}
              <small>km / {o.thisYear.runs}本</small>
            </dd>
          </div>
          <div className="stat">
            <dt>累計</dt>
            <dd>
              {km(o.total.km, 0)}
              <small>km / {o.total.runs}本</small>
            </dd>
          </div>
        </dl>
      </section>

      <section className="strip">
        <p className="eyebrow">直近52週 — 棒の高さが距離、色が平均心拍</p>
        <div className="strip-frame">
          <YearStrip weeks={o.weeks} targetKm={o.week.target} />
        </div>
        <div className="legend">
          <span>
            <span className="legend-ramp" /> 145bpm → 180bpm
          </span>
          <span>破線 = 週の目標 {o.week.target}km</span>
          <span>{o.streak}週連続で記録あり</span>
        </div>
      </section>

      <section className="section">
        <h2>今の負荷</h2>
        <p className="section-note">
          直近7日の距離を、直近28日の週平均で割った値。急に増やしすぎていないかの目安として使われます。
        </p>
        <div className="load">
          <div>
            <div className="load-value">{o.load === null ? "—" : o.load.toFixed(2)}</div>
            <p className="eyebrow">{loadLabel(o.load)}</p>
          </div>
          <div>
            <div className="load-scale">
              <div
                className="load-marker"
                style={{ left: `${Math.min(100, Math.max(0, ((o.load ?? 0) / 2) * 100))}%` }}
              />
            </div>
            <div className="load-ticks">
              <span>0.0</span>
              <span>0.8</span>
              <span>1.3</span>
              <span>1.5</span>
              <span>2.0</span>
            </div>
            <p className="section-note" style={{ margin: "12px 0 0" }}>
              直近7日 {km(o.last7.km)}km ／ 直近28日の週平均 {km(o.last28.km / 4)}km
            </p>
          </div>
        </div>
      </section>

      <VdotSection
        estimate={vdot}
        outlook={outlook}
        settings={settings}
        weeksToRace={weeksToRace}
      />

      <PlanSection plan={plan} />

      <IntensitySection
        fit={fit}
        split={intensity}
        weeks={intensityWeeks(fit.runs, now, CONDITION_WEEKS)}
        coverage={coverage}
      />

      <ConditionSection daily={daily} condition={condition} />

      <section className="section">
        <h2>距離とペースの関係</h2>
        <p className="section-note">直近180日の{scatterRuns.length}本。上にあるほど速い。</p>
        <div className="plot">
          <PaceScatter runs={scatterRuns} />
        </div>
      </section>

      <section className="section">
        <h2>距離帯ごとのベスト</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>距離帯</th>
                <th>最速ペース</th>
                <th>距離</th>
                <th>タイム</th>
                <th>心拍</th>
                <th>日付</th>
                <th>本数</th>
              </tr>
            </thead>
            <tbody>
              {o.bests.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className="mono">{b.run ? `${pace(b.run.pace)}/km` : "—"}</td>
                  <td className="mono">{b.run ? `${km(b.run.distance, 2)}` : "—"}</td>
                  <td className="mono">{b.run ? clock(b.run.movingSec) : "—"}</td>
                  <td className="mono">{b.run?.hr ?? "—"}</td>
                  <td className="mono">
                    {b.run
                      ? `${b.run.start.getFullYear()}/${b.run.start.getMonth() + 1}/${b.run.start.getDate()}`
                      : "—"}
                  </td>
                  <td className="mono">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>月別</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>月</th>
                <th>距離</th>
                <th></th>
                <th>本数</th>
                <th>時間</th>
                <th>平均ペース</th>
                <th>最長</th>
                <th>平均心拍</th>
              </tr>
            </thead>
            <tbody>
              {[...o.months].reverse().map((m) => (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  <td className="mono">{m.km ? km(m.km) : "—"}</td>
                  <td className="bar-cell">
                    <span style={{ width: `${(m.km / monthPeak) * 100}%` }} />
                  </td>
                  <td className="mono">{m.runs || "—"}</td>
                  <td className="mono">{m.sec ? hours(m.sec) : "—"}</td>
                  <td className="mono">{m.pace ? pace(m.pace) : "—"}</td>
                  <td className="mono">{m.longest ? km(m.longest, 1) : "—"}</td>
                  <td className="mono">{m.hr ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>1本ずつの記録</h2>
        <div className="table-wrap">
          <RunTable runs={recent.slice(0, 15)} />
          {recent.length > 15 && (
            <details className="more">
              <summary>残り{recent.length - 15}本を表示</summary>
              <RunTable runs={recent.slice(15)} />
            </details>
          )}
        </div>
      </section>

      <p className="footnote">
        {o.skipped > 0 && <>0.4km 未満の{o.skipped}本は誤操作とみなして集計から外しています。</>} データ元は
        Google スプレッドシート。10分ごと、または「シートを読み直す」で読み直します。
        {!daily.configured && (
          <>
            {" "}
            <code>SHEET_DAILY_GID</code> を設定すると、安静時心拍数・HRV・体重・VO2max・歩数も
            同じシートの Daily タブから読み込みます。
          </>
        )}
      </p>
    </>
  );
}

function VdotSection({
  estimate,
  outlook,
  settings,
  weeksToRace,
}: {
  estimate: VdotEstimate | null;
  outlook: MarathonOutlook | null;
  settings: Settings;
  weeksToRace: number | null;
}) {
  if (!estimate || !outlook) return null;

  const gap = settings.goalMarathonSec ? goalGap(estimate.vdot, settings.goalMarathonSec) : null;
  const p = trainingPaces(estimate.vdot);
  const rows: { label: string; pace: string; note: string }[] = [
    { label: "E — イージー", pace: `${pace(p.easyFast)}〜${pace(p.easySlow)}`, note: "土台。走行距離の大半をここに置く" },
    { label: "M — マラソン", pace: pace(p.marathon), note: "本番のペース感覚" },
    { label: "T — 閾値", pace: pace(p.threshold), note: "20分走やクルーズインターバル" },
    { label: "I — インターバル", pace: pace(p.interval), note: "3〜5分 × 数本" },
    { label: "R — レペティション", pace: pace(p.repetition), note: "短く速く。式の外挿なので目安" },
  ];

  return (
    <section className="section">
      <h2>今の実力</h2>
      <p className="section-note">
        いちばん速く走れた 1 本から VDOT を出し、そこから他の距離のタイムと練習ペースを導いたもの。
      </p>

      <div className="vdot">
        <div>
          <p className="eyebrow">VDOT</p>
          <div className="load-value">{decimal(estimate.vdot, 1)}</div>
          <p className="stat-sub">
            {shortDate(estimate.run.start)}の{km(estimate.run.distance)}km（{clock(estimate.run.movingSec)}
            ・{pace(estimate.run.pace)}/km）から
          </p>
        </div>

        <div>
          <p className="eyebrow">フルマラソンの予測</p>
          <div className="vdot-range">
            {clock(outlook.optimistic)}
            <span> 〜 </span>
            {clock(outlook.realistic)}
          </div>
          <p className="stat-sub">
            {outlook.ready
              ? `週${km(outlook.weeklyKm)}km・最長${km(outlook.longestKm)}km 走っている。VDOT どおりに走れる想定。`
              : `週${km(outlook.weeklyKm)}km・最長${km(outlook.longestKm)}km。目安の週${MARATHON_WEEKLY_KM}km・${MARATHON_LONG_RUN_KM}km 走に届いていないので、速いほうの数字は出ない前提で見る。`}
          </p>
        </div>
      </div>

      {gap && (
        <div className="goal">
          <div>
            <p className="eyebrow">目標</p>
            <div className="goal-value">{clock(gap.goalSec)}</div>
          </div>
          <div>
            <p className="eyebrow">目標までの差</p>
            <p className="goal-note">
              必要な VDOT は <strong>{decimal(gap.goalVdot, 1)}</strong>。
              {gap.vdotGap > 0 ? (
                <>
                  {" "}
                  今より <strong>{decimal(gap.vdotGap, 1)}</strong> 足りない（予測とは{" "}
                  {clock(Math.abs(gap.secGap))} の差）。
                </>
              ) : (
                <> 今の実力で届いている（予測より {clock(Math.abs(gap.secGap))} 速い目標）。</>
              )}
              {weeksToRace !== null &&
                (weeksToRace >= 0
                  ? ` レースまで${weeksToRace}週。`
                  : " レース日は過ぎている。")}
              {weeksToRace === null && " レース日は未定。"}
            </p>
            {settings.trainingDays.length > 0 && (
              <p className="stat-sub">
                走れる曜日: {settings.trainingDays.map((d) => WEEKDAY_LABELS[d]).join("・")}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>距離</th>
              {raceEquivalents(estimate.vdot).map((r) => (
                <th key={r.label} className="num">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>等価タイム</td>
              {raceEquivalents(estimate.vdot).map((r) => (
                <td key={r.label} className="num mono">
                  {clock(r.sec)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>練習ペース</th>
              <th className="num">分/km</th>
              <th className="text">使いどころ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num mono">{r.pace}</td>
                <td className="text">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="footnote">
        根拠にしたのはレースではなく普段の練習なので、全力で走った 1 本が無ければ実力より低く出る。
        つまりこの値は下限とみて、上振れより下振れを疑うほうが正しい。
        短い距離からマラソンを外挿すると速すぎる予測が出るが、原因は心肺能力ではなく走り込み量。
      </p>
    </section>
  );
}

function PlanSection({ plan }: { plan: WeeklyPlan | null }) {
  if (!plan || !plan.workouts.length) return null;

  return (
    <section className="section">
      <h2>今週のメニュー</h2>
      <p className="section-note">
        今の実力から出したペースを、走れる量に合わせて割ったもの。提案であって処方ではないので、
        体調と予定に合わせて動かしてよい。
      </p>

      <div className="plan-head">
        <div>
          <p className="eyebrow">時期</p>
          <div className="plan-phase">{PHASE_LABELS[plan.phase]}</div>
          {plan.weeksToRace !== null && (
            <p className="stat-sub">レースまで{plan.weeksToRace}週</p>
          )}
        </div>
        <div>
          <p className="eyebrow">週の合計</p>
          <div className="plan-phase mono">{km(plan.totalKm)}km</div>
          <p className="stat-sub">{plan.workouts.length}本</p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>曜日</th>
              <th className="text">練習</th>
              <th className="num">距離</th>
              <th className="num">ペース</th>
              <th className="text">やりかた</th>
            </tr>
          </thead>
          <tbody>
            {plan.workouts.map((w, i) => (
              <tr key={i}>
                <td>{w.day === null ? "—" : WEEKDAY_LABELS[w.day]}</td>
                <td className="text">{KIND_LABELS[w.kind]}</td>
                <td className="num mono">{km(w.km)}km</td>
                <td className="num mono">
                  {pace(w.paceSec)}
                  {w.paceSecSlow ? `〜${pace(w.paceSecSlow)}` : ""}
                </td>
                <td className="text">{w.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.notes.length > 0 && (
        <ul className="plan-notes">
          {plan.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <p className="footnote">
        質練習の量は週の走行距離に対する割合で決めている（閾値 10% / インターバル 8%）。
        回数ではなく量で縛るのは、走れる日数が少なくても 8 割を楽に走る配分が崩れないため。
        曜日が「—」の行は、走れる曜日を Settings タブに書くと埋まる。
      </p>
    </section>
  );
}

/** 強度の 3 分割。低いほうから並べる */
const INTENSITY_BANDS = [
  { key: "easy", label: "easy", note: "80%未満", color: "var(--teal)" },
  { key: "moderate", label: "moderate", note: "80–90%", color: "var(--amber)" },
  { key: "hard", label: "hard", note: "90%以上", color: "var(--magenta)" },
] as const;

function IntensitySection({
  fit,
  split,
  weeks,
  coverage,
}: {
  fit: FitResult;
  split: IntensitySplit;
  weeks: ReturnType<typeof intensityWeeks>;
  coverage: { withFit: number; total: number };
}) {
  if (!fit.configured) return null;

  const pct = (sec: number) => (split.total > 0 ? (sec / split.total) * 100 : 0);

  return (
    <section className="section">
      <h2>強度の配分</h2>
      <p className="section-note">
        心拍ゾーンの滞在時間を、最大心拍に対する割合で 3 つに分けたもの。楽な走りを 8 割、
        強い走りを 2 割にすると伸びやすいとされる。直近{INTENSITY_DAYS}日。
      </p>

      {fit.error ? (
        <div className="notice">
          <p>Fit タブを読み込めませんでした（{fit.error}）。</p>
        </div>
      ) : split.total === 0 ? (
        <div className="notice">
          <p>
            Fit タブは読めましたが、直近{INTENSITY_DAYS}日にゾーンの記録がありません。
            <code>node scripts/import-fit.mjs &lt;dir&gt; --post</code> を実行したか確認してください。
            手順は <code>docs/fit-import-setup.md</code> にあります。
          </p>
        </div>
      ) : (
        <>
          <dl className="intensity-grid">
            {INTENSITY_BANDS.map((b) => (
              <div className="intensity-tile" key={b.key}>
                <dt>
                  <span className="chip" style={{ background: b.color }} /> {b.label}
                  <small>{b.note}</small>
                </dt>
                <dd>
                  {decimal(pct(split[b.key]), 0)}
                  <small>%</small>
                </dd>
                <p className="stat-sub">{clock(split[b.key])}</p>
              </div>
            ))}
          </dl>

          <div className="intensity-track">
            {INTENSITY_BANDS.map((b) => (
              <div
                key={b.key}
                className="intensity-fill"
                style={{ width: `${pct(split[b.key])}%`, background: b.color }}
              />
            ))}
            <div className="intensity-mark" style={{ left: "80%" }} />
          </div>
          <div className="legend">
            <span>縦線 = easy 80% の目安</span>
          </div>

          <div className="plot">
            <IntensityStrip weeks={weeks} />
          </div>
          <div className="legend">
            <span>棒の高さ = その週の合計時間、色が強度</span>
            <span>直近{CONDITION_WEEKS}週</span>
          </div>

          <p className="footnote">
            直近{INTENSITY_DAYS}日の{coverage.total}本のうち{coverage.withFit}本に FIT
            の記録がある。
            {coverage.withFit < coverage.total &&
              "残りは取り込み前のランなので、この配分には入っていない。"}
            ゾーンの境界は最大心拍の設定値から決まるが、これは年齢式による推定なので、
            境界そのものにずれがありうる。
          </p>
        </>
      )}
    </section>
  );
}

function ConditionSection({
  daily,
  condition,
}: {
  daily: DailyResult;
  condition: Condition | null;
}) {
  if (!daily.configured) return null;


  const missing = condition?.metrics.filter((m) => m.latest === null) ?? [];
  const rows = condition ? [...condition.days].reverse() : [];

  return (
    <section className="section condition">
      <h2>コンディション</h2>
      <p className="section-note">
        毎朝ショートカットが Daily タブに書き込んでいる数値。走行量と並べて見る。
      </p>

      {daily.error ? (
        <div className="notice">
          <p>Daily タブを読み込めませんでした（{daily.error}）。</p>
          <p>
            <code>{dailyCsvUrl()}</code>
          </p>
        </div>
      ) : !condition ? (
        <div className="notice">
          <p>
            Daily タブは読めましたが、記録が 1 件もありません。<code>SHEET_DAILY_GID</code> が
            Daily タブのものか、ショートカットが動いているかを確認してください。手順は{" "}
            <code>docs/daily-metrics-setup.md</code> にあります。
          </p>
        </div>
      ) : (
        <>
          <dl className="condition-grid">
            {condition.available.map((m) => (
              <ConditionTile key={m.key} metric={m} />
            ))}
          </dl>

          <div className="plot">
            <ConditionChart weeks={condition.weeks.slice(-CONDITION_WEEKS)} />
          </div>
          <div className="legend">
            <span>線 = 週平均の安静時心拍数（下ほど低い）</span>
            <span>棒 = その週の走行距離</span>
            <span>直近{CONDITION_WEEKS}週</span>
          </div>

          <div className="table-wrap">
            <DailyTable days={rows.slice(0, 14)} metrics={condition.available} />
            {rows.length > 14 && (
              <details className="more">
                <summary>残り{rows.length - 14}日を表示</summary>
                <DailyTable days={rows.slice(14)} metrics={condition.available} />
              </details>
            )}
          </div>

          {missing.length > 0 && (
            <p className="footnote">
              シートに値が入っていない指標: {missing.map((m) => m.label).join(" / ")}
              。ショートカットが送っているキーを確認してください。
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ConditionTile({ metric }: { metric: DailyMetricSummary }) {
  if (!metric.latest) return null;

  return (
    <div className="stat">
      <dt>{metric.label}</dt>
      <dd>
        {decimal(metric.latest.value, metric.digits)}
        <small>{metric.unit}</small>
        <p className="stat-sub">
          {shortDate(metric.latest.date)} 時点
          {metric.last7 !== null && (
            <>
              <br />
              {/* 欠測が多い指標（VO2max など）は、平均が何日分かを添えないと誤読される */}
              {metric.covered < 7 ? `7日中${metric.covered}日の平均` : "7日平均"}{" "}
              {decimal(metric.last7, metric.avgDigits)}
              {metric.delta !== null && <> （前週比 {signed(metric.delta, metric.avgDigits)}）</>}
            </>
          )}
        </p>
      </dd>
    </div>
  );
}

function DailyTable({
  days,
  metrics,
}: {
  days: import("@/lib/sheet").Daily[];
  metrics: DailyMetricSummary[];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>日付</th>
          {metrics.map((m) => (
            <th key={m.key}>
              {m.label}
              <small className="th-unit">{m.unit}</small>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.date.toISOString()}>
            <td>
              {d.date.getFullYear()}/{dateWithWeekday(d.date)}
            </td>
            {metrics.map((m) => {
              const v = d[m.key];
              return (
                <td key={m.key} className="mono">
                  {v === null ? "—" : decimal(v, m.digits)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Wordmark() {
  return (
    <h1 className="wordmark">
      <span className="wordmark-ja">一里塚</span>
      <span className="wordmark-en">ichirizuka</span>
    </h1>
  );
}

function RunTable({ runs }: { runs: import("@/lib/sheet").Run[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>日付</th>
          <th>開始</th>
          <th>距離</th>
          <th>タイム</th>
          <th>ペース</th>
          <th>心拍</th>
          <th>獲得標高</th>
          <th>kcal</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.start.toISOString() + r.distance}>
            <td>
              <span className="chip" style={{ background: effortColor(effort(r.hr)) }} />
              {r.start.getFullYear()}/{dateWithWeekday(r.start)}
            </td>
            <td className="mono">{timeOfDay(r.start)}</td>
            <td className="mono">{km(r.distance, 2)}</td>
            <td className="mono">{clock(r.movingSec)}</td>
            <td className="mono">{pace(r.pace)}</td>
            <td className="mono">{r.hr ?? "—"}</td>
            <td className="mono">{r.elevation ? `${r.elevation}m` : "—"}</td>
            <td className="mono">{r.kcal || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function loadLabel(load: number | null): string {
  if (load === null) return "データ不足";
  if (load < 0.8) return "走行量が落ちている";
  if (load <= 1.3) return "積み上げやすいゾーン";
  if (load <= 1.5) return "増やしすぎ気味";
  return "急に増やしている";
}

function Setup({ message }: { message: string }) {
  let url = "";
  try {
    url = sheetCsvUrl();
  } catch {
    url = "（SHEET_ID 未設定）";
  }
  return (
    <>
      <header className="masthead">
        <Wordmark />
      </header>
      <div className="notice">
        <h2>シートを読み込めませんでした</h2>
        <p>{message}</p>
        <ol>
          <li>
            スプレッドシートの共有を「リンクを知っている全員」→ <strong>閲覧者</strong> に変更する
          </li>
          <li>
            <code>.env.local</code>（Vercel なら環境変数）に <code>SHEET_ID</code> と{" "}
            <code>SHEET_GID</code> を設定する
          </li>
          <li>ブラウザで下の URL を開き、CSV が返ってくるか確かめる</li>
        </ol>
        <p style={{ marginTop: 12 }}>
          <code>{url}</code>
        </p>
      </div>
    </>
  );
}
