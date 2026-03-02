import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const FIT_BASE = "https://www.googleapis.com/fitness/v1/users/me";
const APP_NAME = "My Health App";

/** 環境変数でプロジェクト番号（Google Cloud のプロジェクト番号）を指定可能 */
const PROJECT_NUMBER = process.env.GOOGLE_PROJECT_NUMBER?.trim() || null;

/** 現在時刻をナノ秒（文字列）で返す */
function nowNanos(): string {
  return `${Date.now()}000000`;
}

/**
 * 自作アプリ専用の dataStreamId を組み立てる。
 * 形式: derived:dataTypeName:projectNumber:dataStreamName
 * （REST の最小形式。dataStreamName は MyHealthApp_weight_input など）
 * GOOGLE_PROJECT_NUMBER が未設定の場合は null。
 */
function buildAppDataSourceId(
  dataTypeName: string,
  streamSuffix: string
): string | null {
  if (!PROJECT_NUMBER) return null;
  const dataStreamName = `MyHealthApp_${streamSuffix}`;
  return `derived:${dataTypeName}:${PROJECT_NUMBER}:${dataStreamName}`;
}

/**
 * 指定した dataSourceId のデータソースが存在するか GET で確認する。
 * 存在すれば dataStreamId を返し、404 なら null。
 */
async function getDataSourceIfExists(
  accessToken: string,
  dataSourceId: string
): Promise<string | null> {
  const url = `${FIT_BASE}/dataSources/${encodeURIComponent(dataSourceId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get data source: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as { dataStreamId: string };
  return data.dataStreamId;
}

/**
 * 一覧から「自作アプリ専用」のデータソースを探す。
 * application.name が自アプリかつ dataType.name が一致するもののみ採用する。
 */
async function findOwnDataSourceFromList(
  accessToken: string,
  dataTypeName: string
): Promise<string | null> {
  const listRes = await fetch(`${FIT_BASE}/dataSources`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw new Error(`Failed to list data sources: ${listRes.status}`);
  }
  const list = (await listRes.json()) as {
    dataSource?: Array<{
      dataStreamId: string;
      dataType?: { name: string };
      application?: { name?: string };
    }>;
  };
  const sources = list.dataSource ?? [];
  const own = sources.find(
    (s) =>
      s.dataType?.name === dataTypeName &&
      s.application?.name === APP_NAME
  );
  return own ? own.dataStreamId : null;
}

/**
 * 新規にデータソースを作成する。
 * dataStreamId を渡した場合のみリクエストに含める（形式が正しければサーバーが採用）。
 */
async function createDataSource(
  accessToken: string,
  dataTypeName: string,
  fieldName: string,
  dataStreamName: string,
  optionalDataStreamId: string | null
): Promise<string> {
  const body: Record<string, unknown> = {
    type: "derived",
    application: { name: APP_NAME },
    dataStreamName,
    dataType: {
      name: dataTypeName,
      field: [{ name: fieldName, format: "floatPoint" }],
    },
  };
  if (optionalDataStreamId) body.dataStreamId = optionalDataStreamId;

  const createRes = await fetch(`${FIT_BASE}/dataSources`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create data source: ${createRes.status} ${errText}`);
  }
  const created = (await createRes.json()) as { dataStreamId: string };
  return created.dataStreamId;
}

/**
 * 指定データ型について、自作アプリ専用のデータソースを取得または作成する。
 * 1) GOOGLE_PROJECT_NUMBER がある場合: 固定形式の dataSourceId で GET → あれば利用、なければその ID で作成を試行。
 * 2) 一覧から application.name が自アプリのものを検索して利用。
 * 3) いずれもなければ、新規作成（dataStreamId はサーバー生成）してその ID を利用。
 */
async function findOrCreateDataSource(
  accessToken: string,
  dataTypeName: string,
  fieldName: string,
  streamSuffix: string
): Promise<string> {
  const explicitId = buildAppDataSourceId(dataTypeName, streamSuffix);
  const dataStreamName = `MyHealthApp_${streamSuffix}`;

  if (explicitId) {
    const existing = await getDataSourceIfExists(accessToken, explicitId);
    if (existing) return existing;
    try {
      return await createDataSource(
        accessToken,
        dataTypeName,
        fieldName,
        dataStreamName,
        explicitId
      );
    } catch {
      const ownFromList = await findOwnDataSourceFromList(accessToken, dataTypeName);
      if (ownFromList) return ownFromList;
      return await createDataSource(
        accessToken,
        dataTypeName,
        fieldName,
        dataStreamName,
        null
      );
    }
  }

  const ownFromList = await findOwnDataSourceFromList(accessToken, dataTypeName);
  if (ownFromList) return ownFromList;

  return await createDataSource(
    accessToken,
    dataTypeName,
    fieldName,
    dataStreamName,
    null
  );
}

/** 1つのデータポイントから数値を取り出す（value[0].fpVal または value[0].intVal） */
function getNumericValue(
  point: {
    value?: Array<{ fpVal?: number; intVal?: number }>;
  }
): number | null {
  const v = point?.value?.[0];
  if (v == null) return null;
  const num = v.fpVal != null ? v.fpVal : v.intVal != null ? v.intVal : null;
  return num != null && !Number.isNaN(num) ? num : null;
}

