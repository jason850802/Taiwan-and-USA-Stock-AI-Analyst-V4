// utils/statementParsers/xlsxReader.ts — 最小 xlsx 讀取器（Phase 11 追加，零依賴）
//
// 為什麼自己寫：券商匯出的 xlsx 常有非標準結構。實例——永豐金新版對帳單的空白儲存格
// 寫成 `<c r="C2" t="s" s="3"/>`（宣告是 shared string 卻沒有 <v> 值），
// read-excel-file 直接拋 `Invalid "shared" string index: undefined` 整份檔案讀不進來。
// 使用者每月都要匯入，解析器必須對這類瑕疵容錯而非整份放棄。
//
// 實作範圍刻意最小：只讀「第一張工作表的儲存格文字/數字」，這正是對帳單所需。
// 不支援公式計算、樣式、日期序號轉換（兩家券商的日期欄實測皆為文字）。

/** zip 目錄項目 */
interface ZipEntry { name: string; offset: number; compressed: boolean; size: number }

const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

/** 從 central directory 列出 zip 內檔案（比掃 local header 可靠） */
const listEntries = (buf: Uint8Array): ZipEntry[] => {
  // End of Central Directory：從尾端往前找簽章 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（找不到 zip 目錄）');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (u32(buf, p) !== 0x02014b50) break;
    const method = u16(buf, p + 10);
    const size = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const offset = u32(buf, p + 42);
    const name = new TextDecoder('utf-8').decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, offset, compressed: method === 8, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
};

/** 取出並解壓單一檔案內容 */
const readEntry = async (buf: Uint8Array, e: ZipEntry): Promise<string> => {
  // local file header：名稱與 extra 長度可能與 central directory 不同，必須重讀
  const p = e.offset;
  if (u32(buf, p) !== 0x04034b50) throw new Error(`zip 項目損毀：${e.name}`);
  const nameLen = u16(buf, p + 26);
  const extraLen = u16(buf, p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.size);
  if (!e.compressed) return new TextDecoder('utf-8').decode(raw);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  return new TextDecoder('utf-8').decode(new Uint8Array(await new Response(stream).arrayBuffer()));
};

// 標籤 regex 統一用「屬性非貪婪 ＋ 自閉合或開放兩選一」。
// ⚠️ 不可寫成 `<x[^>]*>...</x>|<x[^>]*/>`：`[^>]*` 會吃掉自閉合的 `/`，
// 使 `<c r="B1"/>` 被當成開放標籤而吞掉下一格內容（國泰 xlsx 的空儲存格即此寫法）。
const TAG_RE = (name: string) => new RegExp(`<${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${name}>)`, 'g');

/** <si> → 文字（含 rich text 的多個 <t> 需串接） */
const parseSharedStrings = (xml: string): string[] => {
  const out: string[] = [];
  const siRe = TAG_RE('si');
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[2] ?? '';
    let text = '';
    const tRe = TAG_RE('t');
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(inner)) !== null) text += t[2] ?? '';
    out.push(decodeXml(text));
  }
  return out;
};

const decodeXml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&');

/** 'C12' → 欄索引（0-based） */
const colIndex = (ref: string): number => {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * 讀取工作表為二維陣列。
 * 容錯要點：`t="s"` 但缺 <v>（自閉合空儲存格）→ 視為空值，不中斷整份解析。
 */
const parseSheet = (xml: string, shared: string[]): any[][] => {
  const rows: any[][] = [];
  const rowRe = TAG_RE('row');
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const attrs = rm[1] ?? '';
    const body = rm[2] ?? '';
    const rIdx = parseInt((attrs.match(/\br="(\d+)"/) || [])[1] ?? '0', 10) - 1;
    const cells: any[] = [];
    const cRe = TAG_RE('c');
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(body)) !== null) {
      const cAttrs = cm[1] ?? '';
      const cBody = cm[2] ?? '';
      const ref = (cAttrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const type = (cAttrs.match(/\bt="([^"]+)"/) || [])[1];
      const ci = ref ? colIndex(ref) : cells.length;

      let value: any = null;
      if (type === 'inlineStr') {
        let text = '';
        const tRe = TAG_RE('t');
        let t: RegExpExecArray | null;
        while ((t = tRe.exec(cBody)) !== null) text += t[2] ?? '';
        value = decodeXml(text);
      } else {
        const v = (cBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        if (v === undefined || v === '') {
          value = null;                             // ← 容錯核心：空儲存格即使宣告 t="s" 也不拋錯
        } else if (type === 's') {
          const idx = parseInt(v, 10);
          value = Number.isFinite(idx) && shared[idx] !== undefined ? shared[idx] : null;
        } else if (type === 'str' || type === 'e') {
          value = decodeXml(v);
        } else {
          const n = Number(v);
          value = Number.isFinite(n) ? n : decodeXml(v);
        }
      }
      while (cells.length < ci) cells.push(null);
      cells[ci] = value;
    }
    while (rows.length < rIdx) rows.push([]);
    if (rIdx >= 0) rows[rIdx] = cells; else rows.push(cells);
  }
  return rows;
};

/** 讀 xlsx 第一張工作表為二維陣列 */
export const readXlsxRows = async (file: Blob): Promise<any[][]> => {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = listEntries(buf);
  const find = (suffix: string) => entries.find(e => e.name.toLowerCase().endsWith(suffix));

  const sheetEntry =
    entries.find(e => /xl\/worksheets\/sheet1\.xml$/i.test(e.name)) ??
    entries.find(e => /xl\/worksheets\/.*\.xml$/i.test(e.name));
  if (!sheetEntry) throw new Error('xlsx 內找不到工作表');

  const ssEntry = find('xl/sharedstrings.xml');
  const shared = ssEntry ? parseSharedStrings(await readEntry(buf, ssEntry)) : [];
  return parseSheet(await readEntry(buf, sheetEntry), shared);
};
