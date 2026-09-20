// 顯示端接收累積全文；輸入與服務快取不在此改寫。
export function createFramePublisher<T>(publish: (value: T) => void) {
  let ended = false;
  let frame: number | null = null;
  let latest: T | undefined;
  const clear = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    latest = undefined;
  };
  return {
    push(value: T) {
      if (ended) return;
      latest = value;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        if (ended) return;
        const value = latest as T;
        frame = null;
        latest = undefined;
        publish(value);
      });
    },
    finish(value: T) {
      if (ended) return;
      ended = true;
      clear();
      publish(value);
    },
    cancel() { ended = true; clear(); },
  };
}
