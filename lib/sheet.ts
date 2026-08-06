/**
 * Google スプレッドシートの各タブを CSV として取り出して、扱いやすい形に直す。
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

/** Daily タブの 1 日分。指標は「その日は記録がない」ことがあるので全部 null を許す */
export type Daily = {
  /** その日の 00:00（壁時計そのまま） */
  date: Date;
  /** 安静時心拍数 bpm */
  restingHr: number | null;
  /** 心拍変動 ms */
  hrv: number | null;
  /** mL/kg/min */
  vo2max: number | null;
  /** kg */
  weight: number | null;
  steps: number | null;
  /** 時間 */
  sleepHours: number | null;
};

/** Daily の指標名（date 以外）。表示側の一覧はここから導く */
export type DailyMetricKey = Exclude<keyof Daily, "date">;

/**
 * Fit タブの 1 ラン分。scripts/import-fit.mjs が FIT から作って書き込む。
 *
 * Running タブにあるのはラン全体の平均心拍だけで、それでは強度の配分が測れない
 * （同じ距離を淡々と走った日とインターバルを入れた日で平均が一致しうる）。
 * ゾーンごとの滞在時間はここにしかない。
 */
export type FitSummary = {
  /** 開始日時。Running タブの行と突き合わせるためのキー */
  start: Date;
  /** 秒 */
  movingSec: number;
  /** m */
  distanceM: number;
  avgHr: number | null;
  maxHr: number | null;
  /** ゾーンごとの滞在秒数。[0] は「ゾーン 1 の下限より下」 */
  zoneSec: number[];
  /** ゾーンの上限 bpm。設定を変えた前後を混ぜないようランごとに持つ */
  zoneBounds: number[];
  /** そのとき設定されていた最大心拍 */
  maxHrSetting: number | null;
  /** そのときの安静時心拍 */
  restingHr: number | null;
  laps: number;
  /** "distance" なら距離オートラップ（単なる km 刻み）で、構造化練習ではない */
  lapTrigger: string;
  /** HealthFit の推定値。自己申告の体感強度とは別物 */
  rpe: number | null;
  avgCadence: number | null;
};

/**
 * Settings タブ。目標や練習の条件を、再デプロイなしで変えられるようにするためのもの。
 *
 * UI から書き込む方式は採っていない（アプリは読み取り専用のまま保つ）。手でシートを
 * 編集する運用にすることで、認証も書き込み権限も要らずに済む。
 *
 * 心拍ゾーンの境界と最大心拍はここに置かない。FIT がランごとの実際の設定値を
 * 持ってくるので、二重に持つと食い違うだけになる。
 */
export type Settings = {
  /** フルマラソンの目標タイム（秒） */
  goalMarathonSec: number | null;
  /** レース当日。未定なら null。**空を正常系として扱う** */
  raceDate: Date | null;
  /** 走れる曜日（0=日曜 … 6=土曜）。未設定なら空配列 */
  trainingDays: number[];
  /** 週の目標距離 km。未設定なら環境変数へフォールバックする */
  weeklyTargetKm: number | null;
};

const EMPTY_SETTINGS: Settings = {
  goalMarathonSec: null,
  raceDate: null,
  trainingDays: [],
  weeklyTargetKm: null,
};

const SECONDS_IN_DAY = 86400;

/** gviz なら「リンクを知っている全員が閲覧可」だけで読める（ウェブ公開は不要） */
function gvizUrl(id: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

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
  return gvizUrl(id, gid);
}

/**
 * Daily タブの CSV URL。設定がなければ null。
 * Running と違って未設定を異常扱いしない（コンディションの表示は任意機能）。
 */
export function dailyCsvUrl(): string | null {
  const direct = process.env.SHEET_DAILY_CSV_URL;
  if (direct) return direct;

  const id = process.env.SHEET_ID;
  const gid = process.env.SHEET_DAILY_GID;
  if (!id || !gid) return null;
  return gvizUrl(id, gid);
}

/**
 * Fit タブの CSV URL。設定がなければ null。
 * Daily と同じく、未設定を異常扱いしない（取り込みは任意）。
 */
