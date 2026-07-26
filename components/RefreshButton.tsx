"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  async function refresh() {
    setFailed(false);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      startTransition(() => router.refresh());
    } catch {
      setFailed(true);
    }
  }

  return (
    <button className="button" onClick={refresh} disabled={pending}>
      {pending ? "読み込み中" : failed ? "もう一度試す" : "シートを読み直す"}
    </button>
  );
}
