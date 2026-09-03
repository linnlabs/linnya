import type { ConversationImageAttachmentErrorCode } from '@app/schemas';
import type {
  ConversationImageDraftAdditionResult,
  ConversationImageDraftItem,
  ConversationImageDraftRuntime,
} from '../definitions/conversationImageAttachmentDraft';
import { ConversationImageAttachmentApiError } from '../definitions/conversationImageAttachmentDraft';
import { validateConversationImageDraftAddition } from '../functions/conversationImageDraftRules';
import type { ConversationImageAttachmentApiPort } from './conversationImageAttachmentApi';

export interface ConversationImageDraftStorePort {
  readonly items: ConversationImageDraftItem[];
  appendUploading(item: Extract<ConversationImageDraftItem, { status: 'uploading' }>): void;
  markUploading(clientId: string): void;
  markReady(
    clientId: string,
    staged: Extract<ConversationImageDraftItem, { status: 'ready' }>['staged'],
  ): void;
  markFailed(clientId: string, errorCode: ConversationImageAttachmentErrorCode): void;
  remove(clientId: string): void;
  clear(): void;
}

export interface ConversationImageDraftObjectUrlPort {
  create(file: File): string;
  revoke(url: string): void;
}

export interface ConversationImageDraftLogPort {
  releaseFailed(code: ConversationImageAttachmentErrorCode): void;
}

export interface ConversationImageAttachmentDraftController {
  stageFiles(files: readonly File[]): ConversationImageDraftAdditionResult;
  retry(clientId: string): boolean;
  remove(clientId: string): void;
  clear(): void;
  acceptCommitted(): void;
}

interface ConversationImageAttachmentDraftControllerDependencies {
  readonly store: ConversationImageDraftStorePort;
  readonly api: ConversationImageAttachmentApiPort;
  readonly objectUrls: ConversationImageDraftObjectUrlPort;
  readonly log: ConversationImageDraftLogPort;
  readonly createClientId: () => string;
}

function toSafeErrorCode(error: unknown): ConversationImageAttachmentErrorCode {
  return error instanceof ConversationImageAttachmentApiError
    ? error.code
    : 'conversation.image.staging_failed';
}

export function createConversationImageAttachmentDraftController(
  dependencies: ConversationImageAttachmentDraftControllerDependencies,
): ConversationImageAttachmentDraftController {
  const { store, api, objectUrls, log, createClientId } = dependencies;
  const runtimes = new Map<string, ConversationImageDraftRuntime>();

  const releaseSafely = async (draftId: string): Promise<void> => {
    try {
      await api.releaseDraft(draftId);
    } catch (error) {
      // release 失败不恢复已经移除的 UI；host 重启时会清理剩余临时草稿。
      log.releaseFailed(toSafeErrorCode(error));
    }
  };

  const upload = (clientId: string, runtime: ConversationImageDraftRuntime): void => {
    const controller = runtime.abortController;
    void api.stageFile(runtime.file, controller.signal).then(staged => {
      const current = runtimes.get(clientId);
      if (current !== runtime || current.abortController !== controller) {
        void releaseSafely(staged.draft.draftId);
        return;
      }
      current.draftId = staged.draft.draftId;
      store.markReady(clientId, staged);
    }).catch(error => {
      const current = runtimes.get(clientId);
      if (current !== runtime || current.abortController !== controller) return;
      store.markFailed(clientId, toSafeErrorCode(error));
    });
  };

  const stageFiles = (files: readonly File[]): ConversationImageDraftAdditionResult => {
    const rejectionCode = validateConversationImageDraftAddition(store.items, files);
    if (rejectionCode) return { kind: 'rejected', code: rejectionCode };

    const clientIds: string[] = [];
    for (const file of files) {
      const clientId = createClientId();
      const previewUrl = objectUrls.create(file);
      const runtime: ConversationImageDraftRuntime = {
        file,
        previewUrl,
        abortController: new AbortController(),
      };
      runtimes.set(clientId, runtime);
      store.appendUploading({
        clientId,
        fileName: file.name,
        byteLength: file.size,
        previewUrl,
        status: 'uploading',
      });
      clientIds.push(clientId);
      upload(clientId, runtime);
    }
    return { kind: 'accepted', clientIds };
  };

  const retry = (clientId: string): boolean => {
    const item = store.items.find(candidate => candidate.clientId === clientId);
    const runtime = runtimes.get(clientId);
    if (!item || item.status !== 'failed' || !runtime) return false;

    runtime.abortController = new AbortController();
    delete runtime.draftId;
    store.markUploading(clientId);
    upload(clientId, runtime);
    return true;
  };

  const remove = (clientId: string): void => {
    const runtime = runtimes.get(clientId);
    if (!runtime) return;

    runtimes.delete(clientId);
    runtime.abortController.abort();
    store.remove(clientId);
    objectUrls.revoke(runtime.previewUrl);
    if (runtime.draftId) void releaseSafely(runtime.draftId);
  };

  const clearLocal = (releaseReadyDrafts: boolean): void => {
    const currentRuntimes = Array.from(runtimes.values());
    runtimes.clear();
    store.clear();
    for (const runtime of currentRuntimes) {
      runtime.abortController.abort();
      objectUrls.revoke(runtime.previewUrl);
      if (releaseReadyDrafts && runtime.draftId) void releaseSafely(runtime.draftId);
    }
  };

  return {
    stageFiles,
    retry,
    remove,
    clear: () => clearLocal(true),
    // commit 已由 host 消费并释放 draft，此处只回收 Renderer runtime。
    acceptCommitted: () => clearLocal(false),
  };
}
