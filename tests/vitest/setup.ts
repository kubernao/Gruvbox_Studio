import { expect, afterEach, vi } from 'vitest';

// Mock Electron IPC if running in Node environment
if (typeof window === 'undefined') {
  global.window = {
    electron: {
      ipcRenderer: {
        invoke: vi.fn(),
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
  } as any;
}

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
});
