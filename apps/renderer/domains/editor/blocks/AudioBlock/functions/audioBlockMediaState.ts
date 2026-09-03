import type { EditorMessageKey } from '../../../definitions/editorMessages';

export type AudioBlockSaveStatus = 'failed';

export type AudioBlockMissingReason =
  | 'saved-source-missing'
  | 'temporary-source-persisted'
  | 'save-failed-without-runtime-audio'
  | 'finalized-without-source';

export interface AudioBlockPersistedMediaSnapshot {
  readonly src: unknown;
  readonly isTempSrc: unknown;
  readonly isFinalized: unknown;
  readonly saveStatus?: unknown;
}

export function normalizeAudioBooleanAttr(value: unknown): boolean {
  return value === true || value === 'true';
}

export function normalizeAudioSaveStatus(value: unknown): AudioBlockSaveStatus | null {
  return value === 'failed' ? value : null;
}

export function hasPersistedAudioSource(src: unknown): src is string {
  return typeof src === 'string' && src.trim() !== '' && src !== 'null';
}

export function isTemporaryAudioSource(src: unknown): boolean {
  if (!hasPersistedAudioSource(src)) return false;
  return src.startsWith('blob:') || src.startsWith('data:');
}

export function canLoadPersistedAudioSource(snapshot: AudioBlockPersistedMediaSnapshot): snapshot is AudioBlockPersistedMediaSnapshot & { readonly src: string } {
  if (normalizeAudioSaveStatus(snapshot.saveStatus) === 'failed') return false;
  if (!hasPersistedAudioSource(snapshot.src)) return false;
  if (normalizeAudioBooleanAttr(snapshot.isTempSrc)) return false;
  return !isTemporaryAudioSource(snapshot.src);
}

export function resolvePersistedAudioMissingReason(
  snapshot: AudioBlockPersistedMediaSnapshot,
): AudioBlockMissingReason | null {
  if (normalizeAudioSaveStatus(snapshot.saveStatus) === 'failed') {
    return 'save-failed-without-runtime-audio';
  }

  if (hasPersistedAudioSource(snapshot.src)) {
    if (normalizeAudioBooleanAttr(snapshot.isTempSrc) || isTemporaryAudioSource(snapshot.src)) {
      return 'temporary-source-persisted';
    }
    return null;
  }

  if (normalizeAudioBooleanAttr(snapshot.isFinalized)) {
    return 'finalized-without-source';
  }

  return null;
}

export function resolveAudioMissingMessageKey(reason: AudioBlockMissingReason): EditorMessageKey {
  switch (reason) {
    case 'temporary-source-persisted':
      return 'editor.audioBlock.missing.temporarySource';
    case 'save-failed-without-runtime-audio':
    case 'finalized-without-source':
      return 'editor.audioBlock.missing.saveFailed';
    case 'saved-source-missing':
      return 'editor.audioBlock.missing.source';
  }
}
