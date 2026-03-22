import { create } from 'zustand';
import {
  startPsServer,
  stopPsServer,
  getPsServerStatus,
  onPsImageReceived,
  type PsServerStatus,
  type PsImageReceived,
} from '@/commands/psIntegration';

export interface PendingImage extends PsImageReceived {
  receivedAt: number;
}

interface InitializePsIntegrationOptions {
  enabled: boolean;
  autoStart: boolean;
  preferredPort: number;
}

interface PsIntegrationState {
  serverStatus: PsServerStatus;
  pendingImages: PendingImage[];
  isStarting: boolean;
  isStopping: boolean;

  startServer: (port?: number) => Promise<void>;
  stopServer: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  addPendingImage: (image: PsImageReceived) => void;
  removePendingImage: (id: string) => void;
  clearPendingImages: () => void;
}

export const usePsIntegrationStore = create<PsIntegrationState>((set) => ({
  serverStatus: { running: false, port: null, ps_connected: false },
  pendingImages: [],
  isStarting: false,
  isStopping: false,

  startServer: async (port) => {
    set({ isStarting: true });
    try {
      const actualPort = await startPsServer(port);
      set({ serverStatus: { running: true, port: actualPort, ps_connected: false }, isStarting: false });
    } catch (error) {
      set({ isStarting: false });
      throw error;
    }
  },

  stopServer: async () => {
    set({ isStopping: true });
    try {
      await stopPsServer();
      set({ serverStatus: { running: false, port: null, ps_connected: false }, isStopping: false });
    } catch (error) {
      set({ isStopping: false });
      throw error;
    }
  },

  refreshStatus: async () => {
    const status = await getPsServerStatus();
    set({ serverStatus: status });
  },

  addPendingImage: (image) => {
    set((state) => ({
      pendingImages: [...state.pendingImages, { ...image, receivedAt: Date.now() }],
    }));
  },

  removePendingImage: (id) => {
    set((state) => ({
      pendingImages: state.pendingImages.filter((img) => img.id !== id),
    }));
  },

  clearPendingImages: () => {
    set({ pendingImages: [] });
  },
}));

let lastImageId: string | null = null;
let lastImageTime = 0;
let listenerCount = 0;
let statusRefreshInterval: ReturnType<typeof setInterval> | null = null;

export function initializePsIntegration(
  options: InitializePsIntegrationOptions
): () => void {
  const { refreshStatus, startServer, addPendingImage } = usePsIntegrationStore.getState();

  refreshStatus().then(() => {
    const { serverStatus } = usePsIntegrationStore.getState();
    if (options.enabled && options.autoStart && !serverStatus.running) {
      startServer(options.preferredPort).catch((error) => {
        console.warn('Failed to auto-start PS server:', error);
      });
    }
  });

  if (statusRefreshInterval) {
    clearInterval(statusRefreshInterval);
  }
  statusRefreshInterval = setInterval(() => {
    const { refreshStatus: refresh } = usePsIntegrationStore.getState();
    refresh().catch((error) => {
      console.warn('Failed to refresh PS server status:', error);
    });
  }, 2000);

  listenerCount += 1;
  const myListenerId = listenerCount;
  
  let unlisten: (() => void) | null = null;
  
  onPsImageReceived((data) => {
    if (myListenerId !== listenerCount) {
      return;
    }
    const now = Date.now();
    if (data.id === lastImageId && now - lastImageTime < 1000) {
      return;
    }
    lastImageId = data.id;
    lastImageTime = now;
    addPendingImage(data);
  }).then((fn) => {
    if (myListenerId === listenerCount) {
      unlisten = fn;
    } else {
      fn();
    }
  });

  return () => {
    if (unlisten) {
      unlisten();
    }
    if (statusRefreshInterval) {
      clearInterval(statusRefreshInterval);
      statusRefreshInterval = null;
    }
  };
}
