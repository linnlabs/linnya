// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAudioContentStore } from './store/audioContent.store';
import { useAudioRuntimeStore } from './store/audioRuntime.store';
import { useAudioDeviceStore } from './store/audioDevice';
import { useAudioContentActions, useAudioRuntimeActions, useAudioDeviceActions } from './runtime';
const repository = vi.hoisted(() => ({
  loadCompleteContent: vi.fn(),
  saveNote: vi.fn(),
  saveTranscript: vi.fn(),
  saveSummary: vi.fn(),
}));
const file = vi.hoisted(() => ({ currentFilePath: 'doc', setDirty: vi.fn() }));
vi.mock('./repository/audioRepository', () => ({ audioBlockRepository: repository }));
vi.mock('@/app/active-document', () => ({ useFileStore: () => file }));

describe('音频内容、设备和媒体流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('加载幂等，草稿通知文档变脏，保存失败保留dirty、成功清理', async () => {
    const state = useAudioContentStore(),
      actions = useAudioContentActions();
    repository.loadCompleteContent.mockResolvedValue({
      success: true,
      data: {
        note: { content_html: '<p>旧笔记</p>', created_at: 1, updated_at: 2 },
        transcript: null,
        summary: null,
      },
    });
    await actions.loadContent('audio');
    await actions.loadContent('audio');
    expect(repository.loadCompleteContent).toHaveBeenCalledTimes(1);
    expect(state.getContent('audio').notesContent).toBe('<p>旧笔记</p>');
    actions.setNotesContentDraft('audio', '<p>新笔记</p>');
    expect(file.setDirty).toHaveBeenCalledWith(true);
    expect(state.isDirty('audio', 'notes')).toBe(true);
    repository.saveNote.mockResolvedValueOnce({ success: false, error: 'write failure' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await actions.persistDirtyContent()).success).toBe(false);
    expect(state.isDirty('audio', 'notes')).toBe(true);
    repository.saveNote.mockResolvedValueOnce({ success: true });
    expect((await actions.persistDirtyContent()).success).toBe(true);
    expect(repository.saveNote).toHaveBeenLastCalledWith('audio', 'doc', '<p>新笔记</p>');
    expect(state.isDirty('audio', 'notes')).toBe(false);
  });
  it('设备检测释放临时流，权限请求将后续录音流交给调用者', async () => {
    const stop = vi.fn(),
      track = { getSettings: () => ({ deviceId: 'mic' }), stop };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream),
      enumerateDevices = vi.fn().mockResolvedValue([
        { deviceId: 'mic', label: '测试麦克风', kind: 'audioinput' },
        { deviceId: 'speaker', kind: 'audiooutput' },
      ]);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices } });
    const actions = useAudioDeviceActions(),
      state = useAudioDeviceStore();
    const devices = await actions.getAvailableMicrophoneDevices();
    expect(devices.success).toBe(true);
    expect(state.availableMicrophoneDevices).toHaveLength(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(state.deviceCheckInProgress).toBe(false);
    const permission = await actions.requestMicrophonePermission();
    expect(permission.stream).toBe(stream);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(enumerateDevices).toHaveBeenCalledTimes(1);
  });
  it('拒绝权限保留既有消息，块设备检测结果由同步action提交', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn(),
        getUserMedia: vi.fn().mockRejectedValue({ name: 'NotAllowedError' }),
      },
    });
    const result = await useAudioRuntimeActions().checkMicrophoneForBlock('audio');
    expect(result.success).toBe(false);
    expect(useAudioRuntimeStore().getRuntime('audio')).toMatchObject({
      canRecord: false,
      deviceCheckCompleted: true,
      processingState: 'error',
    });
    expect(useAudioDeviceStore().activeMicrophoneAccess).toBe(false);
  });
  it('已保存资源加载、blob转录、资源替换与卸载清理保持同一状态', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL: revoke });
    vi.stubGlobal('linnyaMedia', { buildAudioUrl: vi.fn(path => 'linnya-media://' + path) });
    const state = useAudioRuntimeStore(),
      actions = useAudioRuntimeActions();
    expect(await actions.loadAudioFile('audio', 'saved.webm')).toBe(true);
    expect(state.getRuntime('audio').audioFileObjectUrl).toBe('linnya-media://saved.webm');
    actions.setAudioBlobUrl('audio', 'blob:first');
    actions.setAudioResourceUrl('audio', 'blob:second');
    expect(revoke).toHaveBeenCalledWith('blob:first');
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    state.updateRuntime('audio', {
      audioBlob: blob,
      mimeType: 'audio/webm',
      filename: 'recording.webm',
      duration: 5,
    });
    const resolved = await actions.resolveAudioForTranscription('audio');
    expect(resolved).toMatchObject({
      blob,
      mimeType: 'audio/webm',
      filename: 'recording.webm',
      duration: 5,
    });
    const stop = vi.fn();
    state.updateRuntime('audio', { mediaStream: { getTracks: () => [{ stop }] } });
    state.startRecording('audio');
    actions.cleanupBlock('audio');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:second');
    expect(state.runtimes.audio).toBeUndefined();
    expect(state.globalRecordingBlocks).toEqual([]);
  });
  it('已登记的录音控制器按顺序终止，失败继续保留可重试事实', async () => {
    const state = useAudioRuntimeStore(),
      actions = useAudioRuntimeActions(),
      calls = [];
    state.startRecording('a');
    state.startRecording('b');
    state.registerRecordingController('a', {
      terminateForSave: async () => {
        calls.push('a');
        return true;
      },
    });
    state.registerRecordingController('b', {
      terminateForSave: async () => {
        calls.push('b');
        return false;
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await actions.terminateAllRecordingsForSave()).toBe(false);
    expect(calls).toEqual(['a', 'b']);
    expect(state.globalRecordingBlocks).toEqual(['a', 'b']);
  });
});
