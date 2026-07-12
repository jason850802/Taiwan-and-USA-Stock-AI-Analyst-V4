// 拖曳平移（drag-to-pan）純數學模組（QT-wa0-TRANSLATE）。
// 零外部依賴：不 import recharts / react —— 供 StockChart 的拖曳管線與一次性斷言直測共用。
//
// 方向約定（斷言鎖定）：deltaX > 0（滑鼠右拖）→ 內容跟隨游標右移 → 露出較舊 K 棒
// → rightOffset 增加。與 StockChart handleDragMove 既有語意一致。

export interface WindowBounds {
  startIndex: number;
  endIndex: number;
}

/**
 * 視窗切片邊界的單一事實來源 —— 邏輯逐字搬自 StockChart windowBounds useMemo
 * 的四行夾止數學（A2 / QT-qyf）。rightOffset 為「向右隱藏的 K 棒數」
 * （0 = 錨定最新一根），一律即時夾回 [0, maxOffset]。O(1)。
 */
export function computeWindowBounds(dataLength: number, barsToShow: number, rightOffset: number): WindowBounds {
  const maxOffset = Math.max(0, dataLength - barsToShow);
  const clampedOffset = Math.min(Math.max(0, rightOffset), maxOffset);
  const endIndex = dataLength - clampedOffset;
  const startIndex = Math.max(0, endIndex - barsToShow);
  return { startIndex, endIndex };
}

/**
 * 拖曳 session 幾何快照（dragStart 建立、dragEnd/abort 銷毀），全 number。
 * 語意：
 * - bufStart / bufEnd：緩衝 slice 邊界（含 / 不含）——主圖在 session 期間渲染
 *   mappedData.slice(bufStart, bufEnd) 的加寬緩衝層。
 * - bpw = (containerWidth − yAxisWidth) / barsToShow：每根 K 棒像素寬。
 * - leftPx = (startIndex − bufStart) × bpw：translate 正向上限（往右拖露出較舊 K 棒的行程）。
 * - rightPx = (bufEnd − endIndex) × bpw：translate 負向上限（往左拖露出較新 K 棒的行程）。
 * - bufWidthPx = (bufEnd − bufStart) × bpw：緩衝層寬（pan 模式顯式渲染寬度）。
 * - baseOffset：session 起點夾止後 rightOffset（= dataLength − endIndex），提交換算的基準。
 */
export interface PanSession {
  /** session 流水號（緩衝層重建追蹤用） */
  id: number;
  /** 緩衝 slice 起點（含） */
  bufStart: number;
  /** 緩衝 slice 終點（不含） */
  bufEnd: number;
  /** session 起點夾止後 rightOffset（= dataLength − endIndex） */
  baseOffset: number;
  /** 每根 K 棒像素寬 = (containerWidth − yAxisWidth) / barsToShow */
  bpw: number;
  /** 緩衝層寬 = (bufEnd − bufStart) × bpw */
  bufWidthPx: number;
  /** (startIndex − bufStart) × bpw = translate 正向上限（往右拖露較舊） */
  leftPx: number;
  /** (bufEnd − endIndex) × bpw = translate 負向上限（往左拖露較新） */
  rightPx: number;
  /** dragStart 量測的容器高（pan 模式顯式渲染高度） */
  heightPx: number;
  /** dragStart 量測的容器寬 */
  containerWidth: number;
  /** 夾止上限 = max(0, dataLength − barsToShow) */
  maxOffset: number;
  dataLength: number;
  barsToShow: number;
}

/**
 * 建立拖曳 session。
 * 前置條件（呼叫端保證）：dataLength > barsToShow 且 containerWidth > yAxisWidth。
 * bufferRatio 預設 0.5（裁決 1）：buffer = ceil(barsToShow × bufferRatio) 每側，
 * bufStart / bufEnd 夾至 [0, dataLength]（資料邊界處緩衝自然縮短）。
 */
export function buildPanSession(args: {
  id: number;
  dataLength: number;
  barsToShow: number;
  rightOffset: number;
  containerWidth: number;
  containerHeight: number;
  yAxisWidth: number;
  bufferRatio?: number;
}): PanSession {
  const { id, dataLength, barsToShow, rightOffset, containerWidth, containerHeight, yAxisWidth } = args;
  const bufferRatio = args.bufferRatio ?? 0.5;
  const { startIndex, endIndex } = computeWindowBounds(dataLength, barsToShow, rightOffset);
  const buffer = Math.ceil(barsToShow * bufferRatio);
  const bufStart = Math.max(0, startIndex - buffer);
  const bufEnd = Math.min(dataLength, endIndex + buffer);
  const bpw = (containerWidth - yAxisWidth) / barsToShow;
  return {
    id,
    bufStart,
    bufEnd,
    baseOffset: dataLength - endIndex, // = 夾止後 rightOffset
    bpw,
    bufWidthPx: (bufEnd - bufStart) * bpw,
    leftPx: (startIndex - bufStart) * bpw,
    rightPx: (bufEnd - endIndex) * bpw,
    heightPx: containerHeight,
    containerWidth,
    maxOffset: Math.max(0, dataLength - barsToShow),
    dataLength,
    barsToShow,
  };
}

/**
 * 夾止 translate（mousemove 熱路徑：純算術，無任何副作用）。
 * t = min(max(deltaX, −rightPx), leftPx)。
 * exhausted：緩衝耗盡且該側「還有資料」→ 'older' / 'newer'（觸發 mid-drag re-base，裁決 2）；
 * 已到資料邊界則硬鉗住（不露白、不 re-base）回 null。
 */
export function clampTranslate(session: PanSession, deltaX: number): { t: number; exhausted: 'older' | 'newer' | null } {
  const t = Math.min(Math.max(deltaX, -session.rightPx), session.leftPx);
  let exhausted: 'older' | 'newer' | null = null;
  if (deltaX > session.leftPx && session.bufStart > 0) {
    exhausted = 'older';
  } else if (deltaX < -session.rightPx && session.bufEnd < session.dataLength) {
    exhausted = 'newer';
  }
  return { t, exhausted };
}

/**
 * 放開（mouseup）/ re-base 時把累積 translate 換算成 rightOffset：
 * 吸附到整根（Math.round(t / bpw)，顆粒度 1 根）＋ [0, maxOffset] 邊界鉗位。
 */
export function commitOffset(session: PanSession, t: number): number {
  return Math.min(Math.max(session.baseOffset + Math.round(t / session.bpw), 0), session.maxOffset);
}