export function fitCsvUrl(): string | null {
  const direct = process.env.SHEET_FIT_CSV_URL;
  if (direct) return direct;

  const id = process.env.SHEET_ID;
  const gid = process.env.SHEET_FIT_GID;
  if (!id || !gid) return null;
  return gvizUrl(id, gid);
}

/**
 * Settings タブの CSV URL。設定がなければ null。
 * Daily / Fit と同じく、未設定を異常扱いしない。
 */
export function settingsCsvUrl(): string | null {
  const direct = process.env.SHEET_SETTINGS_CSV_URL;
  if (direct) return direct;

  const id = process.env.SHEET_ID;
  const gid = process.env.SHEET_SETTINGS_GID;
  if (!id || !gid) return null;
  return gvizUrl(id, gid);
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

/** 空欄と 0 以下は「その日は測っていない」とみなす。体重 0kg や心拍 0bpm は存在しない */
function parseOptionalNumber(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = Number(v.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 日付の桁の並びは gviz が返す表示形式（＝シートのロケール）任せなので、
 * 年が先（2026/07/26）でも後ろ（07/26/2026）でも読めるようにしておく。
 */
function parseDateParts(dateRaw: string): [number, number, number] | null {
  // セルに時刻が続くことがあるので、頭から 3 つの数字だけを見る
  const m = dateRaw.trim().match(/(\d+)[/.\-](\d+)[/.\-](\d+)/);
  if (!m) return null;

  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a > 31) return [a, b, c];
  if (c > 31) return [c, a, b];
  // 2 桁年は年・月・日の区別がつかないので読めない扱いにする
  return null;
}

/** "2026/07/26" → その日の 00:00 */
function parseDay(dateRaw: string): Date | null {
  const p = parseDateParts(dateRaw);
  return p ? new Date(p[0], p[1] - 1, p[2]) : null;
}

/** "2026/07/26" + "17:36" → Date。時刻が空でも落とさない。 */
function parseStart(dateRaw: string, timeRaw: string): Date | null {
  const p = parseDateParts(dateRaw);
  if (!p) return null;
  const t = timeRaw.trim().match(/^(\d{1,2}):(\d{2})/);
  return new Date(p[0], p[1] - 1, p[2], t ? Number(t[1]) : 0, t ? Number(t[2]) : 0);
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

export function rowsToDaily(rows: string[][]): Daily[] {
  const headerIndex = rows.findIndex((r) => indexOfHeader(r, "date", "日付") >= 0);
  if (headerIndex < 0) return [];
  const header = rows[headerIndex];

  const col = {
    date: indexOfHeader(header, "date", "日付"),
    restingHr: indexOfHeader(header, "resting hr", "resting heart rate", "安静時心拍数"),
    hrv: indexOfHeader(header, "hrv", "心拍変動"),
    vo2max: indexOfHeader(header, "vo2max", "vo2 max", "心肺機能"),
    weight: indexOfHeader(header, "weight", "体重"),
    steps: indexOfHeader(header, "steps", "歩数"),
    sleepHours: indexOfHeader(header, "sleep hours", "sleep", "睡眠時間"),
  };

  const at = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "") : "");

  const days: Daily[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseDay(at(row, col.date));
    if (!date) continue;

    const metrics: Record<DailyMetricKey, number | null> = {
      restingHr: parseOptionalNumber(at(row, col.restingHr)),
      hrv: parseOptionalNumber(at(row, col.hrv)),
      vo2max: parseOptionalNumber(at(row, col.vo2max)),
      weight: parseOptionalNumber(at(row, col.weight)),
      steps: parseOptionalNumber(at(row, col.steps)),
      sleepHours: parseOptionalNumber(at(row, col.sleepHours)),
    };
    // 日付だけの行（ショートカットが値を1つも送れなかった日）は持っていても使えない
    if (Object.values(metrics).every((v) => v === null)) continue;

    days.push({ date, ...metrics });
  }

  days.sort((a, b) => a.date.getTime() - b.date.getTime());
  return days;
}

export function rowsToFit(rows: string[][]): FitSummary[] {
  const headerIndex = rows.findIndex((r) => indexOfHeader(r, "start", "開始日時") >= 0);
  if (headerIndex < 0) return [];
  const header = rows[headerIndex];

  const col = {
    start: indexOfHeader(header, "start", "開始日時"),
    movingSec: indexOfHeader(header, "moving sec"),
    distanceM: indexOfHeader(header, "distance m"),
    avgHr: indexOfHeader(header, "avg hr"),
    maxHr: indexOfHeader(header, "max hr"),
    zone: [0, 1, 2, 3, 4, 5].map((i) => indexOfHeader(header, `zone ${i} sec`)),
    zoneBounds: indexOfHeader(header, "zone bounds"),
    maxHrSetting: indexOfHeader(header, "max hr setting"),
    restingHr: indexOfHeader(header, "resting hr"),
    laps: indexOfHeader(header, "laps"),
    lapTrigger: indexOfHeader(header, "lap trigger"),
    rpe: indexOfHeader(header, "rpe"),
    avgCadence: indexOfHeader(header, "avg cadence"),
  };

  const at = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "") : "");

  const out: FitSummary[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    // "2026/07/19 13:10:12" を日付と時刻に割る。parseStart は秒を見ないが、
    // Running タブ側が分までなので、突き合わせる粒度としてはこれで揃う。
    const raw = at(row, col.start).trim();
    const sep = raw.indexOf(" ");
    const start = parseStart(sep < 0 ? raw : raw.slice(0, sep), sep < 0 ? "" : raw.slice(sep + 1));
    if (!start) continue;

    const zoneSec = col.zone.map((i) => parseNumber(at(row, i)));
    // ゾーンが 1 つも入っていない行は、この取り込みの目的を果たしていないので持たない
    if (zoneSec.every((v) => v === 0)) continue;

    out.push({
      start,
      movingSec: parseNumber(at(row, col.movingSec)),
      distanceM: parseNumber(at(row, col.distanceM)),
      avgHr: parseOptionalNumber(at(row, col.avgHr)),
      maxHr: parseOptionalNumber(at(row, col.maxHr)),
      zoneSec,
      zoneBounds: at(row, col.zoneBounds)
        .split("/")
        .map((s) => parseNumber(s))
        .filter((n) => n > 0),
      maxHrSetting: parseOptionalNumber(at(row, col.maxHrSetting)),
      restingHr: parseOptionalNumber(at(row, col.restingHr)),
      laps: parseNumber(at(row, col.laps)),
      lapTrigger: at(row, col.lapTrigger).trim(),
      rpe: parseOptionalNumber(at(row, col.rpe)),
      avgCadence: parseOptionalNumber(at(row, col.avgCadence)),
    });
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

/** 曜日の表記ゆれ。英語の略記・フル・日本語のどれでも受ける */
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, 日: 0, 日曜: 0, 日曜日: 0,
  mon: 1, monday: 1, 月: 1, 月曜: 1, 月曜日: 1,
  tue: 2, tues: 2, tuesday: 2, 火: 2, 火曜: 2, 火曜日: 2,
  wed: 3, wednesday: 3, 水: 3, 水曜: 3, 水曜日: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, 木: 4, 木曜: 4, 木曜日: 4,
  fri: 5, friday: 5, 金: 5, 金曜: 5, 金曜日: 5,
  sat: 6, saturday: 6, 土: 6, 土曜: 6, 土曜日: 6,
};

