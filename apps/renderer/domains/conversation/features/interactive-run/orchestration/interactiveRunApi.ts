import {
  validateConversationActiveRunResponse,
  validateConversationRunCancelResponse,
  validateConversationRunSettlementResponse,
  type ConversationActiveRunResponse,
  type ConversationRunCancelRequest,
  type ConversationRunCancelResponse,
  type ConversationRunSettlementResponse,
} from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@/shared/services/aiService/common';

export async function requestForegroundRunPause(
  runId: string,
  conversationId: string,
  executionId: string
): Promise<ConversationActiveRunResponse> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/conversation/runs/${encodeURIComponent(runId)}/pause`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, expected_execution_id: executionId }),
    }
  );
  if (!response.ok) throw new Error(`Failed to pause run ${runId}: HTTP ${response.status}`);
  const parsed = validateConversationActiveRunResponse(await response.json());
  if (!parsed.success) throw new Error(`Invalid pause response: ${parsed.error.message}`);
  if (parsed.data.conversation_id !== conversationId)
    throw new Error('Pause response conversation mismatch');
  return parsed.data;
}

export async function fetchActiveForegroundRun(
  conversationId: string
): Promise<ConversationActiveRunResponse> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/conversation/conversations/${encodeURIComponent(conversationId)}/runs/active`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  );
  if (!response.ok) {
    throw new Error(`Failed to query active run for ${conversationId}: HTTP ${response.status}`);
  }
  const parsed = validateConversationActiveRunResponse(await response.json());
  if (!parsed.success) {
    throw new Error(`Invalid active run response for ${conversationId}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function requestForegroundRunCancellation(
  runId: string,
  request: ConversationRunCancelRequest
): Promise<ConversationRunCancelResponse> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/conversation/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to cancel run ${runId}: HTTP ${response.status}`);
  }
  const parsed = validateConversationRunCancelResponse(await response.json());
  if (!parsed.success) {
    throw new Error(`Invalid run cancellation response for ${runId}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function fetchForegroundRunSettlement(
  conversationId: string,
  runId: string
): Promise<ConversationRunSettlementResponse> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/conversation/conversations/${encodeURIComponent(conversationId)}/runs/${encodeURIComponent(runId)}/settlement`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  );
  if (!response.ok) {
    throw new Error(`Failed to query settlement for run ${runId}: HTTP ${response.status}`);
  }
  const parsed = validateConversationRunSettlementResponse(await response.json());
  if (!parsed.success) {
    throw new Error(`Invalid settlement response for run ${runId}: ${parsed.error.message}`);
  }
  if (parsed.data.conversation_id !== conversationId || parsed.data.requested_run_id !== runId) {
    throw new Error(`Run settlement identity does not match request ${runId}`);
  }
  return parsed.data;
}
