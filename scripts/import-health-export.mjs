#!/usr/bin/env node
/**
 * ヘルスケアの書き出し（export.xml）から日次の指標を作り、Daily タブへ流し込む。
 *
 * ショートカットの「過去分の取り込み」はサンプルを 1 件ずつループするため、
 * 数年分だと実用的な時間で終わらない。書き出したファイルなら一度に処理できる。
 * 日々の記録はショートカットの担当で、これは最初の 1 回だけ使う道具。
 *
 *   iPhone の ヘルスケア → プロフィール → すべてのヘルスケアデータを書き出す
 *   → 書き出したデータ.zip を Mac に送って解凍 → 中の export.xml を指定する
 *
 * 使い方:
 *   node scripts/import-health-export.mjs <export.xml>              # 集計して確認するだけ
 *   node scripts/import-health-export.mjs <export.xml> --out ./tmp  # CSV に書き出す
 *   node scripts/import-health-export.mjs <export.xml> --post       # Daily タブへ送る
 *
 * 送信先とトークンは `.env.local` に置く（コマンドに書くとシェルの履歴に残るため）。
 *
 *   SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec
 *   SHEET_WEBAPP_TOKEN=Apps Script の TOKEN と同じ文字列
 */

import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

/** export.xml の type → Daily タブの列 */
const METRICS = {
  HKQuantityTypeIdentifierRestingHeartRate: { key: "resting_hr", pick: "last" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { key: "hrv", pick: "last" },
  HKQuantityTypeIdentifierVO2Max: { key: "vo2max", pick: "last" },
  HKQuantityTypeIdentifierBodyMass: { key: "weight", pick: "last" },
  HKQuantityTypeIdentifierStepCount: { key: "steps", pick: "sumBySource" },
};

const LB_TO_KG = 0.45359237;

function parseArgs(argv) {
  const args = { file: null, out: null, post: false, from: null, batch: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--post") args.post = true;
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--batch") args.batch = Number(argv[++i]);
    else if (!args.file) args.file = a;
  }
  return args;
}

/** .env.local を読む。アプリと同じ置き場所にして、鍵をコマンドに書かせない */
function readEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  const env = {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/** `<Record ... key="value" ...>` から必要な属性だけ取り出す */
function attr(line, name) {
  const m = line.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** "2026-07-27 07:23:11 +0900" → "2026/07/27"（端末の壁時計をそのまま使う） */
function dayOf(stamp) {
  if (!stamp || stamp.length < 10) return null;
  return stamp.slice(0, 10).replace(/-/g, "/");
}

async function collect(file, from) {
  // 1 レコード 1 行なので、行ごとに見れば数 GB でもメモリに載せずに済む
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });

  /** key → date → 値（pick に応じた持ち方） */
  const byMetric = {};
  for (const { key } of Object.values(METRICS)) byMetric[key] = new Map();

  let records = 0;
  let used = 0;

  for await (const line of rl) {
    if (!line.includes("<Record ")) continue;
    records++;

    const type = attr(line, "type");
    const metric = METRICS[type];
    if (!metric) continue;

    const date = dayOf(attr(line, "startDate"));
    if (!date || (from && date < from)) continue;

    const raw = Number(attr(line, "value"));
    if (!Number.isFinite(raw) || raw <= 0) continue;

    const unit = attr(line, "unit");
    const value = unit === "lb" ? raw * LB_TO_KG : raw;

    const table = byMetric[metric.key];
    if (metric.pick === "last") {
      // 同じ日に複数あればいちばん新しいもの。日々のショートカット（降順・制限1）と揃える
      const prev = table.get(date);
      const stamp = attr(line, "startDate");
      if (!prev || stamp >= prev.stamp) table.set(date, { value, stamp });
    } else {
      // 歩数は iPhone と Watch の両方が記録するので、単純合計だと二重に数える。
      // ソースごとに合計してから、その日のいちばん多いソースを採る
      const source = attr(line, "sourceName") ?? "?";
      const perSource = table.get(date) ?? new Map();
      perSource.set(source, (perSource.get(source) ?? 0) + value);
      table.set(date, perSource);
    }
    used++;
  }

  const out = {};
  for (const { key, pick } of Object.values(METRICS)) {
    const table = byMetric[key];
    const rows = [];
    for (const [date, held] of table) {
      const value = pick === "last" ? held.value : Math.max(...held.values());
      rows.push([date, value]);
    }
    rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    out[key] = rows;
  }
  return { metrics: out, records, used };
}

function format(key, value) {
  if (key === "steps") return String(Math.round(value));
  if (key === "weight" || key === "vo2max") return value.toFixed(1);
  return String(Math.round(value));
}

async function post(url, token, key, rows, batchSize) {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const body = {
      token,
      metric: key,
      // 区切りは `;`。JSON の文字列に生の改行は入れられない
      rows: chunk.map(([d, v]) => `${d},${format(key, v)}`).join(";"),
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow",
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`応答が JSON ではありません。URL とデプロイ設定を確認してください:\n${text.slice(0, 200)}`);
    }
    if (!json.ok) throw new Error(`${key}: ${json.error}`);
    added += json.added;
    updated += json.updated;
    skipped += json.skipped;
  }
  return { added, updated, skipped };
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error("使い方: node scripts/import-health-export.mjs <export.xml> [--out dir] [--post URL] [--from YYYY/MM/DD]");
  process.exit(1);
}

const { metrics, records, used } = await collect(args.file, args.from);

console.log(`Record 総数 ${records.toLocaleString()} / 使ったもの ${used.toLocaleString()}\n`);
for (const [key, rows] of Object.entries(metrics)) {
  if (!rows.length) {
    console.log(`${key.padEnd(11)} 記録なし`);
    continue;
  }
  const sample = rows[rows.length - 1];
  console.log(
    `${key.padEnd(11)} ${String(rows.length).padStart(5)}日分  ` +
      `${rows[0][0]} 〜 ${sample[0]}  最新 ${format(key, sample[1])}`,
  );
}

if (args.out) {
  for (const [key, rows] of Object.entries(metrics)) {
    if (!rows.length) continue;
    const path = `${args.out}/${key}.csv`;
    writeFileSync(path, rows.map(([d, v]) => `${d},${format(key, v)}`).join("\n"));
    console.log(`\n書き出し: ${path}`);
  }
}

if (args.post) {
  const env = { ...readEnvLocal(), ...process.env };
  const url = env.SHEET_WEBAPP_URL;
  const token = env.SHEET_WEBAPP_TOKEN;
  if (!url || !token) {
    console.error(
      "\n.env.local に次の 2 行を足してください（Apps Script のデプロイ画面と TOKEN からコピー）:\n" +
        "  SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec\n" +
        "  SHEET_WEBAPP_TOKEN=...",
    );
    process.exit(1);
  }

  console.log("");
  for (const [key, rows] of Object.entries(metrics)) {
    if (!rows.length) continue;
    try {
      const r = await post(url, token, key, rows, args.batch);
      console.log(`${key.padEnd(11)} 追加 ${r.added} / 更新 ${r.updated} / スキップ ${r.skipped}`);
    } catch (err) {
      // 1 指標が失敗しても残りは送る。同じ日を送り直しても上書きなので、直して再実行できる
      console.error(`${key.padEnd(11)} 失敗: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}
