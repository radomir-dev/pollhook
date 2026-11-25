import { watchFile, unwatchFile } from "node:fs";

const DEBOUNCE_MS = 200;

export interface ConfigWatch {
  stop(): void;
}

export function watchConfig(
  path: string,
  onChange: () => void,
  onError: (error: unknown) => void,
): ConfigWatch {
  let timer: NodeJS.Timeout | null = null;
  watchFile(path, { interval: 1000 }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onChange();
      } catch (error) {
        onError(error);
      }
    }, DEBOUNCE_MS);
  });
  return {
    stop() {
      if (timer) clearTimeout(timer);
      unwatchFile(path);
    },
  };
}
