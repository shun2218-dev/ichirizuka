/** 秒/km → "5'19"" */
export function pace(secPerKm: number): string {
  if (!secPerKm || !Number.isFinite(secPerKm)) return "—";
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, "0")}"`;
}

/** 秒 → "44:44" / "1:12:03" */
export function clock(sec: number): string {
  if (!sec) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
}

/** 秒 → "12時間34分" */
export function hours(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}時間${m}分` : `${m}分`;
}

/** 桁を固定して 3 桁区切りにする。指標の値はすべてこれを通す */
export function decimal(v: number, digits = 0): string {
  return v.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function km(v: number, digits = 1): string {
  return decimal(v, digits);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function shortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function dateWithWeekday(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function timeOfDay(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function signed(v: number, digits = 1): string {
  const s = v.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return v > 0 ? `+${s}` : s;
}

/** 心拍数 → 0（楽）〜1（きつい）。色の割り当てに使う */
export function effort(hr: number | null): number {
  if (hr === null) return 0.35;
  const lo = 145;
  const hi = 180;
  return Math.min(1, Math.max(0, (hr - lo) / (hi - lo)));
}

/** effort 0..1 → 帯の色。teal → amber → magenta */
export function effortColor(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [31, 122, 120]],
    [0.5, [224, 167, 59]],
    [1, [201, 67, 107]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (t <= p1) {
      const k = (t - p0) / (p1 - p0);
      const ch = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
      return `rgb(${ch[0]} ${ch[1]} ${ch[2]})`;
    }
  }
  return `rgb(201 67 107)`;
}
