import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { ensureTaiwanDirectory, searchStocks, StockDirEntry, Market } from '../services/stockDirectory';

interface StockSearchProps {
  value: string;
  onValueChange: (v: string) => void;
  onSelect: (symbol: string) => void; // 點選或送出時觸發（由父層負責抓資料）
  loading?: boolean;
}

const marketBadge: Record<Market, { label: string; cls: string }> = {
  TW: { label: '台股', cls: 'bg-blue-500/15 text-blue-300' },
  US: { label: '美股', cls: 'bg-emerald-500/15 text-emerald-300' },
  OTHER: { label: '海外', cls: 'bg-slate-500/20 text-slate-300' },
};

// 將符合的字串片段高亮
const highlight = (text: string, q: string) => {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-amber-300 font-bold">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
};

const StockSearch: React.FC<StockSearchProps> = ({ value, onValueChange, onSelect, loading }) => {
  const [dir, setDir] = useState<StockDirEntry[]>([]);
  const [results, setResults] = useState<StockDirEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const reqIdRef = useRef(0);

  // 載入台股名錄（背景，快取後極快）
  useEffect(() => { ensureTaiwanDirectory().then(setDir).catch(() => {}); }, []);

  // 點擊外部關閉
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const runSearch = useCallback((q: string) => {
    window.clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setOpen(false); setSearching(false); return; }
    setSearching(true);
    const myId = ++reqIdRef.current;
    debounceRef.current = window.setTimeout(async () => {
      const r = await searchStocks(dir, q);
      if (myId !== reqIdRef.current) return; // 丟棄過期結果
      setResults(r);
      setActive(-1);
      setOpen(true);
      setSearching(false);
    }, 180);
  }, [dir]);

  const handleChange = (v: string) => { onValueChange(v); runSearch(v); };

  const pick = (e: StockDirEntry) => {
    const sym = e.id;
    onValueChange(sym);
    setOpen(false);
    setResults([]);
    onSelect(sym);
  };

  const submitCurrent = () => {
    setOpen(false);
    if (value.trim()) onSelect(value.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) {
      if (e.key === 'Enter') { e.preventDefault(); submitCurrent(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && active < results.length) pick(results[active]);
      else submitCurrent();
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submitCurrent(); }}
      className="flex gap-2"
    >
      <div ref={boxRef} className="relative group flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors z-10" size={18} />
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          placeholder="輸入代碼或公司名（如 2330、台積電、台、AAPL）"
          className="w-full bg-slate-800 border border-slate-700 text-white pl-10 pr-9 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-600"
        />
        {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" size={16} />}

        {/* 懸浮結果清單 */}
        {open && results.length > 0 && (
          <ul className="absolute z-30 left-0 right-0 mt-2 max-h-80 overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl shadow-2xl shadow-black/50 py-1">
            {results.map((e, i) => {
              const b = marketBadge[e.market];
              return (
                <li
                  key={`${e.id}-${i}`}
                  onMouseDown={(ev) => { ev.preventDefault(); pick(e); }}
                  onMouseEnter={() => setActive(i)}
                  className={`px-4 py-2.5 cursor-pointer flex items-center gap-3 ${i === active ? 'bg-blue-600/20' : 'hover:bg-slate-700/50'}`}
                >
                  <span className="font-mono text-sm text-slate-200 w-16 shrink-0">{highlight(e.id, value)}</span>
                  <span className="text-sm text-white flex-1 truncate">{highlight(e.name, value)}</span>
                  {e.industry && <span className="text-[11px] text-slate-500 truncate max-w-[90px] hidden sm:block">{e.industry}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${b.cls}`}>{b.label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {open && !searching && results.length === 0 && value.trim() && (
          <div className="absolute z-30 left-0 right-0 mt-2 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl px-4 py-3 text-sm text-slate-400">
            找不到符合「{value}」的股票
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[80px]"
      >
        {loading ? <Loader2 className="animate-spin" size={20} /> : '搜尋'}
      </button>
    </form>
  );
};

export default StockSearch;
