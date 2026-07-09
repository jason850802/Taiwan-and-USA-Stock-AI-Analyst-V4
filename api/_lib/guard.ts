import { timingSafeEqual } from 'crypto';
import { getAllowedOrigins, getSharedSecret } from './config';
import { checkRateLimit, getClientIp, type RateLimiter } from './ratelimit';

type HeaderValue = string | string[] | undefined;

function getHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface GuardReq {
  method?: string;
  headers: Record<string, HeaderValue>;
}

interface GuardRes {
  status(code: number): GuardRes;
  json(data: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}

export function isAllowedOrigin(req: GuardReq): boolean {
  const origin = getHeaderValue(req.headers.origin);
  const referer = getHeaderValue(req.headers.referer);

  if (!origin && !referer) {
    return true;
  }

  return getAllowedOrigins().some(allowedOrigin => {
    const normalizedOrigin = origin?.replace(/\/$/, '');
    const refererMatches = referer === allowedOrigin
      || referer?.startsWith(`${allowedOrigin}/`);

    return normalizedOrigin === allowedOrigin || refererMatches;
  });
}

export function setCorsHeaders(res: GuardRes, origin?: string): void {
  const normalizedOrigin = origin?.replace(/\/$/, '');
  const matchedOrigin = getAllowedOrigins().find(
    allowedOrigin => normalizedOrigin === allowedOrigin,
  );

  if (matchedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', matchedOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function checkSharedSecret(req: GuardReq): boolean {
  const expected = getSharedSecret();
  if (!expected) {
    return true;
  }

  const received = getHeaderValue(req.headers['x-proxy-secret']) || '';
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function applyGuards(
  req: GuardReq,
  res: GuardRes,
  rateLimiters: RateLimiter[],
): Promise<boolean> {
  setCorsHeaders(res, getHeaderValue(req.headers.origin));

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }

  if (!isAllowedOrigin(req)) {
    res.status(403).json({
      code: 'BAD_REQUEST',
      message: '請求來源不被允許。',
    });
    return false;
  }

  if (!checkSharedSecret(req)) {
    res.status(403).json({
      code: 'BAD_REQUEST',
      message: '請求未通過驗證。',
    });
    return false;
  }

  const rateLimitIsOk = await checkRateLimit(rateLimiters, getClientIp(req));
  if (!rateLimitIsOk) {
    res.status(429).json({
      code: 'RATE_LIMITED',
      message: '請求過於頻繁，請稍後再試。',
    });
    return false;
  }

  return true;
}
