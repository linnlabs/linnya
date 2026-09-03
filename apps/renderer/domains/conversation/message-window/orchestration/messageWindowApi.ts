import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';
import type { MessageWindowApiPort } from '../definitions/messageWindowApi';
import type { UiMessagesWindowDto } from '../definitions/uiMessagesDto';
import { readUiMessagesWindowDto } from '../functions/uiMessagesDtoGuards';
import { isRecord } from '../../utils/typeGuards';

const DEFAULT_LIMIT = 80;

export const messageWindowApi: MessageWindowApiPort = {
  readTail(conversationId, limit) {
    return requestWindow(conversationId, `ui-messages/tail?limit=${encodeURIComponent(String(limit))}`);
  },

  readBefore(conversationId, cursor, limit) {
    const params = new URLSearchParams({
      cursor: String(cursor),
      limit: String(limit),
    });
    return requestWindow(conversationId, `ui-messages/before?${params.toString()}`);
  },

  readAfter(conversationId, cursor, limit) {
    const params = new URLSearchParams({
      cursor: String(cursor),
      limit: String(limit),
    });
    return requestWindow(conversationId, `ui-messages/after?${params.toString()}`);
  },

  readAround(conversationId, anchorMessageId, limit) {
    const params = new URLSearchParams({
      anchor_message_id: anchorMessageId,
      limit: String(limit),
    });
    return requestWindow(conversationId, `ui-messages/around?${params.toString()}`);
  },
};

export function readDefaultMessageWindowLimit(): number {
  return DEFAULT_LIMIT;
}

async function requestWindow(conversationId: string, path: string): Promise<UiMessagesWindowDto> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}/api/v1/conversation/${encodeURIComponent(conversationId)}/${path}`;
  const response = await apiFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload: unknown = await response.json().catch(() => null);

  if (response.status === 409) {
    const dto = readUiMessagesWindowDto(payload);
    if (dto.success === false && 'status' in dto && dto.status === 'preparing') {
      return dto;
    }
  }

  if (!response.ok) {
    const message = readErrorMessage(payload) ?? `HTTP ${response.status}: failed to read UI message window`;
    throw new Error(message);
  }

  return readUiMessagesWindowDto(payload);
}

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const error = value.error;
  return typeof error === 'string' && error.trim().length > 0 ? error : null;
}
