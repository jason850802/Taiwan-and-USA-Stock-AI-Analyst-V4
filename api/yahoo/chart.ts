import { applyGuards } from '../_lib/guard.js';
import {
  YahooClassifiedError,
  classifyYahooError,
  fetchYahooWithHandshake,
  validateChartParams,
  type YahooErrorCode,
} from '../_lib/yahoo.js';
import { marketPerMin } from '../_lib/ratelimit.js';

interface YahooReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}

interface YahooRes {
  status(code: number): YahooRes;
  setHeader(name: string, value: string): void;
  end(): void;
  json(data: unknown): void;
}

const statusByCode: Record<YahooErrorCode, number> = {
  BAD_REQUEST: 400,
  UPSTREAM_UNAUTHORIZED: 502,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  NOT_FOUND: 404,
};

export const maxDuration = 30;

export default async function handler(req: YahooReq, res: YahooRes) {
  if (!(await applyGuards(req, res, [marketPerMin]))) return;

  if (req.method !== 'GET') {
    res.status(405).json({
      code: 'BAD_REQUEST',
      message: '僅支援 GET 請求。',
    });
    return;
  }

  try {
    const { symbol, interval, range } = validateChartParams(req.query);
    const upstreamResponse = await fetchYahooWithHandshake(({ crumb }) => (
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
      + `?interval=${interval}&range=${range}`
      + '&includeAdjustedClose=true&includePrePost=false&lang=zh-Hant-TW&region=TW'
      + `&crumb=${encodeURIComponent(crumb)}`
    ));
    const json = await upstreamResponse.json() as {
      chart?: { error?: { code?: string } | null };
    };
    const chartError = json.chart?.error;

    if (chartError?.code === 'Not Found') {
      throw new YahooClassifiedError('NOT_FOUND');
    }

    if (chartError) {
      throw new YahooClassifiedError('UPSTREAM_ERROR');
    }

    res.status(200).json(json);
  } catch (error) {
    const classifiedError = error instanceof YahooClassifiedError
      ? error
      : classifyYahooError(error);

    console.error(`[yahoo-chart:${classifiedError.code}] ${classifiedError.message}`);
    res.status(statusByCode[classifiedError.code]).json({
      code: classifiedError.code,
      message: classifiedError.message,
    });
  }
}
