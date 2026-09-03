import type { AiSdkInferenceCapabilityId } from '../definitions/aiSdkCapabilityIds';
import type {
  AiSdkInferenceRoute,
  AiSdkInferenceSurface,
} from '../definitions/aiSdkInferenceSurface';

/** 每次 attempt 必须命中创建 capability 时固定的 codec/surface，禁止运行时猜测协议。 */
export function assertAiSdkInferenceRouteMatchesCapability(
  route: AiSdkInferenceRoute,
  capabilityId: AiSdkInferenceCapabilityId,
  surface: AiSdkInferenceSurface
): void {
  if (route.capability_id !== capabilityId || route.surface !== surface) {
    throw new Error('[AiSdkInference] attempt route 与 adapter capability 不一致。');
  }
}
