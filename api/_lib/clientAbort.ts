// 將用戶端斷線接到 handler 的工作訊號；請在 handler 的 finally 解除監聽。
interface AbortRequest {
  aborted?: boolean;
  on?(event: 'aborted', listener: () => void): void;
  off?(event: 'aborted', listener: () => void): void;
}

interface AbortResponse {
  writableFinished?: boolean;
  destroyed?: boolean;
  on?(event: 'close', listener: () => void): void;
  off?(event: 'close', listener: () => void): void;
}

export function connectClientAbort(req: AbortRequest, res: AbortResponse, onAbort?: () => void) {
  const controller = new AbortController();
  let disconnected = false;
  const cancel = () => {
    disconnected = true;
    if (controller.signal.aborted) return;
    controller.abort();
    onAbort?.();
  };
  const onResponseClose = () => { if (!res.writableFinished) cancel(); };
  req.on?.('aborted', cancel);
  res.on?.('close', onResponseClose);
  if (req.aborted || res.destroyed) cancel();
  return {
    controller,
    signal: controller.signal,
    get disconnected() { return disconnected; },
    dispose() {
      req.off?.('aborted', cancel);
      res.off?.('close', onResponseClose);
    },
  };
}