/** "Tue,Thu,Sat" / "火・木・土" → [2, 4, 6]。読めない語は落とす */
function parseWeekdays(raw: string): number[] {
  const days = raw
    .split(/[,、\/・\s]+/)
    .map((s) => WEEKDAYS[s.trim().toLowerCase()])
    .filter((n): n is number => n !== undefined);
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Settings タブは `key` / `value` の 2 列。**ヘッダー行は要らない**
 * （既知のキーに一致した行だけ拾うので、あっても無視される）。
 *
 * 外部データなので値は信用しない。読めないものは既定値に落とし、例外は投げない。
 */
export function rowsToSettings(rows: string[][]): Settings {
  const out: Settings = { ...EMPTY_SETTINGS, trainingDays: [] };

  for (const row of rows) {
    const key = (row[0] ?? "").replace(/[\s　_-]/g, "").toLowerCase();
    const value = (row[1] ?? "").trim();
    if (!key || !value) continue;

    switch (key) {
      case "goalmarathontime":
      case "目標タイム": {
        const sec = parseDuration(value);
        if (sec > 0) out.goalMarathonSec = sec;
        break;
      }
      case "racedate":
      case "レース日":
        out.raceDate = parseDay(value);
        break;
      case "trainingdays":
      case "練習可能曜日":
        out.trainingDays = parseWeekdays(value);
        break;
      case "weeklytargetkm":
      case "週の目標距離": {
        const km = parseOptionalNumber(value);
        if (km !== null && km > 0) out.weeklyTargetKm = km;
        break;
      }
    }
  }

  return out;
}

async function fetchCsv(url: string, tag: string): Promise<string[][]> {
  const res = await fetch(url, {
    // Vercel 側のキャッシュ。ページの revalidate と合わせている。
    next: { revalidate: 600, tags: [tag] },
    headers: { "user-agent": "ichirizuka" },
  });
  if (!res.ok) {
    throw new Error(
      `シートを読めませんでした (HTTP ${res.status})。共有設定が「リンクを知っている全員が閲覧可」になっているか確認してください。`,
    );
  }
  return parseCsv(await res.text());
}

export async function fetchRuns(): Promise<{ runs: Run[]; fetchedAt: Date }> {
  const rows = await fetchCsv(sheetCsvUrl(), "runs");
  return { runs: rowsToRuns(rows), fetchedAt: new Date() };
}

export type DailyResult = {
  /** Daily タブの設定があるか */
  configured: boolean;
  days: Daily[];
  /** 読めなかった理由。ランニングの表示を止めないよう例外にはしない */
  error: string | null;
};

/**
 * Daily タブを読む。設定漏れや読み取り失敗でランニングのダッシュボードを
 * 落としたくないので、投げずに結果へ入れて返す。
 */
export async function fetchDaily(): Promise<DailyResult> {
  const url = dailyCsvUrl();
  if (!url) return { configured: false, days: [], error: null };

  try {
    return { configured: true, days: rowsToDaily(await fetchCsv(url, "daily")), error: null };
  } catch (err) {
    return {
      configured: true,
      days: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SettingsResult = {
  /** Settings タブの設定があるか */
  configured: boolean;
  settings: Settings;
  /** 読めなかった理由。ダッシュボードを止めないよう例外にはしない */
  error: string | null;
};

/**
 * Settings タブを読む。未設定・読み取り失敗・0 件のいずれでも既定値を返す。
 * 目標が読めないだけで走った記録が見られなくなるのは本末転倒なので。
 */
export async function fetchSettings(): Promise<SettingsResult> {
  const url = settingsCsvUrl();
  if (!url) return { configured: false, settings: EMPTY_SETTINGS, error: null };

  try {
    const settings = rowsToSettings(await fetchCsv(url, "settings"));
    return { configured: true, settings, error: null };
  } catch (err) {
    return {
      configured: true,
      settings: EMPTY_SETTINGS,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type FitResult = {
  /** Fit タブの設定があるか */
  configured: boolean;
  runs: FitSummary[];
  /** 読めなかった理由。ランニングの表示を止めないよう例外にはしない */
  error: string | null;
};

/**
 * Fit タブを読む。Daily と同じく、設定漏れや読み取り失敗で
 * ダッシュボードを落とさない。
 */
export async function fetchFit(): Promise<FitResult> {
  const url = fitCsvUrl();
  if (!url) return { configured: false, runs: [], error: null };

  try {
    return { configured: true, runs: rowsToFit(await fetchCsv(url, "fit")), error: null };
  } catch (err) {
    return {
      configured: true,
      runs: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
