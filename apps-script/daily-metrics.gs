/**
 * ショートカットから送られてきた日次のヘルスケア数値を、
 * 同じスプレッドシートの「Daily」タブに1日1行で書き込む。
 *
 * 置き場所: スプレッドシートを開く → 拡張機能 → Apps Script
 *           （このスプレッドシートに紐づいたスクリプトにすること）
 * 使い方は docs/daily-metrics-setup.md を参照。
 */

const SHEET_NAME = "Daily";

/** ショートカット側と同じ文字列にする。推測されない長さのものに必ず変えること。 */
const TOKEN = "CHANGE_ME_ここにランダムな長い文字列";

/** 列の順番。増やしたいときは末尾に足す（既存の列は動かさない） */
const COLUMNS = [
  { key: "date", label: "Date" },
  { key: "resting_hr", label: "Resting HR" },
  { key: "hrv", label: "HRV" },
  { key: "vo2max", label: "VO2max" },
  { key: "weight", label: "Weight" },
  { key: "steps", label: "Steps" },
  { key: "sleep_hours", label: "Sleep Hours" },
  { key: "received_at", label: "Received At" },
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return reply({ ok: false, error: "本文がありません" });
    }

    const body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) {
      return reply({ ok: false, error: "トークンが一致しません" });
    }

    // 過去分の一括取り込み。1 指標ぶんの「日付,値」を何行でも受ける
    if (body.rows) {
      return bulkUpdate(body.metric, body.rows, body.from);
    }

    // date は省略できる。ショートカット側の「日付」「日付を書式設定」を作らずに済む
    const date = body.date ? normalizeDate(body.date) : today();
    if (!date) {
      return reply({ ok: false, error: "date が読めません: " + body.date });
    }

    const sheet = getSheet();
    const values = COLUMNS.map(function (c) {
      if (c.key === "date") return date;
      if (c.key === "received_at") return new Date();
      return toNumberOrBlank(body[c.key]);
    });

    const rowIndex = findRowByDate(sheet, date);
    if (rowIndex > 0) {
      // 同じ日の再送は上書き（1日に何回走らせても行が増えない）
      sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      sortByDateDesc(sheet);
    }

    return reply({ ok: true, date: date, updated: rowIndex > 0 });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/**
 * 過去分の取り込み。1 リクエストにつき 1 指標を、日付ぶんまとめて書く。
 *
 * metric: COLUMNS の key（"resting_hr" など）
 * rows:   "2026/07/26,52;2026/07/25,53" のような区切りテキスト（改行か `;`）
 * from:   これより前の日付を捨てる（省略可）
 *
 * 5 指標ぶんを 1 行に揃えてから送るのはショートカット側で組みにくいので、
 * 指標ごとに列を埋める形にしている。行の読み書きは 1 回にまとめる
 * （1 行ずつ書くと数百日分でタイムアウトするため）。
 *
 * from が要る理由。ショートカットの「開始日が次の過去の期間内 N 日」は実行時刻を
 * 起点にした移動窓なので、範囲のいちばん古い日が途中で切れる。歩数のように 1 日を
 * 合計する指標だと、その日に「途中までの合計」を書いて前に入っていた正しい値を壊す。
 * 検索フィルタ側で日の境目に合わせられれば要らないが、あの欄には変数を差し込めない。
 * そこで送信側は窓を 1 日広めに取り、実際に書きたい下限を from で渡す。
 */
function bulkUpdate(metric, rows, from) {
  const colIndex = indexOfColumn(metric);
  if (colIndex < 0) {
    return reply({ ok: false, error: "metric が不明です: " + metric });
  }

  const sheet = getSheet();
  const width = COLUMNS.length;
  const cutoff = today();
  const floor = from ? normalizeDate(from) : null;
  const last = sheet.getLastRow();
  const values = last > 1 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];

  const rowOfDate = {};
  for (let i = 0; i < values.length; i++) {
    const d = normalizeDate(values[i][0]);
    if (d) rowOfDate[d] = i;
  }

  let updated = 0;
  let added = 0;
  let skipped = 0;

  // JSON の文字列に生の改行は入れられないので、ショートカット側は `;` で繋いでくる
  const lines = String(rows).split(/[\n;]/);
  for (let i = 0; i < lines.length; i++) {
    const sep = lines[i].indexOf(",");
    if (sep < 0) continue;

    const date = normalizeDate(lines[i].slice(0, sep));
    // 桁区切り入り（"9,412"）を壊さないよう、最初のカンマだけで切る
    const value = toNumberOrBlank(lines[i].slice(sep + 1));
    if (!date || value === "") {
      skipped++;
      continue;
    }

    // 当日と未来日は書かない。1 日が終わっていない歩数を書くと「途中までの合計」が
    // その日の値として残り、翌日の送信までダッシュボードに嘘の日が出る。
    // 送信側は数日ぶんをまとめて送ってくるので、当日を捨てても翌日の実行で埋まる。
    // date は "yyyy/MM/dd" にそろえてあるので文字列比較で日付順に並ぶ。
    if (date >= cutoff || (floor && date < floor)) {
      skipped++;
      continue;
    }

    let at = rowOfDate[date];
    if (at === undefined) {
      const blank = [];
      for (let c = 0; c < width; c++) blank.push("");
      blank[0] = date;
      blank[width - 1] = new Date();
      values.push(blank);
      at = values.length - 1;
      rowOfDate[date] = at;
      added++;
    } else {
      updated++;
    }
    values[at][colIndex] = value;
  }

  if (values.length) {
    sheet.getRange(2, 1, values.length, width).setValues(values);
    sortByDateDesc(sheet);
  }

  return reply({ ok: true, metric: metric, added: added, updated: updated, skipped: skipped });
}

function indexOfColumn(key) {
  for (let i = 0; i < COLUMNS.length; i++) {
    if (COLUMNS[i].key === key) return i;
  }
  return -1;
}

/** ブラウザで /exec を開いたときの動作確認用 */
function doGet() {
  return reply({ ok: true, message: "エンドポイントは生きています。POST してください。" });
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(
      COLUMNS.map(function (c) {
        return c.label;
      })
    );
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * date を省略して送ってきたとき用の「今日」。
 * スプレッドシートに紐づくスクリプトなので、シートと同じタイムゾーンで解決される。
 */
function today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd");
}

/**
 * "2026/07/27" / "2026-07-27" / "2026年7月27日" / ISO 文字列 / Date → "2026/07/27"
 *
 * 日付セルは getValues() だと Date で返り、ショートカットの日付変数は
 * 書式指定を忘れると "2026年7月27日" で飛んでくる。どちらも受ける。
 */
function normalizeDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), "yyyy/MM/dd");
  }
  const m = String(raw).match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!m) return null;
  const pad = function (n) {
    return String(n).length < 2 ? "0" + n : String(n);
  };
  return m[1] + "/" + pad(m[2]) + "/" + pad(m[3]);
}

function toNumberOrBlank(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).replace(/[^\d.\-]/g, "");
  if (s === "" || s === "-") return "";
  const n = Number(s);
  return isNaN(n) ? "" : n;
}

function findRowByDate(sheet, date) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const dates = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < dates.length; i++) {
    if (normalizeDate(dates[i][0]) === date) return i + 2;
  }
  return -1;
}

/** Running タブと同じく新しい日付が上に来るようにする */
function sortByDateDesc(sheet) {
  const last = sheet.getLastRow();
  if (last > 2) {
    sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).sort({ column: 1, ascending: false });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
