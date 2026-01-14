import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot } from 'lucide-react';

interface AnalysisResultProps {
  content: string;
  loading: boolean;
}

const AnalysisResult: React.FC<AnalysisResultProps> = ({ content, loading }) => {
  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700 animate-pulse flex flex-col items-center justify-center min-h-[300px]">
        <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center mb-4">
            <Bot className="text-blue-400 animate-bounce" size={24} />
        </div>
        <p className="text-slate-400 text-sm">AI Analyst is thinking...</p>
        <p className="text-slate-500 text-xs mt-2">Analyzing technical patterns, MA support, and volume trends</p>
      </div>
    );
  }

  if (!content) return null;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl mb-10">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center gap-3">
        <Bot className="text-white" size={24} />
        <h2 className="text-xl font-bold text-white tracking-wide">AI 技術分析報告</h2>
      </div>
      <div className="p-8 text-slate-300">
        <ReactMarkdown
            components={{
                // H2 for the Main Decision (Investment Suggestion)
                h2: ({node, ...props}) => (
                    <h2 className="text-2xl font-extrabold text-white mt-2 mb-6 pb-4 border-b border-slate-700 flex flex-wrap gap-2 items-center" {...props} />
                ),
                // H3 for the 3 Main Sections (Key Signals, Chips, Strategy)
                // Added border-t for separator line as requested
                h3: ({node, ...props}) => (
                    <h3 className="text-xl font-bold text-blue-300 mt-8 mb-4 pt-6 border-t border-slate-700 tracking-wide" {...props} />
                ),
                // H4 for the sub-sections (Bullish/Bearish)
                h4: ({node, children, ...props}) => {
                    const text = children?.toString() || "";
                    if (text.includes("空方") || text.includes("警示")) {
                        return <h4 className="text-lg font-bold text-red-400 mt-6 mb-3 border-l-4 border-red-500 pl-3 uppercase tracking-wider bg-red-500/5 py-1" {...props}>{children}</h4>;
                    }
                    if (text.includes("多方")) {
                        return <h4 className="text-lg font-bold text-emerald-400 mt-6 mb-3 border-l-4 border-emerald-500 pl-3 uppercase tracking-wider bg-emerald-500/5 py-1" {...props}>{children}</h4>;
                    }
                    return <h4 className="text-lg font-bold text-slate-200 mt-6 mb-3" {...props}>{children}</h4>;
                },
                // Custom logic for Bold text (Keywords/Sub-headers)
                strong: ({node, children, ...props}) => {
                    const text = children ? children.toString() : "";
                    
                    // 1. Keywords that should be RED (Bearish/Warning)
                    const bearishKeywords = [
                        "空", "賣", "壓", "背離", "過熱", "死叉", "死", "險", "弱", "跌", "破", "修正", "阻力", "頭部", "棄守", "減碼", "風險", "警示", "保守", "停損"
                    ];

                    // 2. Keywords that should be GREEN (Bullish/Positive)
                    const bullishKeywords = [
                        "多", "漲", "撐", "買", "金叉", "金", "上", "增", "強", "底", "攻", "守", "突破", "回升", "優勢", "佈局", "反彈", "利多", "站上", "獲利"
                    ];
                    
                    const isBearish = bearishKeywords.some(k => text.includes(k)) && !text.includes("突破"); // Prevent "突破" triggering "破"
                    const isBullish = bullishKeywords.some(k => text.includes(k));
                    
                    if (isBearish) {
                        return <strong className="text-red-400 font-bold mx-1" {...props}>{children}</strong>;
                    }
                    if (isBullish) {
                        return <strong className="text-emerald-400 font-bold mx-1" {...props}>{children}</strong>;
                    }
                    
                    // Default color for neutral bold text
                    return <strong className="text-blue-200 font-bold mx-1" {...props}>{children}</strong>;
                },
                ul: ({node, ...props}) => <ul className="space-y-3 my-4 pl-4" {...props} />,
                ol: ({node, ...props}) => <ol className="space-y-3 my-4 pl-4 list-decimal marker:text-blue-500" {...props} />,
                // Adjusted to text-slate-200 (Whiter) as requested
                li: ({node, ...props}) => <li className="text-slate-200 leading-relaxed pl-1" {...props} />,
                p: ({node, ...props}) => <p className="mb-4 leading-7 text-slate-200" {...props} />,
            }}
        >
            {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default AnalysisResult;