const secret = (import.meta as unknown as {
  env?: { VITE_PROXY_SECRET?: string };
}).env?.VITE_PROXY_SECRET;

export const proxyHeaders: Record<string, string> = secret
  ? { 'X-Proxy-Secret': secret }
  : {};
