import type { EditorMessageKey, EditorMessageResolver } from '../../../definitions/editorMessages';
import { formatHistoryDateTime } from '@app/schemas';

type AudioBlockMessageParams = Parameters<EditorMessageResolver>[1];

export interface AudioBlockLocalizedMessage {
  readonly key: EditorMessageKey;
  readonly params?: AudioBlockMessageParams;
}

export interface AudioBlockSelectOption {
  readonly value?: string;
  readonly text?: string;
  readonly label?: string;
  readonly isGroup?: boolean;
}

export interface AudioBlockLanguageOption {
  readonly code: string;
  readonly label: string;
  readonly serviceLabel: string;
}

export function createAudioBlockMessage(
  key: EditorMessageKey,
  params?: AudioBlockMessageParams,
): AudioBlockLocalizedMessage {
  return params === undefined ? { key } : { key, params };
}

export function resolveAudioBlockStatusMessage(
  message: unknown,
  editorMessage: EditorMessageResolver,
): string {
  if (isAudioBlockLocalizedMessage(message)) {
    return editorMessage(message.key, message.params);
  }

  if (typeof message !== 'string' || message.length === 0) return '';
  return message;
}

function isAudioBlockLocalizedMessage(message: unknown): message is AudioBlockLocalizedMessage {
  if (typeof message !== 'object' || message === null) return false;
  if (!('key' in message) || typeof message.key !== 'string') return false;
  if (!('params' in message)) return true;
  return typeof message.params === 'object' || message.params === undefined;
}

export function formatAudioBlockFileSize(bytes: number, editorMessage: EditorMessageResolver): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return editorMessage('editor.audioBlock.menu.unknown');

  const unit = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(unit));

  return `${Math.round((bytes / unit ** unitIndex) * 100) / 100} ${units[unitIndex]}`;
}

/** 菜单“创建时间”：统一历史时间的完整写法，没有时间时写“未知”。 */
export function formatAudioBlockDateTime(
  timestamp: number | null,
  locale: string,
  editorMessage: EditorMessageResolver,
): string {
  return formatHistoryDateTime(timestamp, { locale }) || editorMessage('editor.audioBlock.menu.unknown');
}

export function resolveAudioBlockTranscriptionButtonTitle(
  transcriptionState: string,
  editorMessage: EditorMessageResolver,
): string {
  switch (transcriptionState) {
    case 'loading':
      return editorMessage('editor.audioBlock.action.transcribing');
    case 'success':
      return editorMessage('editor.audioBlock.action.transcribed');
    case 'error':
      return editorMessage('editor.audioBlock.action.transcriptionFailed');
    default:
      return editorMessage('editor.audioBlock.action.transcribe');
  }
}

export function resolveAudioBlockRenderPlaceholder(
  src: unknown,
  editorMessage: EditorMessageResolver,
): string {
  if (typeof src === 'string' && src.length > 0) {
    return editorMessage('editor.audioBlock.render.file', { src });
  }

  return editorMessage('editor.audioBlock.render.readyToRecord');
}

export function buildAudioBlockFileTooLargeError(
  fileSizeMB: string,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage('editor.audioBlock.error.fileTooLarge', { fileSizeMB });
}

export function buildAudioBlockPanelTabs(
  isRecordingMode: boolean,
  editorMessage: EditorMessageResolver,
): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const notes = { id: 'notes', label: editorMessage('editor.audioBlock.panel.notes') };
  if (isRecordingMode) return [notes];

  return [
    notes,
    { id: 'transcript', label: editorMessage('editor.audioBlock.panel.transcript') },
    { id: 'summary', label: editorMessage('editor.audioBlock.panel.summary') },
  ];
}

export function buildAudioBlockCreateOptions(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<AudioBlockSelectOption> {
  return [
    { isGroup: true, label: editorMessage('editor.audioBlock.create.group') },
    {
      value: 'summary',
      text: editorMessage('editor.audioBlock.panel.summary'),
    },
  ];
}

export function buildAudioBlockTranslationLanguages(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<AudioBlockLanguageOption> {
  return [
    {
      code: 'en',
      label: editorMessage('editor.audioBlock.transcript.language.english'),
      serviceLabel: 'English',
    },
    {
      code: 'ja',
      label: editorMessage('editor.audioBlock.transcript.language.japanese'),
      serviceLabel: '日本語',
    },
    {
      code: 'ko',
      label: editorMessage('editor.audioBlock.transcript.language.korean'),
      serviceLabel: '한국어',
    },
    {
      code: 'fr',
      label: editorMessage('editor.audioBlock.transcript.language.french'),
      serviceLabel: 'Français',
    },
    {
      code: 'de',
      label: editorMessage('editor.audioBlock.transcript.language.german'),
      serviceLabel: 'Deutsch',
    },
    {
      code: 'es',
      label: editorMessage('editor.audioBlock.transcript.language.spanish'),
      serviceLabel: 'Español',
    },
  ];
}

export function buildAudioBlockTranslationOptions(
  languages: ReadonlyArray<AudioBlockLanguageOption>,
  editorMessage: EditorMessageResolver,
): ReadonlyArray<AudioBlockSelectOption> {
  return [
    { isGroup: true, label: editorMessage('editor.audioBlock.transcript.translateTargetLanguage') },
    ...languages.map((language) => ({
      value: language.code,
      text: language.label,
    })),
  ];
}
