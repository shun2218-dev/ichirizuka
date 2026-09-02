/**
 * Basic 認証。個人用のダッシュボードなので、URL を知られただけで走行記録と
 * 体重・安静時心拍が全部読めてしまう状態を塞ぐ。
 *
 * Vercel の Deployment Protection ではなく自前で持つのは、/api/plan を
 * Apps Script が週 1 回取りに来るため。Deployment Protection は第三者からの
 * 取得を 401 で弾いてしまう（docs/weekly-plan-delivery.md）が、Basic 認証なら
 * 取りに来る側が Authorization ヘッダーを付ければ通せる。
 *
 * BASIC_AUTH_USER / BASIC_AUTH_PASSWORD の**どちらかが未設定なら素通しする**。
 * 環境変数が入るまでデプロイが落ちるのを避けるため（docs/development-rules.md）。
 * 設定するまでは今までどおり誰でも見える、という意味でもある。
 *
 * ファイル名が middleware.ts でないのは、Next 16 でその名前が非推奨になり
 * proxy.ts に変わったため。役割は同じで、常に Node ランタイムで動く。
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header && matches(header, user, password)) return NextResponse.next();

  return new NextResponse("認証が必要です", {
    status: 401,
    headers: {
      // charset=UTF-8 を明示しないと、ブラウザが非 ASCII のパスワードを
      // latin-1 で送ってきて一致しない
      "WWW-Authenticate": 'Basic realm="ichirizuka", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function matches(header: string, user: string, password: string): boolean {
  const [scheme, encoded] = header.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return false;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");

  // パスワードに : が入りうるので、最初の : だけで割る
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;

  // && ではなく両方を必ず評価する。ユーザー名が合っていたかどうかを
  // 応答の速さから読み取られないようにするため
  const okUser = constantTimeEqual(decoded.slice(0, sep), user);
  const okPassword = constantTimeEqual(decoded.slice(sep + 1), password);
  return okUser && okPassword;
}

/**
 * 一致した時点で抜けない比較。どこまで合っていたかを時間差から漏らさない。
 *
 * timingSafeEqual は長さが違うと例外を投げるので、先に SHA-256 に通して
 * 長さを揃える（ハッシュが一致すれば元の値も一致とみなしてよい）。
 */
function constantTimeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

export const config = {
  // 静的アセットまで通すと画面 1 枚あたりの実行回数が増えるだけで、
  // 守るものが無い（ページと API を塞げば中身は出ない）
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
