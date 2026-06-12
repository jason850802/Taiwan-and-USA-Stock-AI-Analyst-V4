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

    const getUSVolumeWeight = (mins: number): number => {
        if (mins <= 30) {
            return (mins / 30) * 0.14;
        } else if (mins <= 120) {
            return 0.14 + ((mins - 30) / 90) * 0.20;
        } else if (mins <= 270) {
            return 0.34 + ((mins - 120) / 150) * 0.22;
        } else if (mins <= 360) {
            return 0.56 + ((mins - 270) / 90) * 0.22;
        } else if (mins < 390) {
            return 0.78 + ((mins - 360) / 30) * 0.17;
        } else {
            return 1.0;
        }
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

    // Insufficient 視窗截止：台股用實證 T*=105 分（投影誤差 p10..p90 ⊆ ±35% 的最早時點，
    // 見 tw-volume-curve-report）；美股維持 5 分。
    const insufficientCutoff = isTaiwanStock ? 105 : 5;

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
