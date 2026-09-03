import {
  ConversationImageAttachmentErrorResponseSchema,
  type ConversationImageAttachmentErrorCode,
} from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '../../../../../shared/services/aiService/common';
import {
  ConversationImagePreviewApiError,
  type ConversationImagePreviewErrorCode,
} from '../definitions/conversationImagePreview';

const PREVIEW_ERROR_CODES = new Set<ConversationImageAttachmentErrorCode>([
  'conversation.image.asset_not_found',
  'conversation.image.asset_integrity_failed',
  'conversation.image.preview_failed',
]);

function isPreviewErrorCode(
  code: ConversationImageAttachmentErrorCode,
): code is ConversationImagePreviewErrorCode {
  return PREVIEW_ERROR_CODES.has(code);
}

async function readPreviewError(response: Response): Promise<ConversationImagePreviewErrorCode> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = ConversationImageAttachmentErrorResponseSchema.safeParse(payload);
  return parsed.success && isPreviewErrorCode(parsed.data.code)
    ? parsed.data.code
    : 'conversation.image.preview_failed';
}

export interface ConversationImagePreviewApiPort {
  loadImage(assetId: string, signal: AbortSignal): Promise<Blob>;
}

export interface ConversationImagePreviewApiDependencies {
  readonly getBaseUrl: () => Promise<string>;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function createConversationImagePreviewApi(
  dependencies: ConversationImagePreviewApiDependencies,
): ConversationImagePreviewApiPort {
  return {
    async loadImage(assetId, signal) {
      const baseUrl = await dependencies.getBaseUrl();
      const response = await dependencies.fetch(
        `${baseUrl}/api/v1/conversation/assets/images/${encodeURIComponent(assetId)}/content`,
        { headers: { Accept: 'image/*' }, signal },
      );
      if (!response.ok) {
        throw new ConversationImagePreviewApiError(await readPreviewError(response));
      }
      return response.blob();
    },
  };
}

export const conversationImagePreviewApi = createConversationImagePreviewApi({
  getBaseUrl: getApiBaseUrl,
  fetch: apiFetch,
});
