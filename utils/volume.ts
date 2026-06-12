import { StockDataPoint, TimeInterval } from '../types';

export interface VolumeProjection {
    currentVolume: number;
    projectedVolume: number;
    yesterdayVolume: number;
    changePercent: number;
    status: 'Intraday' | 'Insufficient' | 'Closed';
}

// 台股盤中「累積成交量權重」校準表：50 檔大型權值股（0050 成分股近似）、60 交易日、
// 校準日期 2026-06-12，2505 個 stock-day 的累積占比中位數（強制單調非遞減、末值=1.0）。
// index i ↔ 自 09:00 起第 (i+1)*5 分鐘；index 0↔5min … index 53↔270min(13:30)。
// 校準來源與方法學見 scripts/tw-volume-curve-report.md（tw-volume-curve-report）。
const TW_CUM_WEIGHT: number[] = [ 0.0346, 0.0650, 0.0936, 0.1186, 0.1411, 0.1654, 0.1856, 0.2067, 0.2255, 0.2455, 0.2637, 0.2821, 0.2988, 0.3150, 0.3316, 0.3457, 0.3609, 0.3758, 0.3893, 0.4031, 0.4163, 0.4285, 0.4427, 0.4538, 0.4669, 0.4803, 0.4910, 0.5022, 0.5149, 0.5267, 0.5380, 0.5490, 0.5598, 0.5698, 0.5802, 0.5921, 0.6041, 0.6148, 0.6265, 0.6380, 0.6494, 0.6624, 0.6742, 0.6875, 0.7001, 0.7135, 0.7283, 0.7459, 0.7652, 0.7838, 0.8055, 0.8348, 0.8348, 1.0000 ];

// 美股盤中「累積成交量權重」校準表：50 檔 S&P 市值前50近似大型股、60 交易日、
// 校準日期 2026-06-12，2800 個 stock-day 的累積占比中位數（強制單調非遞減、末值=1.0）。
// 交易時段 09:30–16:00（390 分）；index i ↔ 自 09:30 起第 (i+1)*5 分鐘；
// index 0↔5min … index 77↔390min(16:00)。15:55 那根已含收盤集合競價，故 385/390 兩點皆=1.0。
// 校準來源與方法學見 scripts/us-volume-curve-report.md（us-volume-curve-report）。
const US_CUM_WEIGHT: number[] = [ 0.0772, 0.0969, 0.1165, 0.1339, 0.1501, 0.1677, 0.1836, 0.1985, 0.2142, 0.2279, 0.2418, 0.2559, 0.2690, 0.2804, 0.2929, 0.3052, 0.3170, 0.3297, 0.3413, 0.3523, 0.3627, 0.3753, 0.3862, 0.3973, 0.4083, 0.4189, 0.4288, 0.4378, 0.4480, 0.4573, 0.4670, 0.4755, 0.4843, 0.4928, 0.5012, 0.5112, 0.5209, 0.5305, 0.5383, 0.5467, 0.5551, 0.5644, 0.5727, 0.5803, 0.5890, 0.5974, 0.6059, 0.6157, 0.6245, 0.6342, 0.6419, 0.6502, 0.6582, 0.6670, 0.6760, 0.6842, 0.6937, 0.7024, 0.7109, 0.7193, 0.7274, 0.7368, 0.7458, 0.7543, 0.7635, 0.7736, 0.7840, 0.7943, 0.8057, 0.8168, 0.8289, 0.8426, 0.8559, 0.8710, 0.8897, 0.9206, 1.0000, 1.0000 ];

