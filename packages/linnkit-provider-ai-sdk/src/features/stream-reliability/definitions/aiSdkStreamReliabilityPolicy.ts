/**
 * 与 Pi 的默认 HTTP idle timeout 保持同一保守量级；这是连续无内容分片的上限，
 * 不是整次推理总时长，因此不会限制持续输出的长 Agent attempt。
 */
export const DEFAULT_AI_SDK_STREAM_IDLE_TIMEOUT_MS = 300_000;

export interface AiSdkStreamReliabilityPolicy {
  readonly idle_timeout_ms: number;
}
