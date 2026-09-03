import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockModelConfig = {
  id: string;
  billing_mode?: 'cloud' | 'self_hosted' | 'subscription';
};

type MockCloudModelsLoadedEvent = {
  count: number;
  models: MockModelConfig[];
};

type MockCloudModelsLoadedListener = (event: MockCloudModelsLoadedEvent) => void;

const { registryMock, listeners } = vi.hoisted(() => {
  const listeners = new Set<MockCloudModelsLoadedListener>();
  return {
    listeners,
    registryMock: {
      onCloudModelsLoaded: vi.fn((listener: MockCloudModelsLoadedListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      hasLoadedCloudModels: vi.fn(() => false),
      getModels: vi.fn(() => [] as MockModelConfig[]),
    },
  };
});

vi.mock('src/domains/model-catalog', () => ({
  modelCatalog: registryMock,
}));

function emitCloudModelsLoaded(event: MockCloudModelsLoadedEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

function createWindowMock() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  };
}

function createWebContentsMock() {
  return {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  };
}

describe('CloudModelsBroadcaster', () => {
  beforeEach(() => {
    vi.resetModules();
    listeners.clear();
    registryMock.onCloudModelsLoaded.mockClear();
    registryMock.hasLoadedCloudModels.mockReset();
    registryMock.hasLoadedCloudModels.mockReturnValue(false);
    registryMock.getModels.mockReset();
    registryMock.getModels.mockReturnValue([]);
  });

  it('replays a cloud models update after the renderer becomes ready when the window was missing at load time', async () => {
    const { installCloudModelsBroadcaster, notifyCloudModelsRendererReady } = await import(
      './cloudModelsBroadcaster'
    );

    let currentWindow: ReturnType<typeof createWindowMock> | null = null;
    installCloudModelsBroadcaster(() => currentWindow as unknown as BrowserWindow | null);

    emitCloudModelsLoaded({
      count: 2,
      models: [{ id: 'cloud-a', billing_mode: 'cloud' }, { id: 'cloud-b', billing_mode: 'cloud' }],
    });

    currentWindow = createWindowMock();
    const didSend = notifyCloudModelsRendererReady();

    expect(didSend).toBe(true);
    expect(currentWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(currentWindow.webContents.send).toHaveBeenCalledWith(
      'models-updated',
      expect.objectContaining({
        source: 'cloud-models-loaded',
        cloudModelsCount: 2,
      })
    );
  });

  it('sends a cloud models update on renderer ready when the broadcaster was installed after registry load', async () => {
    registryMock.hasLoadedCloudModels.mockReturnValue(true);
    registryMock.getModels.mockReturnValue([
      { id: 'local-a' },
      { id: 'cloud-a', billing_mode: 'cloud' },
      { id: 'cloud-b', billing_mode: 'cloud' },
    ]);

    const { installCloudModelsBroadcaster, notifyCloudModelsRendererReady } = await import(
      './cloudModelsBroadcaster'
    );

    const currentWindow = createWindowMock();
    installCloudModelsBroadcaster(() => currentWindow as unknown as BrowserWindow);

    const didSend = notifyCloudModelsRendererReady();

    expect(didSend).toBe(true);
    expect(currentWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(currentWindow.webContents.send).toHaveBeenCalledWith(
      'models-updated',
      expect.objectContaining({
        source: 'cloud-models-loaded',
        cloudModelsCount: 2,
      })
    );
  });

  it('uses the renderer-ready sender for later cloud model updates even when main window lookup is unavailable', async () => {
    const { installCloudModelsBroadcaster, notifyCloudModelsRendererReady } = await import(
      './cloudModelsBroadcaster'
    );

    const readySender = createWebContentsMock();
    installCloudModelsBroadcaster(() => null);

    const replayedAtReady = notifyCloudModelsRendererReady(readySender);
    expect(replayedAtReady).toBe(false);

    emitCloudModelsLoaded({
      count: 1,
      models: [{ id: 'cloud-after-ready', billing_mode: 'cloud' }],
    });

    expect(readySender.send).toHaveBeenCalledTimes(1);
    expect(readySender.send).toHaveBeenCalledWith(
      'models-updated',
      expect.objectContaining({
        source: 'cloud-models-loaded',
        cloudModelsCount: 1,
      })
    );
  });
});
