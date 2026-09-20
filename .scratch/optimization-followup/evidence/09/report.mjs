// 固定 UTF-8 100 KiB 合成報告；標題、表格、清單與段落邊界會被1,000片段切開。
export function reportFor(tag = 'PRIMARY', size = 102400) {
  const title = `合成串流 ${tag}`;
  const heading = '分段邊界驗收';
  const prefix = `# ${title}\n\n## ${heading}\n\n| 代碼 | 狀態 |\n| --- | --- |\n| AAPL | 假資料 |\n| MSFT | 等待 |\n\n- 第一項\n- 第二項\n\n`;
  const suffix = `\n\n**報告結束 ${tag}**\n`;
  const available = Math.max(0, size - new TextEncoder().encode(prefix + suffix).length);
  const paragraph = 'abcdefghijklmnopqrstuvwxyz0123456789 '.repeat(Math.ceil(available / 37)).slice(0, available);
  const text = prefix + paragraph + suffix;
  const characters = Array.from(text);
  const chunks = Array.from({ length: 1000 }, (_, i) => characters.slice(Math.floor(i * characters.length / 1000), Math.floor((i + 1) * characters.length / 1000)).join(''));
  return { text, chunks, bytes: new TextEncoder().encode(text).length,
    visible: `${title} ${heading} 代碼 狀態 AAPL 假資料 MSFT 等待 第一項 第二項 ${paragraph} 報告結束 ${tag}` };
}

export const partialWarning = '\n\n> ⚠️ 報告生成中斷——以上為部分內容，可按「AI 分析」重試。';
