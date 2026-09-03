import {
  DEFAULT_AI_SDK_STREAM_IDLE_TIMEOUT_MS,
  type AiSdkStreamReliabilityPolicy,
} from '../definitions/aiSdkStreamReliabilityPolicy';

export function resolveAiSdkStreamReliabilityPolicy(
  idleTimeoutMs: number | undefined
): AiSdkStreamReliabilityPolicy {
  const resolved = idleTimeoutMs ?? DEFAULT_AI_SDK_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error('AI SDK stream idle timeout 必须是正安全整数。');
  }
  return Object.freeze({ idle_timeout_ms: resolved });
}
