import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioRecordingService from './AudioRecordingService';

class FakeMediaRecorder {
  constructor() {
    this.state = 'recording';
    this.mimeType = 'audio/webm';
  }

  stop() {
    this.state = 'inactive';
  }
}

function createAudioStore(overrides = {}) {
  const runtime = {
    isRecording: true,
    isPaused: false,
    recordingTime: 0,
    audioBlob: null,
    audioFileObjectUrl: null,
    duration: 0,
    mimeType: null,
    saveStatus: null,
    ...overrides.runtime,
  };

  const updates = [];

  return {
    updates,
    runtime,
    getRuntime: vi.fn(() => runtime),
    updateRuntime: vi.fn((_blockId, update) => {
      updates.push(update);
      Object.assign(runtime, update);
    }),
    setAudioBlobUrl: vi.fn((_blockId, blobUrl) => {
      Object.assign(runtime, {
        audioFileObjectUrl: blobUrl,
        showPlayer: true,
        audioLoadFailed: false,
        audioMissingReason: null,
      });
    }),
    loadAudioFile: vi.fn(async () => true),
    stopRecording: vi.fn(),
    ...overrides.store,
  };
}

function createRecordingService(store, updateNodeAttributes = vi.fn()) {
  const service = new AudioRecordingService('audio-block-1', store, updateNodeAttributes);
  service.mediaRecorder = new FakeMediaRecorder();
  service.audioChunks = [new Blob([new Uint8Array(2048)], { type: 'audio/webm' })];
  return service;
}

describe('AudioRecordingService', () => {
  const windowRef = globalThis.window ?? globalThis;
  const originalWindow = globalThis.window;
  const originalElectronApi = windowRef.electronAPI;
  const originalCreateObjectURL = URL.createObjectURL;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.window = windowRef;
    windowRef.electronAPI = {
      saveAudioFile: vi.fn(),
    };
    URL.createObjectURL = vi.fn(() => 'blob:runtime-recording');
  });

  afterEach(() => {
    windowRef.electronAPI = originalElectronApi;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('录音落盘失败时不把 blob 写进节点，并解除 terminate 等待', async () => {
    windowRef.electronAPI.saveAudioFile.mockResolvedValue({
      success: false,
      error: 'disk full',
    });
    const store = createAudioStore();
    const updateNodeAttributes = vi.fn();
    const service = createRecordingService(store, updateNodeAttributes);

    const terminatePromise = service.terminateRecording(12);
    await service.handleRecordingStop();

    await expect(terminatePromise).resolves.toBe(true);
    expect(updateNodeAttributes).toHaveBeenCalledWith(expect.objectContaining({
      isFinalized: false,
      isTempSrc: false,
      src: null,
      duration: 12,
      mimeType: 'audio/webm',
      saveStatus: 'failed',
    }));
    expect(updateNodeAttributes).not.toHaveBeenCalledWith(expect.objectContaining({
      src: 'blob:runtime-recording',
    }));
    expect(store.setAudioBlobUrl).toHaveBeenCalledWith('audio-block-1', 'blob:runtime-recording');
    expect(store.runtime.processingState).toBe('save_failed');
    expect(store.runtime.saveStatus).toBe('failed');
    expect(store.stopRecording).toHaveBeenCalledWith('audio-block-1');
  });

  it('重试保存复用会话内 blob，成功后写入真实文件路径并清除失败态', async () => {
    const pendingBlob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
    windowRef.electronAPI.saveAudioFile.mockResolvedValue({
      success: true,
      filePath: '/workspace/AudioRecordings/recording.webm',
    });
    const store = createAudioStore({
      runtime: {
        audioBlob: pendingBlob,
        duration: 9,
        mimeType: 'audio/webm',
        filename: 'recording.webm',
        saveStatus: 'failed',
      },
    });
    const updateNodeAttributes = vi.fn();
    const service = createRecordingService(store, updateNodeAttributes);

    await expect(service.retrySavePendingRecording()).resolves.toBe(true);

    expect(windowRef.electronAPI.saveAudioFile).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'audio/webm');
    expect(updateNodeAttributes).toHaveBeenCalledWith(expect.objectContaining({
      src: '/workspace/AudioRecordings/recording.webm',
      isTempSrc: false,
      duration: 9,
      mimeType: 'audio/webm',
      isFinalized: true,
      saveStatus: null,
    }));
    expect(store.loadAudioFile).toHaveBeenCalledWith('audio-block-1', '/workspace/AudioRecordings/recording.webm');
    expect(store.runtime.saveStatus).toBeNull();
  });

  it('落盘成功但播放器加载失败时保留真实文件路径，不退回保存失败态', async () => {
    const pendingBlob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
    windowRef.electronAPI.saveAudioFile.mockResolvedValue({
      success: true,
      filePath: '/workspace/AudioRecordings/recording.webm',
    });
    const store = createAudioStore({
      runtime: {
        audioBlob: pendingBlob,
        duration: 9,
        mimeType: 'audio/webm',
        saveStatus: 'failed',
      },
      store: {
        loadAudioFile: vi.fn(async () => false),
      },
    });
    const updateNodeAttributes = vi.fn();
    const service = createRecordingService(store, updateNodeAttributes);

    await expect(service.retrySavePendingRecording()).resolves.toBe(true);

    expect(updateNodeAttributes).toHaveBeenCalledWith(expect.objectContaining({
      src: '/workspace/AudioRecordings/recording.webm',
      isTempSrc: false,
      isFinalized: true,
      saveStatus: null,
    }));
    expect(updateNodeAttributes).not.toHaveBeenCalledWith(expect.objectContaining({
      saveStatus: 'failed',
    }));
    expect(store.runtime.audioMissingReason).toBe('saved-source-missing');
  });

  it('重试时如果会话内 blob 已丢失，保持失败标记并进入失效状态', async () => {
    const store = createAudioStore({
      runtime: {
        audioBlob: null,
        saveStatus: 'failed',
      },
    });
    const updateNodeAttributes = vi.fn();
    const service = createRecordingService(store, updateNodeAttributes);

    await expect(service.retrySavePendingRecording()).resolves.toBe(false);

    expect(windowRef.electronAPI.saveAudioFile).not.toHaveBeenCalled();
    expect(store.runtime.audioMissingReason).toBe('save-failed-without-runtime-audio');
    expect(updateNodeAttributes).toHaveBeenCalledWith(expect.objectContaining({
      src: null,
      isTempSrc: false,
      isFinalized: false,
      saveStatus: 'failed',
    }));
  });
});
