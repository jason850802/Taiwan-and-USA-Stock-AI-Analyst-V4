import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Cell,
  ReferenceLine,
  // recharts 3.x public hooks — used by CursorPriceLine (in-chart, no internal imports)
  useActiveTooltipDataPoints,
  useYAxisScale,
  usePlotArea
} from 'recharts';
import { StockDataPoint, IndicatorSettings, MALineConfig } from '../types';
import { calculateSMA } from '../utils/math';
import { ZoomIn, ZoomOut } from 'lucide-react';
import Badge from './ui/Badge';

interface StockChartProps {
  data: StockDataPoint[];
  settings: IndicatorSettings;
  isTaiwanStock: boolean;
  chipDataUnavailable?: boolean;
  onToggleSetting?: (key: keyof IndicatorSettings) => void;
}

// ----------------------------------------------------------------------
// 1. Custom Shapes & Tooltips
// ----------------------------------------------------------------------

// Custom crosshair cursor — vertical line centered on the active bar
const CrosshairCursor = (props: any) => {
  const { points, width, height, top, left } = props;
  if (!points || points.length === 0) return null;
  const x = points[0].x;
  return (
    <line x1={x} y1={top} x2={x} y2={top + height} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
  );
};

const CandleStickShape = (props: any) => {
  const { x, y, width, height, payload } = props;
  const { open, close, high, low } = payload;

  // Guard
  if (!open || !close || width <= 0 || height <= 0) return null;

  const isUp   = close > open;
  const isDown = close < open;
  const color  = isUp ? '#f0405a' : isDown ? '#22c55e' : '#94a3b8'; // token: up 紅漲 / down 綠跌
  const centerX = x + width / 2;

  // candleBody is now [low, high], so:
  //   y           = pixel position of high  (top)
  //   y + height  = pixel position of low   (bottom)
  const ratio = (high !== low) ? height / (high - low) : 0;

  // Pixel positions of open / close
  const yOpen  = y + (high - open)  * ratio;
  const yClose = y + (high - close) * ratio;

  const yBodyTop    = Math.min(yOpen, yClose);
  const yBodyBottom = Math.max(yOpen, yClose);
  const bodyHeight  = yBodyBottom - yBodyTop;

  // Doji: open ≈ close → draw a cross (十字線)
  if (bodyHeight < 1) {
    const yMid = (yBodyTop + yBodyBottom) / 2;
    return (
      <g>
        {/* 上下引線 */}
        <line x1={centerX} y1={y}          x2={centerX} y2={y + height} stroke={color} strokeWidth={1} />
        {/* 橫線（實體） */}
        <line x1={x} y1={yMid} x2={x + width} y2={yMid} stroke={color} strokeWidth={1.5} />
      </g>
    );
  }

  return (
    <g>
      {/* 上引線 */}
      <line x1={centerX} y1={y}          x2={centerX} y2={yBodyTop}    stroke={color} strokeWidth={1} />
      {/* 下引線 */}
      <line x1={centerX} y1={yBodyBottom} x2={centerX} y2={y + height} stroke={color} strokeWidth={1} />
      {/* 實體 */}
      <rect x={x} y={yBodyTop} width={width} height={bodyHeight} fill={color} stroke="none" />
    </g>
  );
};

// 註：主圖單根 OHLC 浮動框（原 MainTooltip）已移除，改為 header 內固定資訊列
// （見 StockChart 的 activeData 讀數列）。副圖的 Tooltip（ChipTooltip / MACDTooltip /
// IndicatorTooltip）維持浮動，不在本次調整範圍。

const ChipTooltip = ({ active, payload, title }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        let val = 0;
        if (title === "Foreign") val = data.foreignBuySell;
        if (title === "Trust") val = data.investmentTrustBuySell;

        const lots = Math.round(val / 1000);
        const colorClass = lots > 0 ? "text-up" : lots < 0 ? "text-down" : "text-slate-400";

        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
                <p className="text-slate-400 mb-1 font-medium border-b border-slate-700 pb-1">{data.date}</p>
                <div className="flex justify-between gap-4">
                    <span className="text-slate-300 font-bold">{title}</span>
                    <span className={colorClass}>{lots > 0 ? '+' : ''}{lots.toLocaleString()} 張</span>
                </div>
            </div>
        );
    }
    return null;
}

