/**
 * Minimal ambient types for the WebExtension (MV3) APIs this project uses.
 *
 * Declared locally instead of pulling in @types/chrome to keep the
 * dependency surface small and auditable. Only the exact APIs used by
 * TradeVision AI are declared.
 */

interface ChromeStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ChromeRuntimeMessage {
  type: string;
  [key: string]: unknown;
}

interface ChromeRuntime {
  onMessage: {
    addListener(
      cb: (
        message: ChromeRuntimeMessage,
        sender: { tab?: { id?: number }; url?: string },
        sendResponse: (resp: unknown) => void,
      ) => boolean | void,
    ): void;
  };
  sendMessage(message: Record<string, unknown>): Promise<unknown>;
  getURL(path: string): string;
}

interface ChromeStorage {
  local: ChromeStorageArea;
}

declare const chrome: {
  runtime: ChromeRuntime;
  storage: ChromeStorage;
};
