import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';
import { isRecord } from '../../../utils/typeGuards';
import type { TimelineTurnIndexApiPort, TimelineTurnIndexDto } from '../definitions/timelineTurnIndex';
import { readTimelineTurnIndexDto } from '../functions/timelineTurnIndexDtoGuard';

export const timelineTurnIndexApi: TimelineTurnIndexApiPort = {
  async readTurnIndex(conversationId: string): Promise<TimelineTurnIndexDto> {
    const baseUrl = await getApiBaseUrl();
    const url = `${baseUrl}/api/v1/conversation/${encodeURIComponent(conversationId)}/turns`;
    const response = await apiFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const payload: unknown = await response.json().catch(() => null);

    if (response.status === 409) {
      return readTimelineTurnIndexDto(payload);
    }
    if (!response.ok) {
      throw new Error(readErrorMessage(payload) ?? `HTTP ${response.status}: failed to read turn index`);
    }
    return readTimelineTurnIndexDto(payload);
  },
};

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.error === 'string' && value.error.trim().length > 0 ? value.error : null;
}
