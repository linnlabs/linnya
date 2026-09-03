import type { ConversationAttachmentRef } from '@app/schemas';
import {
  ConversationImagePreviewApiError,
  type ConversationImagePreviewErrorCode,
  type ConversationImagePreviewItem,
} from '../definitions/conversationImagePreview';
import type { ConversationImagePreviewApiPort } from './conversationImagePreviewApi';

export interface ConversationImagePreviewStatePort {
  replace(items: readonly ConversationImagePreviewItem[]): void;
}

export interface ConversationImagePreviewObjectUrlPort {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export interface ConversationImagePreviewController {
  setAttachments(attachments: readonly ConversationAttachmentRef[]): void;
  retry(attachmentId: string): void;
  dispose(): void;
}

interface PreviewRuntime {
  readonly attachment: ConversationAttachmentRef;
  readonly abortController: AbortController;
  objectUrl?: string;
}

function toPreviewErrorCode(error: unknown): ConversationImagePreviewErrorCode {
  return error instanceof ConversationImagePreviewApiError
    ? error.code
    : 'conversation.image.preview_failed';
}

export function createConversationImagePreviewController(dependencies: {
  readonly api: ConversationImagePreviewApiPort;
  readonly state: ConversationImagePreviewStatePort;
  readonly objectUrls: ConversationImagePreviewObjectUrlPort;
}): ConversationImagePreviewController {
  const { api, state, objectUrls } = dependencies;
  const itemsById = new Map<string, ConversationImagePreviewItem>();
  const runtimes = new Map<string, PreviewRuntime>();
  let orderedAttachmentIds: string[] = [];

  const publish = (): void => {
    state.replace(orderedAttachmentIds.flatMap(attachmentId => {
      const item = itemsById.get(attachmentId);
      return item ? [item] : [];
    }));
  };

  const disposeRuntime = (attachmentId: string): void => {
    const runtime = runtimes.get(attachmentId);
    if (!runtime) return;
    runtimes.delete(attachmentId);
    runtime.abortController.abort();
    if (runtime.objectUrl) objectUrls.revoke(runtime.objectUrl);
  };

  const load = (attachment: ConversationAttachmentRef): void => {
    disposeRuntime(attachment.id);
    const runtime: PreviewRuntime = {
      attachment,
      abortController: new AbortController(),
    };
    runtimes.set(attachment.id, runtime);
    itemsById.set(attachment.id, { attachment, status: 'loading' });
    publish();

    void api.loadImage(attachment.assetId, runtime.abortController.signal).then(blob => {
      if (runtimes.get(attachment.id) !== runtime) return;
      const objectUrl = objectUrls.create(blob);
      runtime.objectUrl = objectUrl;
      itemsById.set(attachment.id, { attachment, status: 'ready', objectUrl });
      publish();
    }).catch(error => {
      if (runtimes.get(attachment.id) !== runtime || runtime.abortController.signal.aborted) return;
      itemsById.set(attachment.id, {
        attachment,
        status: 'error',
        errorCode: toPreviewErrorCode(error),
      });
      publish();
    });
  };

  const setAttachments = (attachments: readonly ConversationAttachmentRef[]): void => {
    const nextIds = new Set(attachments.map(attachment => attachment.id));
    for (const attachmentId of orderedAttachmentIds) {
      if (nextIds.has(attachmentId)) continue;
      disposeRuntime(attachmentId);
      itemsById.delete(attachmentId);
    }

    orderedAttachmentIds = attachments.map(attachment => attachment.id);
    for (const attachment of attachments) {
      const current = itemsById.get(attachment.id);
      if (current?.attachment.assetId === attachment.assetId) {
        itemsById.set(attachment.id, { ...current, attachment });
        continue;
      }
      load(attachment);
    }
    publish();
  };

  const dispose = (): void => {
    for (const attachmentId of [...runtimes.keys()]) disposeRuntime(attachmentId);
    itemsById.clear();
    orderedAttachmentIds = [];
    publish();
  };

  return {
    setAttachments,
    retry(attachmentId) {
      const item = itemsById.get(attachmentId);
      if (item?.status === 'error') load(item.attachment);
    },
    dispose,
  };
}
