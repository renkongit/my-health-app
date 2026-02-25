"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type LatestMetrics = { weight: number | null; bodyFat: number | null };

export default function Home() {
  const { data: session, status } = useSession();
  const [weight, setWeight] = useState<string>("");
  const [bodyFat, setBodyFat] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<LatestMetrics | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(true);

  const fetchLatest = useCallback(async () => {
    if (!session) return;
    setLoadingLatest(true);
    try {
      const res = await fetch("/api/fit");
      const data = (await res.json()) as
        | { weight: number | null; bodyFat: number | null }
        | { error: string };
      if (!res.ok) {
        setLatestMetrics({ weight: null, bodyFat: null });
        return;
      }
      if ("error" in data) {
        setLatestMetrics({ weight: null, bodyFat: null });
        return;
      }
      setLatestMetrics({
        weight: data.weight ?? null,
        bodyFat: data.bodyFat ?? null,
      });
    } catch {
      setLatestMetrics({ weight: null, bodyFat: null });
    } finally {
      setLoadingLatest(false);
    }
  }, [session]);

  useEffect(() => {
    if (status === "authenticated" && session) {
      fetchLatest();
    } else if (status !== "loading") {
      setLoadingLatest(false);
    }
  }, [status, session, fetchLatest]);

  const handleSaveToGoogleFit = async () => {
    const weightNum = weight.trim() ? parseFloat(weight) : undefined;
    const bodyFatNum = bodyFat.trim() ? parseFloat(bodyFat) : undefined;
    if (weightNum == null && bodyFatNum == null) {
      setSaveMessage({ type: "error", text: "体重または体脂肪率を入力してください" });
      return;
    }
    setSaveMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight: weightNum,
          bodyFat: bodyFatNum,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveMessage({
          type: "error",
          text: (data.error as string) || "保存に失敗しました",
        });
        return;
      }
      setSaveMessage({ type: "success", text: "保存しました！" });
      alert("保存しました！");
      fetchLatest();
    } catch {
      setSaveMessage({ type: "error", text: "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-slate-500">読み込み中...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-white">
        <main className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12 sm:min-h-screen sm:py-16">
          <h1 className="mb-2 text-center text-xl font-semibold text-slate-800 sm:text-2xl">
            体重・体脂肪率の記録
          </h1>
          <p className="mb-10 text-center text-sm text-slate-500">
            Googleでログインして記録を始めましょう
          </p>
          <button
            type="button"
            onClick={() => signIn("google")}
            className="w-full max-w-sm rounded-xl bg-sky-500 py-4 text-base font-semibold text-white shadow-md transition-colors hover:bg-sky-600 active:bg-sky-700"
          >
            Googleでログインして記録する
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-md px-4 py-8 sm:py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {session.user?.image && (
              <img
                src={session.user.image}
                alt=""
                className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-600">
                ログイン中
              </p>
              <p className="truncate text-base font-semibold text-slate-800">
                {session.user?.name ?? session.user?.email ?? "ユーザー"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="flex-shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            ログアウト
          </button>
        </div>

        <h1 className="mb-8 text-center text-xl font-semibold text-slate-800 sm:text-2xl">
          体重・体脂肪率の記録
        </h1>

        {loadingLatest ? (
          <div className="mb-6 flex items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/50 py-8">
            <p className="text-sm text-slate-500">Loading...</p>
          </div>
        ) : (
          <div className="mb-6 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-medium text-slate-500">
              現在の記録
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">体重（kg）</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-800">
                  {latestMetrics?.weight != null
                    ? latestMetrics.weight.toFixed(1)
                    : "データなし"}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">体脂肪率（%）</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-800">
                  {latestMetrics?.bodyFat != null
                    ? latestMetrics.bodyFat.toFixed(1)
                    : "データなし"}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-6 shadow-sm">
          <div className="space-y-5">
            <div>
              <label
                htmlFor="weight"
                className="mb-1.5 block text-sm font-medium text-slate-600"
              >
                体重（kg）
              </label>
              <input
                id="weight"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                placeholder="例: 65.5"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-full rounded-xl border border-sky-200 bg-white px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>

            <div>
              <label
                htmlFor="bodyFat"
                className="mb-1.5 block text-sm font-medium text-slate-600"
              >
                体脂肪率（%）
              </label>
              <input
                id="bodyFat"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="100"
                placeholder="例: 22.3"
                value={bodyFat}
                onChange={(e) => setBodyFat(e.target.value)}
                className="w-full rounded-xl border border-sky-200 bg-white px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
          </div>
        </div>

        {saveMessage && (
          <p
            className={`mt-4 text-center text-sm font-medium ${
              saveMessage.type === "success"
                ? "text-sky-600"
                : "text-red-600"
            }`}
          >
            {saveMessage.text}
          </p>
        )}

        <button
          type="button"
          onClick={handleSaveToGoogleFit}
          disabled={saving}
          className="mt-8 w-full rounded-xl bg-sky-500 py-4 text-base font-semibold text-white shadow-md transition-colors hover:bg-sky-600 active:bg-sky-700 disabled:opacity-60 disabled:pointer-events-none"
        >
          {saving ? "保存中..." : "Google Fitに保存する"}
        </button>
      </main>
    </div>
  );
}