export const estimateVolumeTrend = (data: StockDataPoint[], isTaiwanStock: boolean, interval: TimeInterval): VolumeProjection | null => {
    // Only calculate for Daily interval
    if (interval !== '1d' || data.length < 2) return null;

    const latest = data[data.length - 1];
    const prev = data[data.length - 2];
    const now = new Date();

    // --- Timezone & market hours config ---
    const timezone = isTaiwanStock ? 'Asia/Taipei' : 'America/New_York';
    const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    // localTime 已是「掛在本地時鐘」的 Date；用本地 getter 手動組 YYYY-MM-DD，
    // 避免 toISOString() 再以 UTC 輸出時往回減時區偏移（台北凌晨 0–8 點會變昨天）。
    const todayStr = `${localTime.getFullYear()}-${String(localTime.getMonth() + 1).padStart(2, '0')}-${String(localTime.getDate()).padStart(2, '0')}`;

    const isToday = latest.date === todayStr;

    // If NOT today (weekend, holiday, after-hours data not yet updated), return historical change
    if (!isToday) {
        const changePercent = prev.volume > 0 ? ((latest.volume - prev.volume) / prev.volume) * 100 : 0;
        return {
            currentVolume: latest.volume,
            projectedVolume: latest.volume,
            yesterdayVolume: prev.volume,
            changePercent,
            status: 'Closed'
        };
    }

    const currentHour = localTime.getHours();
    const currentMinute = localTime.getMinutes();

    // --- Taiwan Market: 09:00 - 13:30 (270 minutes) ---
    // 校準表線性內插：grid 點 i 對應第 (i+1)*5 分鐘、權重 TW_CUM_WEIGHT[i]（見 tw-volume-curve-report）。
    const getTaiwanVolumeWeight = (mins: number): number => {
        if (mins <= 0) return 0;
        if (mins < 5) return (mins / 5) * TW_CUM_WEIGHT[0];   // 由原點線性接到第一格
        if (mins >= 270) return 1.0;                          // 收盤鉗位（= 末格 1.0）
        const lowIdx = Math.floor(mins / 5) - 1;              // 下界 grid index
        const lo = TW_CUM_WEIGHT[lowIdx];
        const hi = TW_CUM_WEIGHT[Math.min(lowIdx + 1, TW_CUM_WEIGHT.length - 1)];
        const loMin = (lowIdx + 1) * 5;
        const frac = (mins - loMin) / 5;                      // 兩格之間的分數位置
        return lo + (hi - lo) * frac;
    };

    // --- US Market: 09:30 - 16:00 (390 minutes) ---
    // 校準表線性內插：grid 點 i 對應第 (i+1)*5 分鐘、權重 US_CUM_WEIGHT[i]（見 us-volume-curve-report）。
    const getUSVolumeWeight = (mins: number): number => {
        if (mins <= 0) return 0;
        if (mins < 5) return (mins / 5) * US_CUM_WEIGHT[0];   // 由原點線性接到第一格
        if (mins >= 390) return 1.0;                          // 收盤鉗位（= 末格 1.0）
        const lowIdx = Math.floor(mins / 5) - 1;              // 下界 grid index
        const lo = US_CUM_WEIGHT[lowIdx];
        const hi = US_CUM_WEIGHT[Math.min(lowIdx + 1, US_CUM_WEIGHT.length - 1)];
        const loMin = (lowIdx + 1) * 5;
        const frac = (mins - loMin) / 5;                      // 兩格之間的分數位置
        return lo + (hi - lo) * frac;
    };

    let minutesElapsed: number;
    let totalMinutes: number;
    let getVolumeWeight: (mins: number) => number;

    if (isTaiwanStock) {
        totalMinutes = 270;
        minutesElapsed = (currentHour - 9) * 60 + currentMinute;
        getVolumeWeight = getTaiwanVolumeWeight;
    } else {
        totalMinutes = 390;
        minutesElapsed = (currentHour - 9) * 60 + (currentMinute - 30);
        getVolumeWeight = getUSVolumeWeight;
    }

    // Insufficient 視窗截止：兩市場皆用實證 T*（投影誤差 p10..p90 ⊆ ±35% 的最早時點）。
    // 台股 T*=105 分（見 tw-volume-curve-report）；美股 T*=85 分（見 us-volume-curve-report）。
    const insufficientCutoff = isTaiwanStock ? 105 : 85;

    if (minutesElapsed < 0) return null; // Pre-market

    const isClosed = minutesElapsed >= totalMinutes;
    if (isClosed) minutesElapsed = totalMinutes;

    const weight = getVolumeWeight(minutesElapsed);

    // Guard: Prevent extreme math during the early window (market-aware cutoff)
    if (!isClosed && minutesElapsed < insufficientCutoff) {
        return {
            currentVolume: latest.volume,
            projectedVolume: 0,
            yesterdayVolume: prev.volume,
            changePercent: 0,
            status: 'Insufficient'
        };
    }

    const projectedVolume = isClosed ? latest.volume : Math.round(latest.volume / weight);
    const changePercent = prev.volume > 0 ? ((projectedVolume - prev.volume) / prev.volume) * 100 : 0;

    return {
        currentVolume: latest.volume,
        projectedVolume,
        yesterdayVolume: prev.volume,
        changePercent,
        status: isClosed ? 'Closed' : 'Intraday'
    };
};
