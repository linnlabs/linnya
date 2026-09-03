import { describe, expect, it } from 'vitest';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import {
  createAudioBlockMessage,
  buildAudioBlockCreateOptions,
  buildAudioBlockFileTooLargeError,
  buildAudioBlockPanelTabs,
  formatAudioBlockContentTime,
  formatAudioBlockDateTime,
  formatAudioBlockFileSize,
  resolveAudioBlockRenderPlaceholder,
  resolveAudioBlockStatusMessage,
  resolveAudioBlockTranscriptionButtonTitle,
} from './audioBlockPresentation';

const testMessage: EditorMessageResolver = (key, params) => {
  const messages: Partial<Record<Parameters<EditorMessageResolver>[0], string>> = {
    'editor.audioBlock.status.checkingDevice': 'Checking devices',
    'editor.audioBlock.status.usingMicrophone': 'Using {device}',
    'editor.audioBlock.status.usingDefaultMicrophone': 'Using default microphone',
    'editor.audioBlock.status.deviceDetectionFailed': 'Device check failed',
    'editor.audioBlock.status.loadingAudio': 'Loading audio',
    'editor.audioBlock.status.loadFailed': 'Load failed',
    'editor.audioBlock.status.loadFailedWithMessage': 'Failed to load audio',
    'editor.audioBlock.status.saveFailedRetryable': 'Save failed, retry',
    'editor.audioBlock.status.recording': 'Recording',
    'editor.audioBlock.action.transcribing': 'Transcribing',
    'editor.audioBlock.action.transcribe': 'Transcribe',
    'editor.audioBlock.render.file': 'Audio file: {src}',
    'editor.audioBlock.render.readyToRecord': 'Ready to record',
    'editor.audioBlock.error.fileTooLarge': 'Audio file is too large ({fileSizeMB}MB)',
    'editor.audioBlock.menu.unknown': 'Unknown',
    'editor.audioBlock.panel.notes': 'Notes',
    'editor.audioBlock.panel.transcript': 'Transcript',
    'editor.audioBlock.panel.summary': 'Summary',
    'editor.audioBlock.create.group': 'Create',
    'editor.audioBlock.content.yesterday': 'Yesterday',
  };

  const raw = messages[key] ?? key;
  if (!params) return raw;

  return Object.entries(params).reduce((text, [paramKey, value]) => {
    return text.replace(`{${paramKey}}`, String(value));
  }, raw);
};

describe('audioBlockPresentation', () => {
  it('解析运行时结构化状态文案', () => {
    expect(resolveAudioBlockStatusMessage(
      createAudioBlockMessage('editor.audioBlock.status.recording'),
      testMessage,
    )).toBe('Recording');
    expect(resolveAudioBlockStatusMessage(
      createAudioBlockMessage('editor.audioBlock.status.usingDefaultMicrophone'),
      testMessage,
    )).toBe('Using default microphone');
    expect(resolveAudioBlockStatusMessage(
      createAudioBlockMessage('editor.audioBlock.status.loadFailedWithMessage', { message: 'missing file' }),
      testMessage,
    )).toBe('Failed to load audio');
  });

  it('保留外部传入的普通字符串详情', () => {
    expect(resolveAudioBlockStatusMessage('network failure', testMessage)).toBe('network failure');
    expect(resolveAudioBlockStatusMessage('检测录音设备中...', testMessage)).toBe('检测录音设备中...');
  });

  it('构造 AudioBlock 控件展示文案', () => {
    expect(resolveAudioBlockTranscriptionButtonTitle('loading', testMessage)).toBe('Transcribing');
    expect(resolveAudioBlockTranscriptionButtonTitle('idle', testMessage)).toBe('Transcribe');
    expect(resolveAudioBlockRenderPlaceholder('voice.webm', testMessage)).toBe('Audio file: voice.webm');
    expect(resolveAudioBlockRenderPlaceholder(null, testMessage)).toBe('Ready to record');
    expect(buildAudioBlockFileTooLargeError('25.01', testMessage)).toBe('Audio file is too large (25.01MB)');
    expect(buildAudioBlockPanelTabs(false, testMessage).map((tab) => tab.label)).toEqual([
      'Notes',
      'Transcript',
      'Summary',
    ]);
    expect(buildAudioBlockCreateOptions(testMessage)).toEqual([
      { isGroup: true, label: 'Create' },
      { value: 'summary', text: 'Summary' },
    ]);
  });

  it('格式化菜单属性展示值', () => {
    expect(formatAudioBlockFileSize(-1, testMessage)).toBe('Unknown');
    expect(formatAudioBlockFileSize(2048, testMessage)).toBe('2 KB');
    expect(formatAudioBlockDateTime(null, testMessage)).toBe('Unknown');
  });

  it('格式化内容面板相对时间时使用当前语言标签', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0);

    expect(formatAudioBlockContentTime(yesterday.getTime(), testMessage)).toBe('Yesterday');
  });
});
