import { applyGuards } from '../_lib/guard';
import {
  YahooClassifiedError,
  classifyYahooError,
  fetchYahooWithHandshake,
  validateSearchParams,
  type YahooErrorCode,
} from '../_lib/yahoo';
import { marketPerMin } from '../_lib/ratelimit';

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
    const { q, limit } = validateSearchParams(req.query);
    const upstreamResponse = await fetchYahooWithHandshake(({ crumb }) => (
      'https://query1.finance.yahoo.com/v1/finance/search'
      + `?q=${encodeURIComponent(q)}&quotesCount=${limit}`
      + '&newsCount=0&lang=zh-Hant-TW&region=TW'
      + `&crumb=${encodeURIComponent(crumb)}`
    ));
    const json = await upstreamResponse.json();

    res.status(200).json(json);
  } catch (error) {
    const classifiedError = error instanceof YahooClassifiedError
      ? error
      : classifyYahooError(error);

    console.error(`[yahoo-search:${classifiedError.code}] ${classifiedError.message}`);
    res.status(statusByCode[classifiedError.code]).json({
      code: classifiedError.code,
      message: classifiedError.message,
    });
  }
}