const IndicatorTooltip = ({ active, payload, settings }: { active?: boolean, payload?: any[], settings: IndicatorSettings }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
                <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{data.date}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {settings.showRSI && (
                        <>
                            <span className="text-blue-400 font-bold">RSI (14)</span>
                            <span className="text-slate-200">{data.rsi?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {(settings.showK || settings.showD || settings.showJ) && (
                         <div className="col-span-2 border-t border-slate-800 my-1"></div>
                    )}

                    {settings.showK && (
                        <>
                        <span className="text-yellow-400 font-bold">K (5)</span>
                        <span className="text-slate-200">{data.k?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {settings.showD && (
                        <>
                        <span className="text-pink-400 font-bold">D (3)</span>
                        <span className="text-slate-200">{data.d?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {settings.showJ && (
                        <>
                        <span className="text-purple-400 font-bold">J (3)</span>
                        <span className="text-slate-200">{data.j?.toFixed(2)}</span>
                        </>
                    )}
                </div>
            </div>
        );
    }
    return null;
}

const MACDTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
                <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{data.date}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span className="text-orange-400 font-bold">DIF</span>
                    <span className="text-slate-200">{data.macd?.toFixed(2)}</span>
                    
                    <span className="text-cyan-400 font-bold">DEA</span>
                    <span className="text-slate-200">{data.macdSignal?.toFixed(2)}</span>
                    
                    <span className="text-slate-300 font-bold">Hist</span>
                    <span className={data.macdHist >= 0 ? 'text-up' : 'text-down'}>{data.macdHist?.toFixed(2)}</span>
                </div>
            </div>
        );
    }
    return null;
}

// ----------------------------------------------------------------------
// 2. Info Overlay Component
// ----------------------------------------------------------------------

const MALegend = ({ currentData, settings }: { currentData: any, settings: IndicatorSettings }) => {
    if (!currentData) return null;

    return (
        <div className="flex flex-wrap gap-2 items-center">
            {settings.maLines.filter(l => l.enabled).map((line) => {
                const key = `ma_${line.period}`;
                const dirKey = `ma_${line.period}_dir`;
                const value = currentData[key] as number | undefined;
                const dir = currentData[dirKey] as string | undefined;
                if (value === undefined) return null;
                const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
                const dirColor = dir === 'up' ? 'text-up' : dir === 'down' ? 'text-down' : 'text-slate-500';
                return (
                    <div key={key} className="flex items-center gap-1.5 text-xs font-mono bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
                        <span style={{ color: line.color }} className="font-bold">MA{line.period}</span>
                        <span className="text-slate-200">{value.toFixed(2)}</span>
                        <span className={`${dirColor} text-[10px]`}>{arrow}</span>
                    </div>
                );
            })}
        </div>
    );
};

// 固定 OHLC/量資訊列 —— 取代原浮動 MainTooltip，置於 header 區（非繪圖區），永不遮擋 K 棒。
// 讀 activeData：idle 顯示最新一根、hover 顯示該根（由 parent 的 activeData 決定）。
const OHLCInfoBar = ({ activeData, isTaiwanStock }: { activeData: any, isTaiwanStock: boolean }) => {
    if (!activeData) return null;

    // 顏色沿用原 MainTooltip：close>open 紅、<open 綠、平 灰（台股紅漲綠跌）
    const priceColor = activeData.close > activeData.open
        ? 'text-up'
        : activeData.close < activeData.open ? 'text-down' : 'text-slate-400';

    const priceChange = activeData.priceChange;
    const priceChangePercent = activeData.priceChangePercent;
    const isChangeUp = priceChange > 0;
    const isChangeDown = priceChange < 0;
    const changeColor = isChangeUp ? 'text-up' : isChangeDown ? 'text-down' : 'text-slate-400';
    const arrow = isChangeUp ? '↑' : isChangeDown ? '↓' : '';
    const changeTxt = priceChange !== undefined ? `${arrow}${Math.abs(priceChange).toFixed(2)}` : '-';
    const percentTxt = priceChangePercent !== undefined ? `${arrow}${Math.abs(priceChangePercent).toFixed(2)}%` : '-';

    // 量：台股 → 張、美股 → 原始股數
    const volDisplay = activeData.volume == null
        ? '-'
        : isTaiwanStock
            ? `${Math.round(activeData.volume / 1000).toLocaleString()} 張`
            : `${activeData.volume.toLocaleString()}`;

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
            <span className="text-slate-400">{activeData.date}</span>
            <span className="flex gap-1"><span className="text-slate-500">開</span><span className={priceColor}>{activeData.open?.toFixed(2)}</span></span>
            <span className="flex gap-1"><span className="text-slate-500">高</span><span className={priceColor}>{activeData.high?.toFixed(2)}</span></span>
            <span className="flex gap-1"><span className="text-slate-500">低</span><span className={priceColor}>{activeData.low?.toFixed(2)}</span></span>
            <span className="flex gap-1"><span className="text-slate-500">收</span><span className={priceColor}>{activeData.close?.toFixed(2)}</span></span>
            <span className={`flex gap-1 ${changeColor}`}>{changeTxt}<span>({percentTxt})</span></span>
            <span className="flex gap-1"><span className="text-slate-500">量</span><span className="text-slate-200">{volDisplay}</span></span>
        </div>
    );
};

// ----------------------------------------------------------------------
// 2b. In-chart cursor price line (hooks-based, replaces old ReferenceLine+Label)
// ----------------------------------------------------------------------

// 維護備註：此元件依賴 recharts 3.x 公開 hooks
// （useActiveTooltipDataPoints / useYAxisScale / usePlotArea），
// 已在安裝的 recharts 3.8.0 (node_modules/recharts/types/hooks.d.ts) 確認存在。
// 只用公開 export，不從 recharts/es6/... 內部路徑匯入。
// 它被當作 <ComposedChart> 的子元素渲染，因而能讀取圖表 context。
// 升級 recharts 時請確認這三個 hook 仍然存在。
const CursorPriceLine = () => {
  const activePoints = useActiveTooltipDataPoints<any>(); // 目前 hover 的資料點（無 hover 時 undefined）
  const yScale = useYAxisScale('right'); // 價格軸 yAxisId="right"
  const plotArea = usePlotArea();

  // 任一 hook 在無 active cursor / context 未就緒時回傳 undefined → 不渲染
  if (!activePoints || activePoints.length === 0 || !yScale || !plotArea) return null;

  const close = activePoints[0]?.close;
  if (close == null) return null;

  const y = yScale(close);
  if (y == null) return null;

  const xStart = plotArea.x;
  const xEnd = plotArea.x + plotArea.width;

  // 與舊的 ReferenceLine+Label 視覺一致：虛線 #94a3b8、標籤 #e2e8f0 fontSize 11
  return (
    <g>
      <line
        x1={xStart}
        y1={y}
        x2={xEnd}
        y2={y}
        stroke="#94a3b8"
        strokeDasharray="3 3"
        opacity={0.8}
      />
      <text x={xEnd + 4} y={y} dy={4} fill="#e2e8f0" fontSize={11} textAnchor="start">
        {close.toFixed(2)}
      </text>
    </g>
  );
};

// ----------------------------------------------------------------------
// 3. Main Chart Component
// ----------------------------------------------------------------------

type PanelView = 'foreign' | 'trust' | 'macd' | 'kdj' | 'rsi';

// 模組層級常數 —— 避免在 parent render 中重建物件字面值而破壞 React.memo
const CHART_MARGIN = { top: 5, right: 0, left: 0, bottom: 5 };
const SYNC_ID = 'stockDashboard';
const Y_AXIS_WIDTH = 60;
const COMMON_Y_AXIS_PROPS = {
  orientation: 'right' as const,
  width: Y_AXIS_WIDTH,
  tick: { fontSize: 11, fill: '#94a3b8' },
  tickLine: false,
  axisLine: false,
  mirror: false,
  tickMargin: 5,
};

// ----------------------------------------------------------------------
// 3a. Memoized main price chart body
// ----------------------------------------------------------------------

interface MainPriceChartProps {
  displayData: any[];
  settings: IndicatorSettings;
  isTaiwanStock: boolean;
  volumeCells: React.ReactNode;
  onMouseMove: (state: any) => void;
  onMouseLeave: () => void;
}

const MainPriceChart: React.FC<MainPriceChartProps> = React.memo(({
  displayData,
  settings,
  isTaiwanStock,
  volumeCells,
  onMouseMove,
  onMouseLeave,
}) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={displayData}
        syncId={SYNC_ID}
        margin={CHART_MARGIN}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        barCategoryGap="20%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
        <XAxis
          dataKey="date"
          stroke="#94a3b8"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          minTickGap={40}
          tickLine={false}
          axisLine={{ stroke: '#475569' }}
        />
        {/*
          Centering fix (QT-3ab-CENTER): the volume Bar now lives on its OWN hidden x-axis
          (xAxisId="volume"), so each x-axis owns exactly ONE bar series. Confirmed against
          recharts compiled getBarPositions (es6/state/selectors/combiners/combineAllBarPositions.js):
          with 2 bars sharing one band + barGap="-100%", offsets were
            volume i=0 → 0.2*band (center 0.6*band), candle i=1 → 0 (center 0.4*band),
          while the Tooltip cursor sits at the band center (0.5*band) → crosshair landed RIGHT of
          the candle. With one bar per axis, getBarPositions gives offset=_offset(=0.2*band),
          size=0.8*band → center 0.5*band = band center, so candle + volume + crosshair all align.
          barGap is no longer needed (the bars are on different x-axes and overlap at the same center).
        */}
        <XAxis xAxisId="volume" dataKey="date" hide />
        <YAxis
          {...COMMON_Y_AXIS_PROPS}
          yAxisId="right"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(val) => val.toFixed(0)}
          textAnchor="start"
        />
        {/* Hidden volume axis — domain inflated so bars occupy bottom ~20% */}
        <YAxis yAxisId="volume" orientation="left" hide domain={[0, (dataMax: number) => dataMax * 5]} />
        {/*
          浮動框已移除（改為 header 固定資訊列），但 Tooltip 仍須啟用：
          content 渲染 null（不顯示框），cursor 維持 <CrosshairCursor /> 顯示垂直十字線。
          啟用中的 Tooltip 仍會填充 active 狀態，故 CursorPriceLine 的
          useActiveTooltipDataPoints 與水平收盤價線不受影響。
        */}
        <Tooltip content={() => null} cursor={<CrosshairCursor />} />

        {/* Volume overlay — behind candlesticks, on its own x-axis so it is centered in its band */}
        <Bar xAxisId="volume" yAxisId="volume" dataKey="volume" isAnimationActive={false}>
          {volumeCells}
        </Bar>

        {settings.maLines.filter(l => l.enabled).map((line) => (
          <Line key={`ma-${line.period}`} yAxisId="right" type="monotone" dataKey={`ma_${line.period}`} stroke={line.color} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
        ))}

        {/* Bollinger Bands */}
        {settings.showBB && (
          <>
            <Area yAxisId="right" type="monotone" dataKey="bbBand" stroke="none" fill="#8b5cf6" fillOpacity={0.06} isAnimationActive={false} dot={false} activeDot={false} />
            <Line yAxisId="right" type="monotone" dataKey="bbUpper" stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 2" dot={false} activeDot={false} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="bbLower" stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 2" dot={false} activeDot={false} isAnimationActive={false} />
          </>
        )}

        <Bar yAxisId="right" dataKey="candleBody" shape={<CandleStickShape />} name="Price" isAnimationActive={false} />

        {/* Hooks-based close-price tracking line (follows cursor via recharts store, not parent state) */}
        <CursorPriceLine />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

// ----------------------------------------------------------------------
// 3b. Memoized sub-panel chart body
// ----------------------------------------------------------------------

interface SubPanelChartProps {
  view: PanelView;
  displayData: any[];
  settings: IndicatorSettings;
  isTaiwanStock: boolean;
  macdHistCells: React.ReactNode;
  foreignCells: React.ReactNode;
  trustCells: React.ReactNode;
  onMouseMove: (state: any) => void;
  onMouseLeave: () => void;
}

const SubPanelChart: React.FC<SubPanelChartProps> = React.memo(({
  view,
  displayData,
  settings,
  macdHistCells,
  foreignCells,
  trustCells,
  onMouseMove,
  onMouseLeave,
}) => {
  const sharedChartProps = {
    data: displayData,
    syncId: SYNC_ID,
    margin: CHART_MARGIN,
    onMouseMove,
    onMouseLeave,
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      {view === 'foreign' ? (
        <BarChart {...sharedChartProps} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} stroke="#94a3b8" tickFormatter={(val) => (val / 1000).toFixed(0)} />
          <Tooltip cursor={<CrosshairCursor />} content={<ChipTooltip title="Foreign" />} />
          <ReferenceLine y={0} stroke="#475569" />
          <Bar dataKey="foreignBuySell" isAnimationActive={false}>
            {foreignCells}
          </Bar>
        </BarChart>
      ) : view === 'trust' ? (
        <BarChart {...sharedChartProps} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} stroke="#94a3b8" tickFormatter={(val) => (val / 1000).toFixed(0)} />
          <Tooltip cursor={<CrosshairCursor />} content={<ChipTooltip title="Trust" />} />
          <ReferenceLine y={0} stroke="#475569" />
          <Bar dataKey="investmentTrustBuySell" isAnimationActive={false}>
            {trustCells}
          </Bar>
        </BarChart>
      ) : view === 'macd' ? (
        <ComposedChart {...sharedChartProps} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} stroke="#94a3b8" />
          <Tooltip content={<MACDTooltip />} />
          <ReferenceLine y={0} stroke="#475569" />
          <Bar dataKey="macdHist" isAnimationActive={false}>
            {macdHistCells}
          </Bar>
          <Line type="monotone" dataKey="macd" stroke="#fb923c" dot={false} strokeWidth={1.5} name="DIF" isAnimationActive={false} />
          <Line type="monotone" dataKey="macdSignal" stroke="#22d3ee" dot={false} strokeWidth={1.5} name="DEA" isAnimationActive={false} />
        </ComposedChart>
      ) : view === 'kdj' ? (
        <ComposedChart {...sharedChartProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} domain={[0, 100]} stroke="#94a3b8" />
          <Tooltip content={<IndicatorTooltip settings={settings} />} />
          <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" opacity={0.4} />
          <ReferenceLine y={20} stroke="#10b981" strokeDasharray="3 3" opacity={0.4} />
          {settings.showK && <Line type="monotone" dataKey="k" stroke="#facc15" dot={false} strokeWidth={1.5} name="K" isAnimationActive={false} />}
          {settings.showD && <Line type="monotone" dataKey="d" stroke="#f472b6" dot={false} strokeWidth={1.5} name="D" isAnimationActive={false} />}
          {settings.showJ && <Line type="monotone" dataKey="j" stroke="#c084fc" dot={false} strokeWidth={1.5} name="J" isAnimationActive={false} />}
        </ComposedChart>
      ) : (
        <ComposedChart {...sharedChartProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} domain={[0, 100]} stroke="#94a3b8" />
          <Tooltip content={<IndicatorTooltip settings={settings} />} />
          <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" opacity={0.4} />
          <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" opacity={0.4} />
          <Line type="monotone" dataKey="rsi" stroke="#38bdf8" dot={false} strokeWidth={2} name="RSI" isAnimationActive={false} />
        </ComposedChart>
      )}
    </ResponsiveContainer>
  );
});

