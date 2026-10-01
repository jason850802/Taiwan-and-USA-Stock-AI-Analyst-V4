import { applyGuards } from '../_lib/guard.js';
import {
  YahooClassifiedError,
  classifyYahooError,
  fetchYahooWithHandshake,
  validateChartParams,
  type YahooErrorCode,
} from '../_lib/yahoo.js';
import { marketPerMin } from '../_lib/ratelimit.js';
import { connectClientAbort } from '../_lib/clientAbort.js';

interface YahooReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  aborted?: boolean;
  on?(event: 'aborted', listener: () => void): void;
  off?(event: 'aborted', listener: () => void): void;
}

interface YahooRes {
  status(code: number): YahooRes;
  setHeader(name: string, value: string): void;
  end(): void;
  json(data: unknown): void;
  writableFinished?: boolean;
  destroyed?: boolean;
  on?(event: 'close', listener: () => void): void;
  off?(event: 'close', listener: () => void): void;
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
  const client = connectClientAbort(req, res);
  try {
    if (client.signal.aborted) return;
    if (!(await applyGuards(req, res, [marketPerMin])) || client.signal.aborted) return;

    if (req.method !== 'GET') {
      res.status(405).json({
        code: 'BAD_REQUEST',
        message: '僅支援 GET 請求。',
      });
      return;
    }

    const { symbol, interval, range } = validateChartParams(req.query);
    const upstreamResponse = await fetchYahooWithHandshake(({ crumb }) => (
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
      + `?interval=${interval}&range=${range}`
      + '&includeAdjustedClose=true&includePrePost=false&lang=zh-Hant-TW&region=TW'
      + `&crumb=${encodeURIComponent(crumb)}`
    ), client.signal);
    if (client.signal.aborted) return;
    const json = await upstreamResponse.json() as {
      chart?: { error?: { code?: string } | null };
    };
    if (client.signal.aborted) return;
    const chartError = json.chart?.error;

    if (chartError?.code === 'Not Found') {
      throw new YahooClassifiedError('NOT_FOUND');
    }

    if (chartError) {
      throw new YahooClassifiedError('UPSTREAM_ERROR');
    }

    // CDN 快取（僅 200 成功路徑；錯誤回應不設，分類錯誤不得被 CDN 快取）。
    // s-maxage 是 CDN 專屬指令、瀏覽器忽略——前端快取 TTL 判斷不受影響。
    // 安全取捨（有意為之，T-B1-01／覆核 M-2 更正數字）：同 URL 可能由 Vercel CDN 直接回應、
    // 不過 applyGuards 的視窗上界是 s-maxage+swr＝60+300＝360 秒（swr 命中時 CDN 先回舊資料
    // 再背景 revalidate），非僅 60 秒——行情為公開資料、cache miss 仍全額過 guard 與限流，
    // 且 CDN 命中不消耗 function invocation（反而降低濫用成本），360 秒上界仍在可接受範圍。
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(json);
  } catch (error) {
    if (client.signal.aborted) return;
    const classifiedError = error instanceof YahooClassifiedError
      ? error
      : classifyYahooError(error);

    console.error(`[yahoo-chart:${classifiedError.code}] ${classifiedError.message}`);
    res.status(statusByCode[classifiedError.code]).json({
      code: classifiedError.code,
      message: classifiedError.message,
    });
  } finally {
    client.dispose();
  }
}
