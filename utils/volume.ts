import { StockDataPoint, TimeInterval } from '../types';

export interface VolumeProjection {
    currentVolume: number;
    projectedVolume: number;
    yesterdayVolume: number;
    changePercent: number;
    status: 'Intraday' | 'Insufficient' | 'Closed';
}

export const estimateVolumeTrend = (data: StockDataPoint[], isTaiwanStock: boolean, interval: TimeInterval): VolumeProjection | null => {
    // Only calculate for Daily interval
    if (interval !== '1d' || data.length < 2) return null;

    const latest = data[data.length - 1];
    const prev = data[data.length - 2];
    const now = new Date();

    // --- Timezone & market hours config ---
    const timezone = isTaiwanStock ? 'Asia/Taipei' : 'America/New_York';
    const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    const todayStr = localTime.toISOString().split('T')[0];

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
    const getTaiwanVolumeWeight = (mins: number): number => {
        if (mins <= 30) return (mins / 30) * 0.25;                     // Opening rush: ~25%
        else if (mins <= 240) return 0.25 + ((mins - 30) / 210) * 0.55; // Mid-day lull: ~55%
        else if (mins < 270) return 0.80 + ((mins - 240) / 30) * 0.13;  // Closing rush: ~13%
        else return 1.0;
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

    if (minutesElapsed < 0) return null; // Pre-market

    const isClosed = minutesElapsed >= totalMinutes;
    if (isClosed) minutesElapsed = totalMinutes;

    const weight = getVolumeWeight(minutesElapsed);

    // Guard: Prevent extreme math during the first few minutes
    if (!isClosed && minutesElapsed < 5) {
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
