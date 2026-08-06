import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function POST() {
  // Next 16 から第 2 引数（キャッシュプロファイル）が必須。
  // "max" は expire が最長なので、実質「古さに関係なく全部パージ」になる。
  revalidateTag("runs", "max");
  revalidateTag("daily", "max");
  revalidateTag("fit", "max");
  revalidateTag("settings", "max");
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
