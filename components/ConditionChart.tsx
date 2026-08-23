import type { ConditionWeek } from "@/lib/metrics";
import { km } from "@/lib/format";

const W = 660;
const PAD = { top: 14, right: 12, bottom: 26, left: 40 };
const HR_H = 104;
const BAR_H = 66;
/** 上下のパネルの間隔 */
const SPLIT = 16;
const H = PAD.top + HR_H + SPLIT + BAR_H + PAD.bottom;

/**
 * 安静時心拍数と週間距離を上下に並べる。
 * 単位が違うものを 1 つの縦軸に重ねると読み間違えるので、軸は分ける。
 */
export default function ConditionChart({ weeks }: { weeks: ConditionWeek[] }) {
  const measured = weeks.filter((w) => w.restingHr !== null);
  if (measured.length < 2) {
    return (
      <p className="section-note" style={{ margin: 0 }}>
        週ごとの推移を描くには安静時心拍数の記録が足りません。
      </p>
    );
  }

  const hrs = measured.map((w) => w.restingHr as number);
  const lo = Math.floor(Math.min(...hrs) / 2) * 2 - 2;
  const hi = Math.ceil(Math.max(...hrs) / 2) * 2 + 2;
  const peakKm = Math.max(...weeks.map((w) => w.km), 1);

  const plotW = W - PAD.left - PAD.right;
  const slot = plotW / weeks.length;
  const cx = (i: number) => PAD.left + slot * (i + 0.5);
  const hrY = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * HR_H;
  const barBase = PAD.top + HR_H + SPLIT + BAR_H;
  const barW = Math.min(11, slot * 0.6);

  // 欠測週で線を繋ぐと「その週も測った」ように見えるので、区間に分けて描く
  const segments: { i: number; hr: number }[][] = [];
  weeks.forEach((w, i) => {
    if (w.restingHr === null) {
      if (segments.at(-1)?.length) segments.push([]);
      return;
    }
    if (!segments.length) segments.push([]);
    segments[segments.length - 1].push({ i, hr: w.restingHr });
  });

  const hrTicks = [lo, Math.round((lo + hi) / 2), hi];
  const kmStep = peakKm > 60 ? 30 : peakKm > 30 ? 20 : 10;

  const caption = (w: ConditionWeek) =>
    `${w.start.getMonth() + 1}/${w.start.getDate()}の週 — ${km(w.km)}km` +
    (w.restingHr === null ? " / 安静時心拍の記録なし" : ` / 安静時心拍 ${w.restingHr}bpm`) +
    (w.hrv === null ? "" : ` / HRV ${w.hrv}ms`);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="週ごとの安静時心拍数と走行距離">
      {hrTicks.map((v) => (
        <g key={`hr-${v}`}>
          <line x1={PAD.left} x2={W - PAD.right} y1={hrY(v)} y2={hrY(v)} stroke="var(--grid)" />
          <text
            x={PAD.left - 8}
            y={hrY(v) + 3.5}
            textAnchor="end"
            fontFamily="var(--mono)"
            fontSize="9.5"
            fill="var(--faint)"
          >
            {v}
          </text>
        </g>
      ))}
      <text
        x={PAD.left - 8}
        y={PAD.top - 4}
        textAnchor="end"
        fontFamily="var(--mono)"
        fontSize="9.5"
        fill="var(--faint)"
      >
        bpm
      </text>

      {segments
        .filter((s) => s.length > 0)
        .map((s) => (
          <g key={`seg-${s[0].i}`}>
            {s.length > 1 && (
              <polyline
                points={s.map((p) => `${cx(p.i)},${hrY(p.hr)}`).join(" ")}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="1.4"
              />
            )}
            {s.map((p) => (
              <circle
                key={p.i}
                cx={cx(p.i)}
                cy={hrY(p.hr)}
                r={2.6}
                fill="var(--ink)"
                stroke="var(--card)"
                strokeWidth="0.8"
              >
                <title>{caption(weeks[p.i])}</title>
              </circle>
            ))}
          </g>
        ))}

      {Array.from({ length: Math.floor(peakKm / kmStep) }, (_, k) => (k + 1) * kmStep).map((v) => (
        <g key={`km-${v}`}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={barBase - (v / peakKm) * BAR_H}
            y2={barBase - (v / peakKm) * BAR_H}
            stroke="var(--grid)"
          />
          <text
            x={PAD.left - 8}
            y={barBase - (v / peakKm) * BAR_H + 3.5}
            textAnchor="end"
            fontFamily="var(--mono)"
            fontSize="9.5"
            fill="var(--faint)"
          >
            {v}
          </text>
        </g>
      ))}
      <text
        x={PAD.left - 8}
        y={barBase + 3.5}
        textAnchor="end"
        fontFamily="var(--mono)"
        fontSize="9.5"
        fill="var(--faint)"
      >
        km
      </text>

      {weeks.map((w, i) => {
        const h = w.km > 0 ? Math.max(1.5, (w.km / peakKm) * BAR_H) : 0;
        return (
          <g key={w.start.toISOString()}>
            {h > 0 && (
              <rect
                x={cx(i) - barW / 2}
                y={barBase - h}
                width={barW}
                height={h}
                fill="var(--teal-fill)"
                fillOpacity={0.6}
              >
                <title>{caption(w)}</title>
              </rect>
            )}
            {w.start.getDate() <= 7 && (
              <text
                x={cx(i)}
                y={H - 10}
                textAnchor="middle"
                fontFamily="var(--mono)"
                fontSize="9.5"
                fill="var(--muted)"
              >
                {w.start.getMonth() + 1}
              </text>
            )}
          </g>
        );
      })}

      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={barBase}
        y2={barBase}
        stroke="var(--rule)"
      />
    </svg>
  );
}
