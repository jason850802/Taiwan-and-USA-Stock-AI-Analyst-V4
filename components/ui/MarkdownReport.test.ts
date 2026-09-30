// components/ui/MarkdownReport.test.ts — <br> 換行處理鎖
//
// Claude 常在表格儲存格用 <br> 換行；react-markdown 不渲染原始 HTML，沒處理時會把 "<br>"
// 當文字原樣顯示。這裡守住「拆成真正的換行元素」，並確認粗體與表格結構不受影響。
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownReport from './MarkdownReport';

const render = (content: string) =>
  renderToStaticMarkup(React.createElement(MarkdownReport, { content }));

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('MarkdownReport 的 <br> 換行', () => {
  it('表格儲存格內的 <br> 與 <br/> 轉成真正的換行元素，不以文字顯示', () => {
    const html = render([
      '| 步驟 | 內容 |',
      '|---|---|',
      '| 趨勢 | **解讀原因**：多頭。<br> **多空意義**：偏多。<br/> **紀律**：不追高。 |',
    ].join('\n'));

    expect(html).not.toContain('&lt;br');
    expect(count(html, /<br\/?>/g)).toBe(2);
    // 粗體與表格結構不受影響
    expect(html).toContain('<td');
    expect(count(html, /<strong/g)).toBe(3);
  });

  it('段落與清單項目內的 <br> 同樣處理', () => {
    const html = render(['段落一<br>段落二', '', '- 清單一<br>清單二'].join('\n'));

    expect(html).not.toContain('&lt;br');
    expect(count(html, /<br\/?>/g)).toBe(2);
  });

  it('沒有 <br> 的內容維持原樣', () => {
    const html = render('一般段落，含 **粗體** 與 a < b。');

    expect(html).not.toContain('<br');
    expect(html).toContain('a &lt; b');
  });
});
