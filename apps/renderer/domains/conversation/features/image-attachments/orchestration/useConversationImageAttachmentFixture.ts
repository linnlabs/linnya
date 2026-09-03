import { onUnmounted, ref } from 'vue';
import type { ConversationAttachmentRef, ConversationImageAttachmentErrorCode } from '@app/schemas';
import { resolveImageAttachmentErrorMessage } from '../functions/resolveImageAttachmentErrorMessage';
import {
  selectConversationImageFiles,
  type ConversationImageEntrySource,
} from '../functions/selectConversationImageFiles';
import { useConversationImageAttachmentDrafts } from './useConversationImageAttachmentDrafts';

const FIXTURE_ATTACHMENTS = [
  {
    id: 'fixture-attachment-primary',
    kind: 'image',
    assetId: 'fixture-asset-primary',
    mediaType: 'image/png',
    byteLength: 1642,
    width: 480,
    height: 300,
    sha256: '1'.repeat(64),
    fileName: 'history-primary.png',
  },
  {
    id: 'fixture-attachment-secondary',
    kind: 'image',
    assetId: 'fixture-asset-secondary',
    mediaType: 'image/png',
    byteLength: 1708,
    width: 480,
    height: 300,
    sha256: '2'.repeat(64),
    fileName: 'history-secondary.png',
  },
] satisfies readonly ConversationAttachmentRef[];

const FIXTURE_ERROR_ATTACHMENTS = [
  {
    id: 'fixture-attachment-missing',
    kind: 'image',
    assetId: 'fixture-asset-missing',
    mediaType: 'image/png',
    byteLength: 1024,
    width: 480,
    height: 300,
    sha256: '3'.repeat(64),
    fileName: 'missing-image.png',
  },
  {
    id: 'fixture-attachment-corrupt',
    kind: 'image',
    assetId: 'fixture-asset-corrupt',
    mediaType: 'image/png',
    byteLength: 1024,
    width: 480,
    height: 300,
    sha256: '4'.repeat(64),
    fileName: 'corrupt-image.png',
  },
] satisfies readonly ConversationAttachmentRef[];

export function useConversationImageAttachmentFixture() {
  const { store, controller } = useConversationImageAttachmentDrafts();
  const entryErrorCode = ref<ConversationImageAttachmentErrorCode | null>(null);
  const lastEntrySource = ref<ConversationImageEntrySource | null>(null);

  function stageFiles(input: {
    readonly source: ConversationImageEntrySource;
    readonly files: readonly File[];
    readonly hasPlainText?: boolean;
  }): boolean {
    const selection = selectConversationImageFiles(input);
    if (selection.files.length === 0) return false;
    const result = controller.stageFiles(selection.files);
    entryErrorCode.value = result.kind === 'rejected' ? result.code : null;
    lastEntrySource.value = input.source;
    return selection.shouldConsumeEvent;
  }

  function remove(clientId: string): void {
    controller.remove(clientId);
    entryErrorCode.value = null;
  }

  function retry(clientId: string): void {
    if (controller.retry(clientId)) entryErrorCode.value = null;
  }

  function clear(): void {
    controller.clear();
    entryErrorCode.value = null;
    lastEntrySource.value = null;
  }

  onUnmounted(clear);

  return {
    drafts: store,
    durableAttachments: FIXTURE_ATTACHMENTS,
    errorAttachments: FIXTURE_ERROR_ATTACHMENTS,
    entryErrorCode,
    lastEntrySource,
    errorMessageKey: () => entryErrorCode.value
      ? resolveImageAttachmentErrorMessage(entryErrorCode.value)
      : null,
    stageFiles,
    remove,
    retry,
    clear,
  };
}
