import PaceScatter from "@/components/PaceScatter";
import RefreshButton from "@/components/RefreshButton";
import YearStrip from "@/components/YearStrip";
import {
  clock,
  dateWithWeekday,
  effort,
  effortColor,
  hours,
  km,
  pace,
  signed,
  timeOfDay,
} from "@/lib/format";
import { addDays, buildOverview, startOfDay, wallClockNow } from "@/lib/metrics";
import { fetchRuns, sheetCsvUrl } from "@/lib/sheet";

export const revalidate = 600;

export default async function Page() {
  let data: Awaited<ReturnType<typeof fetchRuns>>;
  try {
    data = await fetchRuns();
  } catch (err) {
    return <Setup message={err instanceof Error ? err.message : String(err)} />;
  }

  const now = wallClockNow();
  const o = buildOverview(data.runs, now);

  if (!o.runs.length) {
    return <Setup message="シートは読めましたが、ランニングの行が見つかりませんでした。SHEET_GID が「Running」タブのものか確認してください。" />;
  }

  const weekPct = Math.min(100, (o.week.km / o.week.target) * 100);
  const deltaKm = o.last7.km - o.prev7.km;
  const recent = [...o.runs].reverse();
  const scatterFrom = addDays(startOfDay(now), -180);
  const scatterRuns = o.runs.filter((r) => r.start >= scatterFrom);
  const monthPeak = Math.max(...o.months.map((m) => m.km), 1);

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
      </p>
    </>
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
