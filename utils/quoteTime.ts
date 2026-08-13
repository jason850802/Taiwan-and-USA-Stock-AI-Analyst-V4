const pad2 = (value: number): string => String(value).padStart(2, '0');

export function formatQuoteTime(fetchedAtMs: number, nowMs: number): string {
  const fetchedAt = new Date(fetchedAtMs);
  const now = new Date(nowMs);
  const time = `${pad2(fetchedAt.getHours())}:${pad2(fetchedAt.getMinutes())}`;
  const isSameDay = fetchedAt.getFullYear() === now.getFullYear()
    && fetchedAt.getMonth() === now.getMonth()
    && fetchedAt.getDate() === now.getDate();
  if (isSameDay) return time;
  return `${pad2(fetchedAt.getMonth() + 1)}/${pad2(fetchedAt.getDate())} ${time}`;
}
