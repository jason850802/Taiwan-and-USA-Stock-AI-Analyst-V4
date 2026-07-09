export type FinMindErrorCode =
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR';

const errorMessages: Record<FinMindErrorCode, string> = {
  BAD_REQUEST: 'FinMind 請求參數不正確，請確認資料集與股票代號設定。',
  RATE_LIMITED: 'FinMind 資料服務目前請求過於頻繁，請稍後再試一次。',
  UPSTREAM_ERROR: 'FinMind 資料服務暫時無法回應，請稍後再試。',
};

export class FinMindClassifiedError extends Error {
  code: FinMindErrorCode;

  constructor(code: FinMindErrorCode, message = errorMessages[code]) {
    super(message);
    this.name = 'FinMindClassifiedError';
    this.code = code;
  }
}

// 僅允許前端現有實際使用的 FinMind dataset，避免成為任意資料代理。
export const ALLOWED_DATASETS = [
  'TaiwanStockInstitutionalInvestorsBuySell',
  'TaiwanStockPrice',
  'TaiwanStockInfo',
] as const;

type AllowedDataset = typeof ALLOWED_DATASETS[number];

const ALLOWED_DATASET_SET = new Set<string>(ALLOWED_DATASETS);
const TAIWAN_DATA_ID_PATTERN = /^\d{3,6}[A-Z]?$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getQueryValue(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }

  return typeof value === 'string' ? value : '';
}

export function validateFinMindParams(query: {
  dataset?: unknown;
  data_id?: unknown;
  start_date?: unknown;
}): {
  dataset: AllowedDataset;
  dataId?: string;
  startDate?: string;
} {
  const dataset = getQueryValue(query.dataset).trim();
  const rawDataId = getQueryValue(query.data_id).trim();
  const startDate = getQueryValue(query.start_date).trim();
  const dataId = rawDataId
    .replace(/\.TW$/i, '')
    .replace(/\.TWO$/i, '')
    .toUpperCase();

  if (!ALLOWED_DATASET_SET.has(dataset)) {
    throw new FinMindClassifiedError('BAD_REQUEST');
  }

  if (rawDataId && !TAIWAN_DATA_ID_PATTERN.test(dataId)) {
    throw new FinMindClassifiedError('BAD_REQUEST');
  }

  if (startDate && !DATE_PATTERN.test(startDate)) {
    throw new FinMindClassifiedError('BAD_REQUEST');
  }

  return {
    dataset: dataset as AllowedDataset,
    dataId: dataId || undefined,
    startDate: startDate || undefined,
  };
}

export function secondsUntilTaipeiMidnight(): number {
  const now = new Date();
  const taipeiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const partMap: Record<string, string> = {};
  taipeiParts.forEach(({ type, value }) => {
    partMap[type] = value;
  });

  const taipeiAsUtc = Date.UTC(
    Number(partMap.year),
    Number(partMap.month) - 1,
    Number(partMap.day),
    Number(partMap.hour) === 24 ? 0 : Number(partMap.hour),
    Number(partMap.minute),
    Number(partMap.second),
  );
  const nextMidnightAsUtc = Date.UTC(
    Number(partMap.year),
    Number(partMap.month) - 1,
    Number(partMap.day) + 1,
    0,
    0,
    0,
  );
  const seconds = Math.floor((nextMidnightAsUtc - taipeiAsUtc) / 1000);

  return Math.max(60, seconds);
}

export function classifyFinMindError(error: unknown): FinMindClassifiedError {
  if (error instanceof FinMindClassifiedError) {
    return error;
  }

  const errorRecord = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const status = typeof errorRecord.status === 'number'
    ? errorRecord.status
    : Number(errorRecord.status);
  const name = typeof errorRecord.name === 'string' ? errorRecord.name : '';
  const message = error instanceof Error ? error.message : String(error || '');

  if (status === 402 || status === 429 || /upper\s*limit|rate\s*limit/i.test(message)) {
    return new FinMindClassifiedError('RATE_LIMITED');
  }

  if (name === 'AbortError' || /aborted|aborterror|timed?\s*out/i.test(message)) {
    return new FinMindClassifiedError('UPSTREAM_ERROR');
  }

  return new FinMindClassifiedError('UPSTREAM_ERROR');
}
