import { describe, expect, it } from 'vitest';
import { formatQuoteTime } from './quoteTime';

describe('formatQuoteTime', () => {
  it('同日只顯示本機 24 小時制的 HH:mm', () => {
    const fetchedAt = new Date(2026, 7, 13, 9, 5).getTime();
    const now = new Date(2026, 7, 13, 18, 30).getTime();

    expect(formatQuoteTime(fetchedAt, now)).toBe('09:05');
  });

  it('跨日顯示本機 MM/DD HH:mm', () => {
    const fetchedAt = new Date(2026, 7, 12, 23, 4).getTime();
    const now = new Date(2026, 7, 13, 0, 1).getTime();

    expect(formatQuoteTime(fetchedAt, now)).toBe('08/12 23:04');
  });

  it('跨月且日號相同仍顯示日期', () => {
    const fetchedAt = new Date(2026, 6, 13, 8, 7).getTime();
    const now = new Date(2026, 7, 13, 8, 8).getTime();

    expect(formatQuoteTime(fetchedAt, now)).toBe('07/13 08:07');
  });

  it('跨年且月日相同仍顯示日期', () => {
    const fetchedAt = new Date(2025, 7, 13, 23, 59).getTime();
    const now = new Date(2026, 7, 13, 0, 1).getTime();

    expect(formatQuoteTime(fetchedAt, now)).toBe('08/13 23:59');
  });
});
