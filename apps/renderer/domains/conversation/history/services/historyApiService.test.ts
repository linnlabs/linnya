import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@shared/services/aiService/common', () => ({
  getApiBaseUrl: vi.fn(async () => 'http://127.0.0.1:3000'),
  apiFetch: apiFetchMock,
}));

import { HistoryApiService } from './historyApiService';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HistoryApiService selected agent contract', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('persists the product identity through the explicit endpoint', async () => {
    const selectedAgentId = ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture');
    apiFetchMock.mockResolvedValue(jsonResponse({
      success: true,
      selected_agent_id: selectedAgentId,
    }));

    await expect(new HistoryApiService().updateSelectedAgent(
      'conversation-1',
      selectedAgentId,
      null,
    )).resolves.toBe(selectedAgentId);

    expect(apiFetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/v1/conversation/conversation-1/selected-agent',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ selected_agent_id: selectedAgentId, project_id: null }),
      }),
    );
  });

  it('rejects hidden promptKey control data in history responses', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({
      success: true,
      conversations: [{
        conversation_id: 'conversation-1',
        title: '会话',
        created_at: 1,
        last_event_at: 2,
        event_count: 3,
        user_message_count: 1,
        project_id: null,
        is_pinned: false,
        selected_agent_id: null,
        promptKey: 'plugin_agent_fixture',
      }],
      has_more: false,
    }));

    await expect(new HistoryApiService().fetchList()).rejects.toThrow('Unrecognized key');
  });

  it('parses a typed cleanup retry outcome', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({
      success: true,
      outcome: 'conversation_deleted',
    }));

    await expect(new HistoryApiService().retryPendingCleanup('conversation-1'))
      .resolves.toBe('conversation_deleted');
    expect(apiFetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/v1/conversation/conversation-1/cleanup/retry',
      { method: 'POST' },
    );
  });
});
