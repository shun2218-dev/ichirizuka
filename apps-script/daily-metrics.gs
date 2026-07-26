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

/** "2026/07/27" / "2026-07-27" / ISO 文字列 → "2026/07/27" */
function normalizeDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
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
