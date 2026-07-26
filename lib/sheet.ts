/**
 * Google スプレッドシートの 1 タブを CSV として取り出して、扱いやすい形に直す。
 * サーバー側でしか呼ばないので CORS は関係ない。
 */

export type Run = {
  /** 開始日時（ローカル時刻としてそのまま扱う） */
  start: Date;
  /** km */
  distance: number;
  /** 秒 */
  movingSec: number;
  /** 秒 */
  totalSec: number;
  /** 秒 */
  elapsedSec: number;
  /** 秒/km */
  pace: number;
  kcal: number;
  hr: number | null;
  elevation: number;
  source: string;
};

const SECONDS_IN_DAY = 86400;

export function sheetCsvUrl(): string {
  const direct = process.env.SHEET_CSV_URL;
  if (direct) return direct;

  const id = process.env.SHEET_ID;
  const gid = process.env.SHEET_GID ?? "0";
  if (!id) {
    throw new Error(
      "SHEET_ID が設定されていません。.env.local に SHEET_ID と SHEET_GID を入れてください。",
    );
  }
  // gviz なら「リンクを知っている全員が閲覧可」だけで読める（ウェブ公開は不要）
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

/** ダブルクォート・改行入りセルに対応した最小限の CSV パーサ */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") {
      cell += c;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * 時間の書き方はシートの表示形式次第で揺れるので、見かける形は全部受ける。
 * "0h:44m:44s" / "0:44:44" / "44:44" / "2684" / "0.031065"（シリアル値）
 */
export function parseDuration(raw: string): number {
  const v = raw.trim();
  if (!v) return 0;

  const tagged = v.match(/(?:(\d+)\s*h)?[\s:]*(?:(\d+)\s*m)?[\s:]*(?:([\d.]+)\s*s)?/i);
  if (/[hms]/i.test(v) && tagged) {
    const h = Number(tagged[1] ?? 0);
    const m = Number(tagged[2] ?? 0);
    const s = Number(tagged[3] ?? 0);
    if (h || m || s) return h * 3600 + m * 60 + s;
  }

  if (v.includes(":")) {
    const parts = v.split(":").map((p) => Number(p.replace(/[^\d.]/g, "")) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }

  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // 1 未満なら「1 日 = 1」のシリアル値とみなす（4h 未満の運動はこれで正しい）
  return n > 0 && n < 1 ? Math.round(n * SECONDS_IN_DAY) : n;
}

function parseNumber(raw: string): number {
  const n = Number(String(raw).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "2026/07/26" + "17:36" → Date。時刻が空でも落とさない。 */
function parseStart(dateRaw: string, timeRaw: string): Date | null {
  const d = dateRaw.trim().replace(/[.\-]/g, "/");
  const m = d.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const t = timeRaw.trim().match(/^(\d{1,2}):(\d{2})/);
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    t ? Number(t[1]) : 0,
    t ? Number(t[2]) : 0,
  );
}

/** ヘッダー名は前後の空白・大文字小文字・全角スペースを無視して照合する */
function indexOfHeader(header: string[], ...names: string[]): number {
  const norm = (s: string) => s.replace(/[\s\u3000]/g, "").toLowerCase();
  const wanted = names.map(norm);
  return header.findIndex((h) => wanted.includes(norm(h)));
}

export function rowsToRuns(rows: string[][]): Run[] {
  const headerIndex = rows.findIndex((r) => indexOfHeader(r, "date", "日付") >= 0);
  if (headerIndex < 0) return [];
  const header = rows[headerIndex];

  const col = {
    date: indexOfHeader(header, "date", "日付"),
    time: indexOfHeader(header, "time", "開始時刻"),
    type: indexOfHeader(header, "type", "種目"),
    total: indexOfHeader(header, "total time"),
    moving: indexOfHeader(header, "moving time"),
    elapsed: indexOfHeader(header, "elapsed time"),
    distance: indexOfHeader(header, "distance", "距離"),
    kcal: indexOfHeader(header, "active calories", "calories"),
    hr: indexOfHeader(header, "heart rate", "心拍数"),
    elevation: indexOfHeader(header, "elevation gain"),
    source: indexOfHeader(header, "source"),
  };

  const at = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "") : "");

  const body = rows.slice(headerIndex + 1);

  /**
   * 距離の単位は行ごとに判定すると短い記録（147.5m など）を km と誤読するので、
   * データ全体の中央値で一度だけ決める。Apple Watch 由来ならメートル。
   */
  const samples = body
    .map((row) => parseNumber(at(row, col.distance)))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const median = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
  const perKm = median > 200 ? 1000 : 1;

  const runs: Run[] = [];
  for (const row of body) {
    const start = parseStart(at(row, col.date), at(row, col.time));
    if (!start) continue;

    const distance = parseNumber(at(row, col.distance)) / perKm;

    const movingSec = parseDuration(at(row, col.moving));
    const totalSec = parseDuration(at(row, col.total)) || movingSec;
    const elapsedSec = parseDuration(at(row, col.elapsed)) || totalSec;
    const timed = movingSec || totalSec;
    if (!distance || !timed) continue;

    const hrRaw = parseNumber(at(row, col.hr));

    runs.push({
      start,
      distance,
      movingSec: movingSec || totalSec,
      totalSec,
      elapsedSec,
      pace: timed / distance,
      kcal: parseNumber(at(row, col.kcal)),
      hr: hrRaw > 0 ? Math.round(hrRaw) : null,
      elevation: parseNumber(at(row, col.elevation)),
      source: at(row, col.source).trim(),
    });
  }

  runs.sort((a, b) => a.start.getTime() - b.start.getTime());
  return runs;
}

export async function fetchRuns(): Promise<{ runs: Run[]; fetchedAt: Date }> {
  const res = await fetch(sheetCsvUrl(), {
    // Vercel 側のキャッシュ。ページの revalidate と合わせている。
    next: { revalidate: 600, tags: ["runs"] },
    headers: { "user-agent": "ichirizuka" },
  });
  if (!res.ok) {
    throw new Error(
      `シートを読めませんでした (HTTP ${res.status})。共有設定が「リンクを知っている全員が閲覧可」になっているか確認してください。`,
    );
  }
  const text = await res.text();
  return { runs: rowsToRuns(parseCsv(text)), fetchedAt: new Date() };
}
