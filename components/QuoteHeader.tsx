import React from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { StockInfo } from '../types';
import { VolumeProjection } from '../utils/volume';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Card from './ui/Card';

interface QuoteHeaderProps {
  info: StockInfo;
  price: number;
  changeAbs: number;
  changePct: number;
  volume: number;
  volumeProjection?: VolumeProjection | null;
  loading: boolean;
  refreshing: boolean;
  analyzing: boolean;
  hasData: boolean;
  onRefresh: () => void;
  onAnalyze: () => void;
}

const QuoteHeader: React.FC<QuoteHeaderProps> = ({
  info,
  price,
  changeAbs,
  changePct,
  volume,
  volumeProjection,
  loading,
  refreshing,
  analyzing,
  hasData,
  onRefresh,
  onAnalyze,
}) => {
  const isUp = changeAbs >= 0;
  const sign = isUp ? '+' : '';

  return (
    <Card className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap min-w-0">
        <div className="min-w-0">
          <p className="text-lg font-medium text-white truncate">{info.name}</p>
          <p className="text-xs text-slate-400 font-mono">{info.symbol}</p>
        </div>
        <p className="text-3xl font-mono tabular-nums text-white">{price.toFixed(2)}</p>
        <Badge variant={isUp ? 'up' : 'down'}>
          <span className="font-mono tabular-nums">
            {isUp ? '▲' : '▼'} {sign}{changeAbs.toFixed(2)}（{sign}{changePct.toFixed(2)}%）
          </span>
        </Badge>
        <div className="text-xs text-slate-400 font-mono tabular-nums">
          <span>成交量 {volume.toLocaleString()}</span>
          {volumeProjection && volumeProjection.status !== 'Insufficient' && (
            <span className="ml-3">
              {volumeProjection.status === 'Intraday'
                ? `預估 ${volumeProjection.projectedVolume.toLocaleString()}`
                : `量變化 ${volumeProjection.changePercent >= 0 ? '+' : ''}${volumeProjection.changePercent.toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <Button
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing || loading || !hasData}
          className="inline-flex items-center gap-2"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '更新中...' : '更新'}
        </Button>
        <Button
          variant="ai"
          onClick={onAnalyze}
          disabled={analyzing || loading || !hasData}
          className="inline-flex items-center gap-2"
        >
          <Bot size={16} className={analyzing ? 'animate-pulse' : ''} />
          AI 分析
        </Button>
      </div>
    </Card>
  );
};

export default QuoteHeader;
