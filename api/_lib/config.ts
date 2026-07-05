export type GeminiMode = 'fast' | 'thinking';

export function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

export function getModelForMode(mode: GeminiMode): string {
  if (mode === 'thinking') {
    return process.env.GEMINI_MODEL_THINKING || 'gemini-3.1-pro-preview';
  }

  return process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash';
}

export function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.ALLOWED_ORIGIN;
  if (!configuredOrigins) {
    return ['http://localhost:3000'];
  }

  const origins = configuredOrigins
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return origins.length > 0 ? origins : ['http://localhost:3000'];
}
