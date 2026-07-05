import { getAllowedOrigins } from './config';

type HeaderValue = string | string[] | undefined;

function getHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isAllowedOrigin(req: {
  headers: Record<string, HeaderValue>;
}): boolean {
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