const StockChart: React.FC<StockChartProps> = ({ data, settings, isTaiwanStock, chipDataUnavailable, onToggleSetting }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [panel1View, setPanel1View] = useState<PanelView>('foreign');
  const [panel2View, setPanel2View] = useState<PanelView>('trust');

  const [barsToShow, setBarsToShow] = useState(100);

  // 向右隱藏的 K 棒數（0 = 錨定最新一根 / 右邊緣）；拖曳平移時增減
  const [rightOffset, setRightOffset] = useState(0);

  // 拖曳中旗標（純樣式：grab/grabbing；亦驅動副圖凍結 subPanelData）。
  // 在此提前宣告，讓下方 displayData 之後的 subPanelData 能引用（避免 TDZ）。
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
     setBarsToShow(Math.min(100, data.length));
     // 切換股票 / 週期 → 快照回最新一根
     setRightOffset(0);
  }, [data.length]);

  const handleZoom = useCallback((direction: 'in' | 'out') => {
      setBarsToShow(prev => {
          const step = Math.ceil(prev * 0.2);
          if (direction === 'in') return Math.max(20, prev - step);
          else return Math.min(data.length, prev + step);
      });
  }, [data.length]);

  // Keyboard shortcuts: +/- for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); handleZoom('in'); }
      else if (e.key === '-') { e.preventDefault(); handleZoom('out'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoom]);

  const hasChipData = useMemo(() => {
      if (chipDataUnavailable) return false;
      if (!data || data.length === 0) return false;
      return data.some(d => (d.foreignBuySell !== undefined && d.foreignBuySell !== 0) || (d.investmentTrustBuySell !== undefined && d.investmentTrustBuySell !== 0));
  }, [data, chipDataUnavailable]);

  // Pre-compute MAs on full dataset (only recalc when data/settings change, NOT on zoom)
  const maResultsCache = useMemo(() => {
    const useAdj = settings.useAdjusted;
    const allCloses = data.map(d => useAdj && d.closeAdj ? d.closeAdj : d.close);
    const results: Record<number, (number | null)[]> = {};
    for (const line of settings.maLines) {
      results[line.period] = calculateSMA(allCloses, line.period);
    }
    return results;
  }, [data, settings.useAdjusted, settings.maLines]);

  // Transform Data based on Settings (Adj vs Raw) — zoom only re-slices, no SMA recalc
  const displayData = useMemo(() => {
    const useAdj = settings.useAdjusted;
    // 平移夾止：clampedOffset 一律即時夾回有效範圍，縮小（barsToShow 變大）時 maxOffset
    // 變小會自動把位移夾回，毋須額外 effect 校正。
    const maxOffset = Math.max(0, data.length - barsToShow);
    const clampedOffset = Math.min(Math.max(0, rightOffset), maxOffset);
    const endIndex = data.length - clampedOffset;
    const startIndex = Math.max(0, endIndex - barsToShow);
    const sliced = data.slice(startIndex, endIndex);

    return sliced.map((d, i) => {
        const originalIndex = startIndex + i;

        const openVal = useAdj && d.openAdj ? d.openAdj : d.open;
        const closeVal = useAdj && d.closeAdj ? d.closeAdj : d.close;
        const highVal = useAdj && d.highAdj ? d.highAdj : d.high;
        const lowVal = useAdj && d.lowAdj ? d.lowAdj : d.low;

        let priceChange = 0;
        let priceChangePercent = 0;
        if (originalIndex > 0) {
            const prevD = data[originalIndex - 1];
            const prevClose = useAdj && prevD.closeAdj ? prevD.closeAdj : prevD.close;
            priceChange = closeVal - prevClose;
            priceChangePercent = (priceChange / prevClose) * 100;
        }

        // Build dynamic MA fields: ma_5, ma_10, ma_5_dir, etc.
        const maFields: Record<string, any> = {};
        for (const line of settings.maLines) {
          const val = maResultsCache[line.period]?.[originalIndex];
          maFields[`ma_${line.period}`] = val ?? undefined;
          if (originalIndex > 0) {
            const prev = maResultsCache[line.period]?.[originalIndex - 1];
            maFields[`ma_${line.period}_dir`] = (val != null && prev != null)
              ? (val > prev ? 'up' : val < prev ? 'down' : 'flat')
              : 'flat';
          } else {
            maFields[`ma_${line.period}_dir`] = 'flat';
          }
        }

        return {
            ...d,
            open: openVal,
            close: closeVal,
            high: highVal,
            low: lowVal,
            candleBody: [lowVal, highVal],
            ...maFields,
            rsi: useAdj ? d.rsiAdj : d.rsi,
            macd: useAdj ? d.macdAdj : d.macd,
            macdSignal: useAdj ? d.macdSignalAdj : d.macdSignal,
            macdHist: useAdj ? d.macdHistAdj : d.macdHist,
            bbUpper: useAdj ? d.bbUpperAdj : d.bbUpper,
            bbMiddle: useAdj ? d.bbMiddleAdj : d.bbMiddle,
            bbLower: useAdj ? d.bbLowerAdj : d.bbLower,
            bbBand: (useAdj ? d.bbLowerAdj : d.bbLower) != null && (useAdj ? d.bbUpperAdj : d.bbUpper) != null
              ? [(useAdj ? d.bbLowerAdj : d.bbLower), (useAdj ? d.bbUpperAdj : d.bbUpper)]
              : undefined,
            priceChange,
            priceChangePercent
        };
    });
  }, [data, barsToShow, rightOffset, settings.useAdjusted, maResultsCache]);

  // 副圖凍結（QT-ixg-FREEZE）：拖曳期間餵給兩個 SubPanelChart 一個「參照穩定」的資料，
  // 讓 React.memo 整段跳過重繪（約 2/3 的省工）；放開後再交回即時最終視窗 → 只重繪一次。
  // displayDataRef 為即時鏡像：每次 render 都更新（cheap），避免回呼裡抓到舊閉包值。
  const displayDataRef = useRef(displayData);
  displayDataRef.current = displayData;
  // frozenSubDataRef 為 handleDragStart 當下的快照（拖曳全程同一物件參照）。
  const frozenSubDataRef = useRef<any[]>(displayData);
  // 拖曳中用凍結快照，閒置/放開後用即時 displayData（isDragging 翻 false 觸發單次正確重繪）。
  const subPanelData = isDragging ? frozenSubDataRef.current : displayData;

  const activeData = activeIndex !== null && displayData[activeIndex] ? displayData[activeIndex] : displayData[displayData.length - 1];

  // Throttle mouse move to reduce re-renders (~60fps max)
  const rafRef = useRef<number | null>(null);
  const pendingIndex = useRef<number | null>(null);

  const handleMouseMove = useCallback((state: any) => {
      if (draggingRef.current) return; // 拖曳期間不更新十字線，避免亂跳
      const newIndex = state?.activeTooltipIndex ?? null;
      if (newIndex === pendingIndex.current) return; // skip if same
      pendingIndex.current = newIndex;
      if (rafRef.current) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setActiveIndex(pendingIndex.current);
      });
  }, []);

  const handleMouseLeave = useCallback(() => {
      setActiveIndex(null);
  }, []);

  // ----- Drag-to-pan（拖曳平移）-----
  // wrapperRef 量測繪圖區寬度以換算每根 K 棒像素寬；draggingRef 為拖曳閘門（同步、不觸發重繪）。
  // isDragging state 僅用來切換 grab/grabbing 游標（純樣式，不影響記憶化圖表 props）。
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startClientXRef = useRef(0);
  const startOffsetRef = useRef(0);
  const dragRafRef = useRef<number | null>(null);
  // 註：isDragging state 已於元件頂部宣告（供 subPanelData 凍結引用）。

  const handleDragMove = useCallback((e: MouseEvent) => {
      if (!draggingRef.current) return;
      const width = wrapperRef.current?.getBoundingClientRect().width ?? 0;
      const deltaX = e.clientX - startClientXRef.current;
      // 扣掉價格軸寬，換算每根 K 棒像素寬（最新 barsToShow / data.length 就地重算，避免閉包抓舊值）
      const barPixelWidth = Math.max(1, (width - Y_AXIS_WIDTH) / barsToShow);
      // 量化平移步幅（QT-ixg-COARSEN）：依目前視窗縮放，視窗越大步幅越粗（重繪越貴），
      // 讓主圖以「整塊」跳動而非每根 K 棒都 setState，降低重繪頻率。≈2 @ 100 根。
      const PAN_STEP = Math.max(1, Math.round(barsToShow / 50));
      const rawDelta = deltaX / barPixelWidth;
      const barsDelta = Math.round(rawDelta / PAN_STEP) * PAN_STEP;
      // 向右拖（deltaX>0）露出較舊的 K 棒 → rightOffset 增加
      const maxOffset = Math.max(0, data.length - barsToShow);
      const newOffset = Math.min(Math.max(0, startOffsetRef.current + barsDelta), maxOffset);
      if (dragRafRef.current) return; // 已排程
      dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          setRightOffset(prev => (prev === newOffset ? prev : newOffset));
      });
  }, [barsToShow, data.length]);

  const handleDragEnd = useCallback(() => {
      draggingRef.current = false;
      setIsDragging(false);
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      if (dragRafRef.current) {
          cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = null;
      }
  }, [handleDragMove]);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // 只處理左鍵
      e.preventDefault(); // 避免拖曳時選取文字
      draggingRef.current = true;
      startClientXRef.current = e.clientX;
      // 以目前實際夾止後的位移為起點（避免縮放後 rightOffset 超出範圍導致跳動）
      startOffsetRef.current = Math.min(Math.max(0, rightOffset), Math.max(0, data.length - barsToShow));
      // 拖曳起點當下快照副圖資料（從即時鏡像取，避免抓到舊閉包）→ 拖曳全程參照穩定
      frozenSubDataRef.current = displayDataRef.current;
      setIsDragging(true);
      setActiveIndex(null); // 進入拖曳即清除十字線
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
  }, [rightOffset, data.length, barsToShow, handleDragMove, handleDragEnd]);

  // 卸載時清掉殘留的 window 監聽與 rAF（guard 避免洩漏）
  useEffect(() => {
      return () => {
          window.removeEventListener('mousemove', handleDragMove);
          window.removeEventListener('mouseup', handleDragEnd);
          if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current);
      };
  }, [handleDragMove, handleDragEnd]);

  // Pre-compute Cell arrays to avoid recreating on every render
  const volumeCells = useMemo(() => displayData.map((entry, index) => (
    <Cell key={`vol-${index}`} fill={entry.close >= entry.open ? '#f0405a' : '#22c55e'} fillOpacity={0.15} /> // token: up 紅漲 / down 綠跌
  )), [displayData]);

  // 副圖 Cell 改吃 subPanelData：拖曳中凍結（與 SubPanelChart 一起跳過重繪），放開後回到即時。
  const macdHistCells = useMemo(() => subPanelData.map((entry, index) => (
    <Cell key={`hist-${index}`} fill={(entry.macdHist || 0) >= 0 ? '#f0405a' : '#22c55e'} />
  )), [subPanelData]);

  const foreignCells = useMemo(() => subPanelData.map((entry, index) => (
    <Cell key={`fii-${index}`} fill={(entry.foreignBuySell || 0) > 0 ? '#f0405a' : '#22c55e'} />
  )), [subPanelData]);

  const trustCells = useMemo(() => subPanelData.map((entry, index) => (
    <Cell key={`it-${index}`} fill={(entry.investmentTrustBuySell || 0) > 0 ? '#f0405a' : '#22c55e'} />
  )), [subPanelData]);

  if (!data || data.length === 0) return <div className="text-gray-400">No data available for chart</div>;

  return (
    <div className="flex flex-col gap-4 w-full relative group">
      
      {/* 1. Price Chart Section */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg relative outline-none">
        <div className="flex flex-col mb-4 gap-2 pr-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <h3 className="text-slate-200 font-semibold text-lg">K線圖</h3>
                    <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded uppercase tracking-wider">
                        {settings.useAdjusted ? 'Adj (還原)' : 'Raw (原始)'}
                    </span>
                </div>
                <MALegend currentData={activeData} settings={settings} />
            </div>
            {/* 固定 OHLC 資訊列：hover 該根 / idle 最新一根；位於 header 非繪圖區，永不遮擋 K 棒 */}
            <OHLCInfoBar activeData={activeData} isTaiwanStock={isTaiwanStock} />
        </div>

        <div className="absolute top-4 right-4 flex gap-1 z-10">
            <button onClick={() => handleZoom('out')} className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-l border border-slate-600 transition-colors" title="縮小 (-)">
                <ZoomOut size={16} />
            </button>
            <button onClick={() => handleZoom('in')} className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-r border border-slate-600 transition-colors" title="放大 (+)">
                <ZoomIn size={16} />
            </button>
        </div>
        
        <div
          ref={wrapperRef}
          onMouseDown={handleDragStart}
          className={`h-[450px] max-md:h-[320px] w-full select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          <MainPriceChart
            displayData={displayData}
            settings={settings}
            isTaiwanStock={isTaiwanStock}
            volumeCells={volumeCells}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </div>
      </div>

       {/* 2. Sub-panels: two full-width windows with toggle buttons */}
       {[
         { view: panel1View, setView: setPanel1View, id: 1 },
         { view: panel2View, setView: setPanel2View, id: 2 },
       ].map(({ view, setView, id }) => {
         const viewOptions: { key: PanelView; label: string; show: boolean }[] = [
           { key: 'foreign', label: '外資', show: hasChipData },
           { key: 'trust', label: '投信', show: hasChipData },
           { key: 'macd', label: 'MACD', show: settings.showMACD !== false },
           { key: 'kdj', label: 'KDJ', show: settings.showK || settings.showD || settings.showJ },
           { key: 'rsi', label: 'RSI', show: settings.showRSI },
         ];

         const titleMap: Record<PanelView, string> = {
           foreign: '外資買賣超 (Foreign Net Buy/Sell)',
           trust: '投信買賣超 (Trust Net Buy/Sell)',
           macd: 'MACD (10, 20, 10)',
           kdj: 'KDJ (5, 3, 3)',
           rsi: 'RSI (14)',
         };

         return (
           <div key={`panel-${id}`} className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-lg outline-none">
             <div className="flex items-center justify-between mb-2">
               <h3 className="text-slate-200 font-medium text-sm">{titleMap[view]}</h3>
               <div className="flex gap-1">
                 {chipDataUnavailable && (
                   <Badge variant="neutral">籌碼暫時不可用</Badge>
                 )}
                 {viewOptions.filter(o => o.show).map(o => (
                   <button
                     key={o.key}
                     onClick={() => setView(o.key)}
                     className={`px-2.5 py-1 text-xs rounded transition-colors ${
                       view === o.key
                         ? 'bg-blue-600 text-white'
                         : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                     }`}
                   >
                     {o.label}
                   </button>
                 ))}
               </div>
             </div>
             <div className="h-[180px] max-md:h-[140px] w-full">
               <SubPanelChart
                 view={view}
                 displayData={subPanelData}
                 settings={settings}
                 isTaiwanStock={isTaiwanStock}
                 macdHistCells={macdHistCells}
                 foreignCells={foreignCells}
                 trustCells={trustCells}
                 onMouseMove={handleMouseMove}
                 onMouseLeave={handleMouseLeave}
               />
             </div>
           </div>
         );
       })}
    </div>
  );
};

export default StockChart;
