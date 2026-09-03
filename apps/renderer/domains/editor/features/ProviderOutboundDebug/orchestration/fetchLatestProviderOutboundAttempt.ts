import {
  ProviderOutboundAttemptSnapshotSchema,
  type ProviderOutboundAttemptSnapshot,
} from '@app/schemas/provider-outbound-audit';
import { apiFetch, getApiBaseUrl } from '../../../../../shared/services/aiService/common';

/** 开发调试面只消费后端安全 schema，不接受旧 LLM HTTP snapshot。 */
export async function fetchLatestProviderOutboundAttempt(): Promise<ProviderOutboundAttemptSnapshot | null> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(`${baseUrl}/api/v1/debug/provider-outbound/latest-attempt`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Provider outbound snapshot 请求失败：${response.status} ${response.statusText}`
    );
  }

  return ProviderOutboundAttemptSnapshotSchema.parse(await response.json());
}
