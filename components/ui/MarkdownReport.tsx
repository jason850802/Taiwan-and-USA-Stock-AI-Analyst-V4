import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownReportProps {
  content: string;
}

const MarkdownReport: React.FC<MarkdownReportProps> = ({ content }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
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
