import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type HeaderValue = string | string[] | undefined;

export type RateLimiter = Ratelimit | null;

const upstashIsConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const redis = upstashIsConfigured ? Redis.fromEnv() : null;

function createRateLimiter(params: {
  limiter: ReturnType<typeof Ratelimit.slidingWindow>;
  prefix: string;
}): RateLimiter {
  if (!redis) {
    return null;
  }

  return new Ratelimit({
    redis,
    limiter: params.limiter,
    ephemeralCache: new Map(),
    timeout: 1000,
    analytics: false,
    prefix: params.prefix,
  });
}

export const geminiPerMin = createRateLimiter({
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  prefix: 'rl:gemini:min',
});

export const geminiPerDay = createRateLimiter({
  limiter: Ratelimit.slidingWindow(100, '1 d'),
  prefix: 'rl:gemini:day',
});

export const marketPerMin = createRateLimiter({
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  prefix: 'rl:market:min',
});

function getHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function getClientIp(req: {
  headers: Record<string, HeaderValue>;
}): string {
  const forwardedFor = getHeaderValue(req.headers['x-forwarded-for']);
  const realIp = getHeaderValue(req.headers['x-real-ip']);

  return forwardedFor?.split(',')[0]?.trim()
    || realIp?.trim()
    || '127.0.0.1';
}

export async function checkRateLimit(
  rateLimiters: RateLimiter[],
  ip: string,
): Promise<boolean> {
  const enabledLimiters = rateLimiters.filter(Boolean) as Ratelimit[];

  if (enabledLimiters.length === 0) {
    return true;
  }

  try {
    const results = await Promise.all(
      enabledLimiters.map(rateLimiter => rateLimiter.limit(ip)),
    );

    return results.every(result => result.success);
  } catch {
    console.warn('[guard] ratelimit unavailable, failing open');
    return true;
  }
}
