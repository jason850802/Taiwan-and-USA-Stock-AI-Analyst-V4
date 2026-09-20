interface BoundedSessionOptions {
  prefix: string;
  maxBytes: number;
  maxKeys: number;
  maxEntryBytes: number;
}

// 只管理一個可重建 sessionStorage 命名空間；不碰資料語意、memory cache 或 TTL。
export function createBoundedSessionStore(options: BoundedSessionOptions) {
  const lru = new Map<string, true>();
  let indexReady = false;
  let namespaceDirty = false;
  const keyBytes = (key: string) => key.length * 2;
  const owned = (key: string) => key.startsWith(options.prefix);

  const recoverDirtyNamespace = (): boolean => {
    if (!namespaceDirty) return true;
    try {
      const ownKeys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key && owned(key)) ownKeys.push(key);
      }
      ownKeys.forEach(key => sessionStorage.removeItem(key));
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key && owned(key)) return false;
      }
      lru.clear();
      indexReady = false;
      namespaceDirty = false;
      return true;
    } catch {
      lru.clear();
      indexReady = false;
      return false;
    }
  };

  const remove = (key: string): void => {
    if (!owned(key)) return;
    try {
      sessionStorage.removeItem(key);
      if (indexReady) lru.delete(key);
    } catch {
      namespaceDirty = true;
      lru.clear();
      indexReady = false;
    }
  };

  const ensureIndex = (): boolean => {
    if (!recoverDirtyNamespace()) return false;
    if (indexReady) return true;
    try {
      lru.clear();
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (!key || !owned(key)) continue;
        const raw = sessionStorage.getItem(key);
        if (raw === null) continue;
        const payloadBytes = raw.length * 2;
        if (payloadBytes > options.maxEntryBytes || payloadBytes + keyBytes(key) > options.maxBytes) {
          sessionStorage.removeItem(key);
          i -= 1;
          continue;
        }
        lru.set(key, true);
      }
      indexReady = true;
      while (true) {
        const current = usage();
        if (!current || (current.keys <= options.maxKeys && current.bytes <= options.maxBytes)) break;
        if (!removeOldest()) break;
      }
      return true;
    } catch {
      return false;
    }
  };

  const touch = (key: string): void => {
    if (!ensureIndex() || !owned(key)) return;
    lru.delete(key);
    lru.set(key, true);
  };

  const removeOldest = (except?: string): boolean => {
    if (!ensureIndex()) return false;
    for (const key of lru.keys()) {
      if (key === except) continue;
      remove(key);
      return true;
    }
    return false;
  };

  const usage = (exclude?: string): { keys: number; bytes: number } | null => {
    if (!ensureIndex()) return null;
    let keys = 0;
    let bytes = 0;
    try {
      for (const key of [...lru.keys()]) {
        if (key === exclude) continue;
        const raw = sessionStorage.getItem(key);
        if (raw === null) {
          lru.delete(key);
          continue;
        }
        const payloadBytes = raw.length * 2;
        if (payloadBytes > options.maxEntryBytes || payloadBytes + keyBytes(key) > options.maxBytes) {
          remove(key);
          continue;
        }
        keys += 1;
        bytes += keyBytes(key) + payloadBytes;
      }
    } catch {
      return null;
    }
    return { keys, bytes };
  };

  const trimForWrite = (key: string, payloadBytes: number): boolean => {
    const incomingBytes = keyBytes(key) + payloadBytes;
    if (!owned(key) || payloadBytes > options.maxEntryBytes || incomingBytes > options.maxBytes) return false;
    while (true) {
      const current = usage(key);
      if (!current) return false;
      if (current.keys + 1 <= options.maxKeys && current.bytes + incomingBytes <= options.maxBytes) return true;
      if (!removeOldest(key)) return false;
    }
  };

  const read = (key: string): string | null => {
    if (!owned(key) || !ensureIndex()) return null;
    let raw: string | null;
    try { raw = sessionStorage.getItem(key); }
    catch { return null; }
    if (raw === null) {
      lru.delete(key);
      return null;
    }
    const payloadBytes = raw.length * 2;
    if (payloadBytes > options.maxEntryBytes || payloadBytes + keyBytes(key) > options.maxBytes) {
      remove(key);
      return null;
    }
    touch(key);
    while (true) {
      const current = usage();
      if (!current) break;
      if (current.keys <= options.maxKeys && current.bytes <= options.maxBytes) break;
      if (!removeOldest(key)) {
        remove(key);
        return null;
      }
    }
    try { return sessionStorage.getItem(key); }
    catch { return null; }
  };

  const write = (key: string, payload: string): void => {
    if (!owned(key)) return;
    if (!recoverDirtyNamespace()) return;
    // 新值寫不進去時也不保留同 key 舊值，避免 reload 後復活舊資料。
    remove(key);
    if (!recoverDirtyNamespace()) return;
    if (!trimForWrite(key, payload.length * 2)) return;
    try {
      sessionStorage.setItem(key, payload);
      touch(key);
      return;
    } catch {
      // 真實 quota 額外只淘汰一個自家 LRU，最多重試一次。
    }
    if (!removeOldest(key)) return;
    try {
      sessionStorage.setItem(key, payload);
      touch(key);
    } catch { /* memory 層仍可用 */ }
  };

  const removeWhere = (predicate: (key: string) => boolean): void => {
    if (!ensureIndex()) return;
    for (const key of [...lru.keys()]) {
      if (predicate(key)) remove(key);
    }
  };

  return { read, write, remove, removeWhere };
}