/** 小数点第1位で四捨五入 */
function roundToFirstDecimal(val: number): number {
  return Math.round(val * 10) / 10;
}

type DataPoint = {
  startTimeNanos?: string;
  endTimeNanos?: string;
  value?: Array<{ fpVal?: number; intVal?: number }>;
};

/** 複数の point から startTimeNanos が最大（＝最新）の1件の値を取得 */
function getLatestValueFromPoints(points: DataPoint[]): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => {
    const na = BigInt(a.startTimeNanos ?? 0);
    const nb = BigInt(b.startTimeNanos ?? 0);
    return nb > na ? 1 : nb < na ? -1 : 0;
  });
  return getNumericValue(sorted[0]);
}

type AggregateResponse = {
  bucket?: Array<{
    startTimeMillis?: number;
    endTimeMillis?: number;
    dataset?: Array<{ point?: DataPoint[] }>;
  }>;
};

function formatYmdJst(ms: number): string {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const d = new Date(ms + JST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type WeightTrendPoint = { date: string; weight: number | null };

/** dataset:aggregate で過去30日分の「日付」と「体重」を返す（1日ごとの最新値） */
async function fetchWeightTrend(accessToken: string): Promise<WeightTrendPoint[]> {
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DAYS = 30;

  // 直近の書き込みを拾いやすいよう end を少し未来に
  const endTimeMillis = nowMs + 60 * 1000;
  const startTimeMillis = endTimeMillis - DAYS * DAY_MS;

  const res = await fetch(`${FIT_BASE}/dataset:aggregate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startTimeMillis,
      endTimeMillis,
      aggregateBy: [{ dataTypeName: "com.google.weight" }],
      bucketByTime: { durationMillis: DAY_MS },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fit aggregate failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as AggregateResponse;
  const buckets = data.bucket ?? [];
  if (buckets.length === 0) {
    return Array.from({ length: DAYS }).map((_, i) => {
      const dayStart = startTimeMillis + i * DAY_MS;
      return { date: formatYmdJst(dayStart), weight: null };
    });
  }

  // 返却が 30 日より多い/少ないケースに備えて末尾 30 件に揃える
  const lastBuckets = buckets.slice(-DAYS);
  return lastBuckets.map((b) => {
    const points = b.dataset?.[0]?.point ?? [];
    const raw = getLatestValueFromPoints(points);
    const weight = raw != null ? roundToFirstDecimal(raw) : null;
    const date = formatYmdJst(
      typeof b.startTimeMillis === "number" ? b.startTimeMillis : startTimeMillis
    );
    return { date, weight };
  });
}

/** 1件のデータポイントを dataset に patch */
async function patchDataset(
  accessToken: string,
  dataSourceId: string,
  dataTypeName: string,
  value: number,
  startTimeNs: string,
  endTimeNs: string
): Promise<void> {
  const datasetId = `${startTimeNs}-${endTimeNs}`;
  const url = `${FIT_BASE}/dataSources/${encodeURIComponent(dataSourceId)}/datasets/${encodeURIComponent(datasetId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dataSourceId,
      minStartTimeNs: startTimeNs,
      maxEndTimeNs: endTimeNs,
      point: [
        {
          startTimeNanos: startTimeNs,
          endTimeNanos: endTimeNs,
          dataTypeName,
          value: [{ fpVal: value }],
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fit API patch failed: ${res.status} ${errText}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const accessToken = token?.access_token as string | undefined;
    if (!accessToken) {
      return NextResponse.json(
        { error: "ログインが必要です" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const weight = body.weight != null ? Number(body.weight) : NaN;
    const bodyFat = body.bodyFat != null ? Number(body.bodyFat) : NaN;

    if (Number.isNaN(weight) && Number.isNaN(bodyFat)) {
      return NextResponse.json(
        { error: "体重または体脂肪率のいずれかを入力してください" },
        { status: 400 }
      );
    }

    const startTimeNs = nowNanos();
    const endTimeNs = startTimeNs;

    if (!Number.isNaN(weight)) {
      const weightDataSourceId = await findOrCreateDataSource(
        accessToken,
        "com.google.weight",
        "weight",
        "weight_input"
      );
      await patchDataset(
        accessToken,
        weightDataSourceId,
        "com.google.weight",
        weight,
        startTimeNs,
        endTimeNs
      );
    }

    if (!Number.isNaN(bodyFat)) {
      const bodyFatDataSourceId = await findOrCreateDataSource(
        accessToken,
        "com.google.body.fat.percentage",
        "percentage",
        "body_fat_input"
      );
      await patchDataset(
        accessToken,
        bodyFatDataSourceId,
        "com.google.body.fat.percentage",
        bodyFat,
        startTimeNs,
        endTimeNs
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Fit API error:", err);
    const message = err instanceof Error ? err.message : "保存に失敗しました";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const accessToken = token?.access_token as string | undefined;
    if (!accessToken) {
      return NextResponse.json(
        { error: "ログインが必要です" },
        { status: 401 }
      );
    }
    const trend = await fetchWeightTrend(accessToken);
    return NextResponse.json(trend);
  } catch (err) {
    console.error("Fit API GET error:", err);
    const message = err instanceof Error ? err.message : "取得に失敗しました";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
