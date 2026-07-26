import type { Run } from "@/lib/sheet";
import { dateWithWeekday, effort, effortColor, km, pace } from "@/lib/format";

const W = 660;
const H = 300;
const PAD = { top: 14, right: 12, bottom: 34, left: 44 };

export default function PaceScatter({ runs }: { runs: Run[] }) {
  if (runs.length < 2) {
    return <p className="section-note">散布図を描くにはデータが足りません。</p>;
  }

  const maxDist = Math.ceil(Math.max(...runs.map((r) => r.distance)) / 5) * 5;
  const paces = runs.map((r) => r.pace);
  const fastest = Math.floor(Math.min(...paces) / 30) * 30 - 15;
  const slowest = Math.ceil(Math.max(...paces) / 30) * 30 + 15;

  const x = (d: number) => PAD.left + (d / maxDist) * (W - PAD.left - PAD.right);
  const y = (p: number) =>
    PAD.top + ((p - fastest) / (slowest - fastest)) * (H - PAD.top - PAD.bottom);

  const paceTicks: number[] = [];
  for (let p = Math.ceil(fastest / 30) * 30; p <= slowest; p += 30) paceTicks.push(p);
  const distTicks: number[] = [];
  const distStep = maxDist > 25 ? 10 : 5;
  for (let d = 0; d <= maxDist; d += distStep) distTicks.push(d);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="距離と平均ペースの分布">
      {paceTicks.map((p) => (
        <g key={p}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} stroke="var(--grid)" />
          <text
            x={PAD.left - 8}
            y={y(p) + 3.5}
            textAnchor="end"
            fontFamily="var(--mono)"
            fontSize="9.5"
            fill="var(--faint)"
          >
            {pace(p)}
          </text>
        </g>
      ))}

      {distTicks.map((d) => (
        <text
          key={d}
          x={x(d)}
          y={H - 14}
          textAnchor="middle"
          fontFamily="var(--mono)"
          fontSize="9.5"
          fill="var(--faint)"
        >
          {d}
        </text>
      ))}
      <text
        x={W - PAD.right}
        y={H - 2}
        textAnchor="end"
        fontFamily="var(--mono)"
        fontSize="9.5"
        fill="var(--faint)"
      >
        km
      </text>

      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={H - PAD.bottom}
        y2={H - PAD.bottom}
        stroke="var(--rule)"
      />

      {runs.map((r) => (
        <circle
          key={r.start.toISOString() + r.distance}
          cx={x(r.distance)}
          cy={y(r.pace)}
          r={3.6}
          fill={effortColor(effort(r.hr))}
          fillOpacity={0.72}
          stroke="var(--card)"
          strokeWidth="0.8"
        >
          <title>{`${dateWithWeekday(r.start)} — ${km(r.distance, 2)}km / ${pace(r.pace)}${r.hr ? ` / ${r.hr}bpm` : ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}
