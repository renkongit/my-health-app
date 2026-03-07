"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type WeightTrendPoint = { date: string; weight: number | null };

function formatDateLabel(ymd: string): string {
  // "YYYY-MM-DD" -> "MM/DD"
  const m = ymd.slice(5, 7);
  const d = ymd.slice(8, 10);
  if (!m || !d) return ymd;
  return `${m}/${d}`;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [weight, setWeight] = useState<string>("");
  const [bodyFat, setBodyFat] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [weightTrend, setWeightTrend] = useState<WeightTrendPoint[]>([]);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [trendError, setTrendError] = useState<string | null>(null);

  const fetchTrend = useCallback(async () => {
    if (!session) return;
    setLoadingTrend(true);
    setTrendError(null);
    try {
      const res = await fetch("/api/fit");
      const data = (await res.json()) as WeightTrendPoint[] | { error: string };
      if (!res.ok) {
        const errorMessage =
          typeof data === "object" && "error" in data
            ? data.error
            : undefined;
        if (res.status === 401 && errorMessage === "REAUTH_REQUIRED") {
          setTrendError(
            "セッションの有効期限が切れました。もう一度ログインしてください。"
          );
        } else if (res.status === 401) {
          setTrendError("ログインが必要です。");
        } else {
          setTrendError("体重データの取得に失敗しました。");
        }
        return;
      }
      if ("error" in data) {
        setTrendError("体重データの取得に失敗しました。");
        return;
      }
      setWeightTrend(Array.isArray(data) ? data : []);
    } catch {
      setWeightTrend([]);
    } finally {
      setLoadingTrend(false);
    }
  }, [session]);

  useEffect(() => {
    if (status === "authenticated" && session) {
      fetchTrend();
    } else if (status !== "loading") {
      setLoadingTrend(false);
    }
  }, [status, session, fetchTrend]);

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
      fetchTrend();
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

        <div className="mb-6 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-sm font-medium text-slate-600">
              過去30日間の体重推移
            </h2>
            <button
              type="button"
              onClick={fetchTrend}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              更新
            </button>
          </div>

          {loadingTrend ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-sm text-slate-500">Loading...</p>
            </div>
          ) : trendError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <p className="text-sm text-red-500">{trendError}</p>
              {weightTrend.length > 0 && (
                <p className="text-xs text-slate-400">
                  （前回取得したデータを表示しています）
                </p>
              )}
            </div>
          ) : weightTrend.every((p) => p.weight == null) ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-sm text-slate-500">データなし</p>
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weightTrend} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateLabel}
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={{ stroke: "#e2e8f0" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={{ stroke: "#e2e8f0" }}
                    width={36}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number"
                        ? [`${value} kg`, "体重"]
                        : [value, "体重"]
                    }
                    labelFormatter={(label) => `日付: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: "#3b82f6" }}
                    connectNulls
                    isAnimationActive={false}
                  >
                    <LabelList
                      dataKey="weight"
                      position="top"
                      className="text-[10px] fill-slate-500"
                    />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

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
