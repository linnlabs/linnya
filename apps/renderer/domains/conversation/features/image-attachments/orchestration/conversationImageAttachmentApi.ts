import {
  ConversationImageAttachmentErrorResponseSchema,
  ConversationImageDraftStageResponseSchema,
  type ConversationImageAttachmentErrorCode,
  type ConversationImageDraftStageResponse,
} from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '../../../../../shared/services/aiService/common';
import { ConversationImageAttachmentApiError } from '../definitions/conversationImageAttachmentDraft';

async function readErrorCode(response: Response): Promise<ConversationImageAttachmentErrorCode> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = ConversationImageAttachmentErrorResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.code : 'conversation.image.staging_failed';
}

export interface ConversationImageAttachmentApiPort {
  stageFile(file: File, signal: AbortSignal): Promise<ConversationImageDraftStageResponse>;
  releaseDraft(draftId: string): Promise<void>;
}

export interface ConversationImageAttachmentApiDependencies {
  readonly getBaseUrl: () => Promise<string>;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function createConversationImageAttachmentApi(
  dependencies: ConversationImageAttachmentApiDependencies,
): ConversationImageAttachmentApiPort {
  return {
    async stageFile(file, signal) {
      const form = new FormData();
      form.append('file', file, file.name);
      const baseUrl = await dependencies.getBaseUrl();
      const response = await dependencies.fetch(
        `${baseUrl}/api/v1/conversation/attachments/images`,
        {
          method: 'POST',
          body: form,
          signal,
        },
      );
      if (!response.ok) {
        throw new ConversationImageAttachmentApiError(await readErrorCode(response));
      }
      const payload: unknown = await response.json().catch(() => null);
      const parsed = ConversationImageDraftStageResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ConversationImageAttachmentApiError('conversation.image.staging_failed');
      }
      return parsed.data;
    },

    async releaseDraft(draftId) {
      const baseUrl = await dependencies.getBaseUrl();
      const response = await dependencies.fetch(
        `${baseUrl}/api/v1/conversation/attachments/images/${encodeURIComponent(draftId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new ConversationImageAttachmentApiError(await readErrorCode(response));
      }
    },
  };
}

export const conversationImageAttachmentApi = createConversationImageAttachmentApi({
  getBaseUrl: getApiBaseUrl,
  fetch: apiFetch,
});
