import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownReportProps {
  content: string;
}

// hast（HTML 語法樹）節點只用到這幾個欄位；自訂最小型別，不直接依賴 react-markdown 底下的型別套件。
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const BR_TAG = /^<br\s*\/?>$/i;
const SUB_OPEN = /^<sub>$/i;
const SUB_CLOSE = /^<\/sub>$/i;

const isRawTag = (node: HastNode, tag: RegExp) => node.type === 'raw' && tag.test(node.value ?? '');

const toElement = (tagName: string, children: HastNode[] = []): HastNode =>
  ({ type: 'element', tagName, properties: {}, children });

// react-markdown 不渲染原始 HTML（會原樣顯示成文字），Claude 卻常在表格儲存格用 <br> 換行、在結尾用 <sub>…</sub> 標小字免責。
// 只把這兩種無屬性標籤轉成真元素：<sub> 須在同一層成對才轉，落單的與其他 HTML 仍照原樣顯示成文字。
const convertInlineTags = (nodes: HastNode[]): HastNode[] => {
  const out: HastNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (isRawTag(node, BR_TAG)) {
      out.push(toElement('br'));
      continue;
    }
    if (isRawTag(node, SUB_OPEN)) {
      const close = nodes.findIndex((n, j) => j > i && isRawTag(n, SUB_CLOSE));
      if (close !== -1) {
        out.push(toElement('sub', convertInlineTags(nodes.slice(i + 1, close))));
        i = close;
        continue;
      }
    }
    if (node.children) node.children = convertInlineTags(node.children);
    out.push(node);
  }
  return out;
};

// rehype 外掛：在 react-markdown 把剩下的 raw 節點轉成文字之前執行，所以分得出「真 HTML」與長得像標籤的文字。
const rehypeInlineTags = () => (tree: HastNode) => {
  tree.children = convertInlineTags(tree.children ?? []);
};

const MarkdownReport: React.FC<MarkdownReportProps> = ({ content }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeInlineTags]}
    components={{
      h2: ({node, ...props}) => (
        <h2 className="text-2xl font-extrabold text-white mt-2 mb-6 pb-4 border-b border-slate-700 flex flex-wrap gap-2 items-center" {...props} />
      ),
      h3: ({node, ...props}) => (
        <h3 className="text-xl font-bold text-blue-300 mt-8 mb-4 pt-6 border-t border-slate-700 tracking-wide" {...props} />
      ),
      h4: ({node, children, ...props}) => {
        const text = children?.toString() || "";
        if (text.includes("空方") || text.includes("警示") || text.includes("出場") || text.includes("減碼")) {
          return <h4 className="text-lg font-bold text-danger mt-6 mb-3 border-l-4 border-danger pl-3 uppercase tracking-wider bg-danger-muted py-1" {...props}>{children}</h4>;
        }
        if (text.includes("多方") || text.includes("進場") || text.includes("獲利") || text.includes("停利")) {
          return <h4 className="text-lg font-bold text-ok mt-6 mb-3 border-l-4 border-ok pl-3 uppercase tracking-wider bg-ok-muted py-1" {...props}>{children}</h4>;
        }
        return <h4 className="text-lg font-bold text-slate-200 mt-6 mb-3" {...props}>{children}</h4>;
      },
      strong: ({node, children, ...props}) => {
        const text = children ? children.toString() : "";

        const bearishKeywords = [
          "空", "賣", "壓", "背離", "過熱", "死叉", "死", "險", "弱", "跌", "破", "修正", "阻力", "頭部", "棄守", "減碼", "風險", "警示", "保守", "停損"
        ];

        const bullishKeywords = [
          "多", "漲", "撐", "買", "金叉", "金", "上", "增", "強", "底", "攻", "守", "突破", "回升", "優勢", "佈局", "反彈", "利多", "站上", "獲利", "停利"
        ];

        const isBearish = bearishKeywords.some(k => text.includes(k)) && !text.includes("突破");
        const isBullish = bullishKeywords.some(k => text.includes(k));

        if (isBearish) {
          return <strong className="text-danger font-bold mx-1" {...props}>{children}</strong>;
        }
        if (isBullish) {
          return <strong className="text-ok font-bold mx-1" {...props}>{children}</strong>;
        }

        return <strong className="text-blue-200 font-bold mx-1" {...props}>{children}</strong>;
      },
      ul: ({node, ...props}) => <ul className="space-y-3 my-4 pl-4" {...props} />,
      ol: ({node, ...props}) => <ol className="space-y-3 my-4 pl-4 list-decimal marker:text-blue-500" {...props} />,
      li: ({node, ...props}) => <li className="text-slate-200 leading-relaxed pl-1" {...props} />,
      p: ({node, ...props}) => <p className="mb-4 leading-7 text-slate-200" {...props} />,
      table: ({node, ...props}) => (
        <div className="overflow-x-auto my-4">
          <table className="w-full text-sm border-collapse" {...props} />
        </div>
      ),
      thead: ({node, ...props}) => <thead className="bg-surface-inset" {...props} />,
      tbody: ({node, ...props}) => <tbody className="divide-y divide-surface-line" {...props} />,
      tr: ({node, ...props}) => <tr className="hover:bg-surface-inset/60 transition-colors" {...props} />,
      th: ({node, ...props}) => (
        <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 border border-surface-line" {...props} />
      ),
      td: ({node, ...props}) => (
        <td className="px-3 py-2 text-sm text-slate-200 align-top border border-surface-line" {...props} />
      ),
    }}
  >
    {content}
  </ReactMarkdown>
);

export default MarkdownReport;
