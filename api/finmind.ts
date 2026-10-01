import { applyGuards } from './_lib/guard.js';
import {
  FinMindClassifiedError,
  cacheSecondsForDataset,
  classifyFinMindError,
  validateFinMindParams,
  type FinMindErrorCode,
} from './_lib/finmind.js';
import { marketPerMin } from './_lib/ratelimit.js';
import { connectClientAbort } from './_lib/clientAbort.js';

interface FinMindReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  aborted?: boolean;
  on?(event: 'aborted', listener: () => void): void;
  off?(event: 'aborted', listener: () => void): void;
}

interface FinMindRes {
  status(code: number): FinMindRes;
  setHeader(name: string, value: string): void;
  end(): void;
  json(data: unknown): void;
  writableFinished?: boolean;
  destroyed?: boolean;
  on?(event: 'close', listener: () => void): void;
  off?(event: 'close', listener: () => void): void;
}

const statusByCode: Record<FinMindErrorCode, number> = {
  BAD_REQUEST: 400,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
};

export const maxDuration = 30;

export default async function handler(req: FinMindReq, res: FinMindRes) {
  const client = connectClientAbort(req, res);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

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

    timeoutId = setTimeout(() => client.controller.abort(), 15000);
    const { dataset, dataId, startDate } = validateFinMindParams(req.query);
    const upstreamUrl = new URL('https://api.finmindtrade.com/api/v4/data');
    upstreamUrl.searchParams.set('dataset', dataset);

    if (dataId) {
      upstreamUrl.searchParams.set('data_id', dataId);
    }

    if (startDate) {
      upstreamUrl.searchParams.set('start_date', startDate);
    }

    const token = process.env.FINMIND_TOKEN;
    if (token) {
      upstreamUrl.searchParams.set('token', token);
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      signal: client.signal,
    });
    if (client.disconnected) return;
    const json = await upstreamResponse.json() as {
      status?: number;
      msg?: string;
    };
    if (client.disconnected) return;

    if (!upstreamResponse.ok) {
      const message = typeof json.msg === 'string' ? json.msg : '';
      throw new FinMindClassifiedError(
        upstreamResponse.status === 402 || upstreamResponse.status === 429 || /upper\s*limit/i.test(message)
          ? 'RATE_LIMITED'
          : 'UPSTREAM_ERROR',
      );
    }

    if (typeof json.status === 'number' && json.status !== 200) {
      throw new FinMindClassifiedError(
        /upper\s*limit|rate\s*limit/i.test(json.msg || '')
          ? 'RATE_LIMITED'
          : 'UPSTREAM_ERROR',
      );
    }

    res.setHeader(
      'Cache-Control',
      `public, s-maxage=${cacheSecondsForDataset(dataset)}, stale-while-revalidate=60`,
    );
    res.status(200).json(json);
  } catch (error) {
    if (client.disconnected) return;
    const classifiedError = error instanceof FinMindClassifiedError
      ? error
      : classifyFinMindError(error);

    console.error(`[finmind:${classifiedError.code}] ${classifiedError.message}`);
    res.status(statusByCode[classifiedError.code]).json({
      code: classifiedError.code,
      message: classifiedError.message,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    client.dispose();
  }
}
