import type { IntensityWeek } from "@/lib/metrics";
import { clock } from "@/lib/format";

const BAR = 14;
const GAP = 6;
const LEFT = 30;
const TOP = 10;
const PLOT_H = 128;
const AXIS_H = 26;

/** 低い強度から順に積む。色は既存の心拍スケールの両端と中間をそのまま使う */
const BANDS = [
  { key: "easy", label: "easy", color: "var(--teal)" },
  { key: "moderate", label: "moderate", color: "var(--amber)" },
  { key: "hard", label: "hard", color: "var(--magenta)" },
] as const;

export default function IntensityStrip({ weeks }: { weeks: IntensityWeek[] }) {
  const width = LEFT + weeks.length * (BAR + GAP) + 8;
  const height = TOP + PLOT_H + AXIS_H;
  const peak = Math.max(3600, ...weeks.map((w) => w.total));
  const scale = (v: number) => (v / peak) * PLOT_H;
  const baseline = TOP + PLOT_H;

  // 目盛りは 1 時間刻み。ピークが高い週があるときだけ間引く
  const stepH = peak > 6 * 3600 ? 2 : 1;
  const ticks: number[] = [];
  for (let h = stepH; h * 3600 <= peak; h += stepH) ticks.push(h);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="直近26週の強度別の時間">
      {ticks.map((h) => (
        <g key={h}>
          <line
            x1={LEFT - 4}
            x2={width - 4}
            y1={baseline - scale(h * 3600)}
            y2={baseline - scale(h * 3600)}
            stroke="var(--grid)"
            strokeWidth="1"
          />
          <text
            x={LEFT - 8}
            y={baseline - scale(h * 3600) + 3.5}
            textAnchor="end"
            fontFamily="var(--mono)"
            fontSize="9"
            fill="var(--faint)"
          >
            {h}
          </text>
        </g>
      ))}

      {weeks.map((w, i) => {
        const x = LEFT + i * (BAR + GAP);
        const first = w.start.getDate() <= 7;
        const label = `${w.start.getMonth() + 1}/${w.start.getDate()}の週`;

        // 積み上げは下から。高さ 0 の帯は rect を出さない
        let y = baseline;
        const bars = BANDS.map((b) => {
          const sec = w[b.key];
          if (sec <= 0) return null;
          const h = Math.max(1, scale(sec));
          y -= h;
          return { ...b, y, h, sec };
        }).filter((v) => v !== null);

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

            {bars.length ? (
              bars.map((b) => (
                <rect
                  key={b.key}
                  x={x}
                  y={b.y}
                  width={BAR}
                  height={b.h}
                  fill={b.color}
                  opacity={w.isCurrent ? 1 : 0.88}
                >
                  <title>{`${label} — ${b.label} ${clock(b.sec)}（合計 ${clock(w.total)}）`}</title>
                </rect>
              ))
            ) : (
              // 走っていない週と、走ったが FIT が無い週を同じ見た目にしない理由はない。
              // どちらも「配分が分からない週」なので 1 本の細い線で表す
              <rect x={x} y={baseline - 2} width={BAR} height={2} fill="#cfd8da">
                <title>{`${label} — 記録なし`}</title>
              </rect>
            )}

            {w.isCurrent && (
              <line
                x1={x - 2}
                x2={x + BAR + 2}
                y1={baseline + 4}
                y2={baseline + 4}
                stroke="var(--ink)"
                strokeWidth="1.5"
              />
            )}
          </g>
        );
      })}

      <line
        x1={LEFT - 4}
        x2={width - 4}
        y1={baseline}
        y2={baseline}
        stroke="var(--rule)"
        strokeWidth="1"
      />
      <text
        x={LEFT - 8}
        y={baseline + 3.5}
        textAnchor="end"
        fontFamily="var(--mono)"
        fontSize="9"
        fill="var(--faint)"
      >
        h
      </text>
    </svg>
  );
}
