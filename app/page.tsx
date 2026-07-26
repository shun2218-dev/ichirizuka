import ConditionChart from "@/components/ConditionChart";
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
import type { Condition, DailyMetricSummary } from "@/lib/metrics";
import { addDays, buildCondition, buildOverview, startOfDay, wallClockNow } from "@/lib/metrics";
import type { DailyResult } from "@/lib/sheet";
import { dailyCsvUrl, fetchDaily, fetchRuns, sheetCsvUrl } from "@/lib/sheet";

export const revalidate = 600;

/** コンディションのグラフに出す週数。52 週だと 1 本ずつが細くて折れ線が読めない */
const CONDITION_WEEKS = 26;

export default async function Page() {
  // fetchDaily は投げない契約なので、Running の失敗で早期 return しても未処理の拒否は出ない
  const dailyPromise = fetchDaily();

  let data: Awaited<ReturnType<typeof fetchRuns>>;
  try {
    data = await fetchRuns();
  } catch (err) {
    return <Setup message={err instanceof Error ? err.message : String(err)} />;
  }

  const now = wallClockNow();
  const o = buildOverview(data.runs, now);
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
