import { timingSafeEqual } from 'crypto';
import { getAllowedOrigins, getSharedSecret } from './config.js';
import { checkRateLimit, getClientIp, type RateLimiter } from './ratelimit.js';

type HeaderValue = string | string[] | undefined;

function getHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 從 URL 字串取出 host（含 port，如 example.com 或 localhost:3000），解析失敗回 undefined。 */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * 同源判定：請求的 Origin/Referer host 是否等於部署自己的 host。
 * 同源請求（前端與 /api 在同一部署網域）在資安上必然安全——跨站攻擊者無法讓
 * 瀏覽器把 Host 改成我方網域，因此不會成為濫用破口。放行同源可避免 ALLOWED_ORIGIN
 * 未設/漏設時網站鎖死自己的 API，也讓每次變動的 Vercel preview 網址免白名單即可運作。
 * 跨站來源仍會落到 ALLOWED_ORIGIN 白名單與 PROXY_SHARED_SECRET 檢查。
 */
function isSameOrigin(req: GuardReq): boolean {
  const host = getHeaderValue(req.headers['x-forwarded-host']) || getHeaderValue(req.headers.host);
  if (!host) return false;
  const originHost = hostOf(getHeaderValue(req.headers.origin));
  if (originHost) return originHost === host;
  const refererHost = hostOf(getHeaderValue(req.headers.referer));
  if (refererHost) return refererHost === host;
  return false;
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

  // 同源請求永遠放行（見 isSameOrigin 說明）：避免白名單漏設時網站鎖死自己的 API。
  if (isSameOrigin(req)) {
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
