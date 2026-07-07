import React from 'react';
import { Bot } from 'lucide-react';
import MarkdownReport from './ui/MarkdownReport';
import Skeleton from './ui/Skeleton';

interface AnalysisResultProps {
  content: string;
  loading: boolean;
}

const AnalysisResult: React.FC<AnalysisResultProps> = ({ content, loading }) => {
  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700 min-h-[300px]">
        <Skeleton variant="lines" lines={6} />
      </div>
    );
  }

  if (!content) return null;

  return (
    <div className="bg-surface-card rounded-card border border-surface-line overflow-hidden mb-10">
      <div className="bg-ai/15 px-6 py-4 flex items-center gap-3 border-b border-surface-line">
        <Bot className="text-ai" size={24} />
        <h2 className="text-xl font-bold text-ai tracking-wide">AI 技術分析報告</h2>
      </div>
      <div className="p-8 text-slate-300">
        <MarkdownReport content={content} />
      </div>
    </div>
  );
};

export default AnalysisResult;
