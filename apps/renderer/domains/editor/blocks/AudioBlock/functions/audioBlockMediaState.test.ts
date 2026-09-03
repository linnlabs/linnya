import { describe, expect, it } from 'vitest';
import {
  canLoadPersistedAudioSource,
  isTemporaryAudioSource,
  resolveAudioMissingMessageKey,
  resolvePersistedAudioMissingReason,
} from './audioBlockMediaState';

describe('audioBlockMediaState', () => {
  it('允许已保存的真实音频路径进入加载链路', () => {
    expect(canLoadPersistedAudioSource({
      src: '/workspace/AudioRecordings/recording.webm',
      isTempSrc: false,
      isFinalized: true,
    })).toBe(true);
  });

  it('识别历史 blob/data/isTempSrc 脏数据为失效音频', () => {
    expect(isTemporaryAudioSource('blob:old-recording')).toBe(true);
    expect(isTemporaryAudioSource('data:audio/webm;base64,AAAA')).toBe(true);
    expect(resolvePersistedAudioMissingReason({
      src: 'blob:old-recording',
      isTempSrc: false,
      isFinalized: true,
    })).toBe('temporary-source-persisted');
    expect(resolvePersistedAudioMissingReason({
      src: '/tmp/recording.webm',
      isTempSrc: 'true',
      isFinalized: 'true',
    })).toBe('temporary-source-persisted');
  });

  it('保存失败标记优先显示不可恢复占位，不再尝试加载 src', () => {
    const snapshot = {
      src: '/workspace/AudioRecordings/recording.webm',
      isTempSrc: false,
      isFinalized: false,
      saveStatus: 'failed',
    };

    expect(canLoadPersistedAudioSource(snapshot)).toBe(false);
    expect(resolvePersistedAudioMissingReason(snapshot)).toBe('save-failed-without-runtime-audio');
    expect(resolveAudioMissingMessageKey('save-failed-without-runtime-audio')).toBe('editor.audioBlock.missing.saveFailed');
  });

  it('finalized 但无 src 的历史块进入失效占位', () => {
    expect(resolvePersistedAudioMissingReason({
      src: null,
      isTempSrc: false,
      isFinalized: true,
    })).toBe('finalized-without-source');
  });
});
