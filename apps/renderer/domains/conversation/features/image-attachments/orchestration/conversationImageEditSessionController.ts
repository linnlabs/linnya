import type { ConversationAttachmentRef } from '@app/schemas';
import type { ConversationImageDraftAdditionResult } from '../definitions/conversationImageAttachmentDraft';
import type {
  ConversationImageEditOrderItem,
  ConversationImageEditSubmission,
} from '../definitions/conversationImageEditSession';
import { validateConversationImageEditAddition, buildConversationImageEditSubmission } from '../functions/conversationImageEditRules';
import type { ConversationImageAttachmentApiPort } from './conversationImageAttachmentApi';
import { createConversationImageAttachmentDraftController } from './conversationImageAttachmentDraftController';
import type { useConversationImageEditSessionStore } from '../store/conversationImageEditSessionStore';

type EditSessionStore = ReturnType<typeof useConversationImageEditSessionStore>;

export interface ConversationImageEditSessionController {
  start(messageId: string, attachments: readonly ConversationAttachmentRef[]): boolean;
  stageFiles(files: readonly File[]): ConversationImageDraftAdditionResult;
  retry(clientId: string): boolean;
  remove(item: ConversationImageEditOrderItem): void;
  move(item: ConversationImageEditOrderItem, offset: -1 | 1): void;
  beginSubmission(messageId: string): ConversationImageEditSubmission | null;
  acceptCommitted(messageId: string): void;
  failSubmission(messageId: string): void;
  cancel(messageId?: string): void;
}

export function createConversationImageEditSessionController(dependencies: {
  readonly store: EditSessionStore;
  readonly api: ConversationImageAttachmentApiPort;
  readonly objectUrls: { create(file: File): string; revoke(url: string): void };
  readonly createClientId: () => string;
}): ConversationImageEditSessionController {
  const { store } = dependencies;
  let cancelAfterSubmission = false;
  const drafts = createConversationImageAttachmentDraftController({
    store: {
      get items() { return store.draftItems; },
      appendUploading: item => store.appendUploading(item),
      markUploading: clientId => store.markUploading(clientId),
      markReady: (clientId, staged) => store.markReady(clientId, staged),
      markFailed: (clientId, code) => store.markFailed(clientId, code),
      remove: clientId => store.remove(clientId),
      clear: () => store.clearDraftItems(),
    },
    api: dependencies.api,
    objectUrls: dependencies.objectUrls,
    log: { releaseFailed: code => console.warn('[conversation-image-edit] release 失败', { code }) },
    createClientId: dependencies.createClientId,
  });

  const reset = (releaseDrafts: boolean): void => {
    if (releaseDrafts) drafts.clear();
    else drafts.acceptCommitted();
    store.clear();
  };

  return {
    start(messageId, attachments) {
      if (store.isSubmitting) return false;
      if (store.messageId !== null) reset(true);
      cancelAfterSubmission = false;
      store.start(messageId, attachments);
      return true;
    },
    stageFiles(files) {
      const rejectionCode = validateConversationImageEditAddition(store, files);
      if (rejectionCode) {
        store.setErrorCode(rejectionCode);
        return { kind: 'rejected', code: rejectionCode };
      }
      return drafts.stageFiles(files);
    },
    retry: clientId => drafts.retry(clientId),
    remove(item) {
      if (store.isSubmitting) return;
      if (item.source === 'existing') store.removeExisting(item.attachmentId);
      else drafts.remove(item.clientId);
    },
    move(item, offset) {
      if (!store.isSubmitting) store.move(item, offset);
    },
    beginSubmission(messageId) {
      if (store.messageId !== messageId || store.isSubmitting) return null;
      const submission = buildConversationImageEditSubmission(store);
      if (submission) store.setSubmitting(true);
      return submission;
    },
    acceptCommitted(messageId) {
      if (store.messageId === messageId) {
        cancelAfterSubmission = false;
        reset(false);
      }
    },
    failSubmission(messageId) {
      if (store.messageId !== messageId) return;
      store.setSubmitting(false);
      if (cancelAfterSubmission) {
        cancelAfterSubmission = false;
        reset(true);
      }
    },
    cancel(messageId) {
      if (messageId !== undefined && store.messageId !== messageId) return;
      if (store.isSubmitting) {
        cancelAfterSubmission = true;
        return;
      }
      reset(true);
    },
  };
}
