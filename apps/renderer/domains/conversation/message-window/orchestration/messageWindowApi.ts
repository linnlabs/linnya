import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';
import { MessageWindowRequestError, type MessageWindowApiPort } from '../definitions/messageWindowApi';
import type { UiMessagesWindowDto, UiMessagesRefreshDto } from '../definitions/uiMessagesDto';
import { readUiMessagesWindowDto, readUiMessagesRefreshDto } from '../functions/uiMessagesDtoGuards';
import { isRecord } from '../../utils/typeGuards';

const DEFAULT_LIMIT = 80;

export const messageWindowApi: MessageWindowApiPort = {
  readRefresh(conversationId, query) {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return requestWindow(conversationId, `ui-messages/refresh?${params.toString()}`, readUiMessagesRefreshDto);
  },

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

async function requestWindow(conversationId: string, path: string): Promise<UiMessagesWindowDto>;
async function requestWindow(conversationId: string, path: string, read: typeof readUiMessagesRefreshDto): Promise<UiMessagesRefreshDto>;
async function requestWindow(
  conversationId: string,
  path: string,
  read: typeof readUiMessagesRefreshDto = readUiMessagesWindowDto,
): Promise<UiMessagesRefreshDto> {
  let response: Response;
  try {
    const baseUrl = await getApiBaseUrl();
    const url = `${baseUrl}/api/v1/conversation/${encodeURIComponent(conversationId)}/${path}`;
    response = await apiFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (cause) {
    throw new MessageWindowRequestError('request', undefined, cause);
  }

  // 非 JSON 的错误页也必须保留 HTTP 失败，不能被 JSON 解析异常掩盖。
  if (!response.ok && response.status !== 409) {
    throw new MessageWindowRequestError('http', response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new MessageWindowRequestError('response-json', response.status, cause);
  }

  if (response.status === 409) {
    const dto = readResponse(payload, response.status, conversationId, path, readUiMessagesWindowDto);
    if (dto.success === false && 'status' in dto && dto.status === 'preparing') {
      return dto;
    }
  }

  if (!response.ok) {
    throw new MessageWindowRequestError('http', response.status);
  }

  return readResponse(payload, response.status, conversationId, path, read);
}

function readResponse<T>(
  payload: unknown,
  httpStatus: number,
  conversationId: string,
  path: string,
  read: (payload: unknown) => T,
): T {
  try {
    return read(payload);
  } catch (cause) {
    // 只观察响应外形，不能把整段对话或服务端响应正文写进诊断日志。
    console.error('[MessageWindowApi] Response contract rejected', {
      conversationId,
      path,
      httpStatus,
      fields: isRecord(payload) ? Object.keys(payload) : [],
      messageCount: isRecord(payload) && Array.isArray(payload.messages) ? payload.messages.length : null,
    });
    throw new MessageWindowRequestError('response-contract', httpStatus, cause);
  }
}
