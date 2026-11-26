export interface IdleExit {
  connected(): void;
  quiet(): void;
  stop(): void;
}

export function createIdleExit(idleMs: number | undefined, onIdle: () => void): IdleExit {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return {
    connected: clear,
    quiet() {
      if (stopped || idleMs === undefined) return;
      clear();
      timer = setTimeout(onIdle, idleMs);
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
