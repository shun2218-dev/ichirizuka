import type { WeekBucket } from "@/lib/metrics";
import { effort, effortColor, km, pace } from "@/lib/format";

const BAR = 9;
const GAP = 4;
const LEFT = 30;
const TOP = 10;
const PLOT_H = 128;
const AXIS_H = 26;

export default function YearStrip({
  weeks,
  targetKm,
}: {
  weeks: WeekBucket[];
  targetKm: number;
}) {
  const width = LEFT + weeks.length * (BAR + GAP) + 8;
  const height = TOP + PLOT_H + AXIS_H;
  const peak = Math.max(targetKm * 1.2, ...weeks.map((w) => w.km));
  const scale = (v: number) => (v / peak) * PLOT_H;
  const baseline = TOP + PLOT_H;

  // 目盛りは 10km 刻みで、ラベルが混まない程度に間引く
  const step = peak > 90 ? 30 : peak > 45 ? 20 : 10;
  const ticks: number[] = [];
  for (let v = step; v <= peak; v += step) ticks.push(v);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="直近52週の週間距離">
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={LEFT - 4}
            x2={width - 4}
            y1={baseline - scale(v)}
            y2={baseline - scale(v)}
            stroke="var(--grid)"
            strokeWidth="1"
          />
          <text
            x={LEFT - 8}
            y={baseline - scale(v) + 3.5}
            textAnchor="end"
            fontFamily="var(--mono)"
            fontSize="9"
            fill="var(--faint)"
          >
            {v}
          </text>
        </g>
      ))}

      <line
        x1={LEFT - 4}
        x2={width - 4}
        y1={baseline - scale(targetKm)}
        y2={baseline - scale(targetKm)}
        stroke="var(--teal)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />

      {weeks.map((w, i) => {
        const x = LEFT + i * (BAR + GAP);
        const h = w.km > 0 ? Math.max(2, scale(w.km)) : 0;
        const first = w.start.getDate() <= 7;
        return (
          <g key={w.start.toISOString()}>
            {first && (
              <text
                x={x + BAR / 2}
                y={baseline + 15}
                textAnchor="middle"
                fontFamily="var(--mono)"
                fontSize="9"
                fill="var(--muted)"
              >
                {w.start.getMonth() + 1}
              </text>
            )}
            {h > 0 ? (
              <rect
                x={x}
                y={baseline - h}
                width={BAR}
                height={h}
                fill={effortColor(effort(w.hr))}
                opacity={w.isCurrent ? 1 : 0.88}
              >
                <title>{`${w.start.getMonth() + 1}/${w.start.getDate()}の週 — ${km(w.km)}km / ${w.runs}本 / 平均${pace(w.pace)}${w.hr ? ` / ${w.hr}bpm` : ""}`}</title>
              </rect>
            ) : (
              <rect x={x} y={baseline - 2} width={BAR} height={2} fill="#cfd8da">
                <title>{`${w.start.getMonth() + 1}/${w.start.getDate()}の週 — 記録なし`}</title>
              </rect>
            )}
            {w.isCurrent && (
              <>
                <line
                  x1={x - 2}
                  x2={x + BAR + 2}
                  y1={baseline + 4}
                  y2={baseline + 4}
                  stroke="var(--ink)"
                  strokeWidth="1.5"
                />
                <text
                  x={x + BAR / 2}
                  y={baseline - h - 6}
                  textAnchor="middle"
                  fontFamily="var(--mono)"
                  fontSize="9"
                  fill="var(--ink)"
                >
                  今週
                </text>
              </>
            )}
          </g>
        );
      })}

      <line x1={LEFT - 4} x2={width - 4} y1={baseline} y2={baseline} stroke="var(--rule)" strokeWidth="1" />
      <text
        x={LEFT - 8}
        y={baseline + 3.5}
        textAnchor="end"
        fontFamily="var(--mono)"
        fontSize="9"
        fill="var(--faint)"
      >
        km
      </text>
    </svg>
  );
}
