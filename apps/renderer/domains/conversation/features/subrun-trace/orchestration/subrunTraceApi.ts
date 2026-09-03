import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';
import { isRecord } from '../../../utils/typeGuards';
import type { ReadSubrunTraceOptions, SubrunTraceApiPort, SubrunTraceDto } from '../definitions/subrunTrace';
import { readSubrunTraceDto } from '../functions/subrunTraceDtoGuards';

export const subrunTraceApi: SubrunTraceApiPort = {
  readSubrunTrace(conversationId, parentToolCallId, options) {
    return requestSubrunTrace(conversationId, parentToolCallId, options);
  },
};

async function requestSubrunTrace(
  conversationId: string,
  parentToolCallId: string,
  options: ReadSubrunTraceOptions,
): Promise<SubrunTraceDto> {
  const params = new URLSearchParams({
    parent_tool_call_id: parentToolCallId,
    subrun_id: options.subrunId,
    kinds: options.kinds.join(','),
  });
  if (typeof options.limit === 'number') {
    params.set('limit', String(options.limit));
  }
  if (typeof options.cursor === 'number') {
    params.set('cursor', String(options.cursor));
  }

  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}/api/v1/conversation/${encodeURIComponent(conversationId)}/subrun-trace?${params.toString()}`;
  const response = await apiFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload: unknown = await response.json().catch(() => null);

  if (response.status === 409) {
    const dto = readSubrunTraceDto(payload);
    if (dto.success === false && dto.status === 'preparing') {
      return dto;
    }
  }

  if (!response.ok) {
    const message = readErrorMessage(payload) ?? `HTTP ${response.status}: failed to read subrun trace`;
    throw new Error(message);
  }

  return readSubrunTraceDto(payload);
}

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const error = value.error;
  return typeof error === 'string' && error.trim().length > 0 ? error : null;
}
