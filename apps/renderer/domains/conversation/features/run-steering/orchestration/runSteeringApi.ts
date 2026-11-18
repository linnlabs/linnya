import {
  ConversationRunSteerDrainResponse,
  ConversationRunSteerResponse,
  ConversationRunSteerWithdrawResponse,
} from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@/shared/services/aiService/common';

async function postJson(path: string, body: unknown): Promise<unknown> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(`${baseUrl}/api/v1/conversation${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Steer request failed: HTTP ${response.status}`);
  return response.json();
}

export async function requestRunSteer(input: {
  readonly runId: string;
  readonly conversationId: string;
  readonly inputId: string;
  readonly content: string;
}): Promise<ConversationRunSteerResponse> {
  return ConversationRunSteerResponse.parse(await postJson(
    `/runs/${encodeURIComponent(input.runId)}/steer`,
    { conversation_id: input.conversationId, input_id: input.inputId, content: input.content },
  ));
}

export async function requestSteerWithdraw(input: {
  readonly runId: string;
  readonly conversationId: string;
  readonly inputId: string;
}): Promise<ConversationRunSteerWithdrawResponse> {
  return ConversationRunSteerWithdrawResponse.parse(await postJson(
    `/runs/${encodeURIComponent(input.runId)}/steer/${encodeURIComponent(input.inputId)}/withdraw`,
    { conversation_id: input.conversationId },
  ));
}

export async function requestSteerDrain(input: {
  readonly runId: string;
  readonly conversationId: string;
}): Promise<ConversationRunSteerDrainResponse> {
  return ConversationRunSteerDrainResponse.parse(await postJson(
    `/runs/${encodeURIComponent(input.runId)}/steer/drain`,
    { conversation_id: input.conversationId },
  ));
}
