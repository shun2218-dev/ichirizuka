import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function POST() {
  revalidateTag("runs");
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
