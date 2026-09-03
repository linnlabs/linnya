import { MODEL_INPUT_ERROR_CODES, ModelInputCapabilityError } from '@linnlabs/linnkit/runtime-kernel';
import { findDurableAttachmentPresence } from '../functions/findDurableAttachmentPresence';

export function assertLlmInputMaterialized(input: {
  readonly modelId: string;
  readonly messages: readonly unknown[];
}): void {
  const presence = findDurableAttachmentPresence(input.messages);
  if (!presence.found) return;

  // Durable ref 绝不能进入 Provider capability；只有已核验 bytes 可以跨越该边界。
  throw new ModelInputCapabilityError(
    MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
    '图片输入尚未完成安全物化，当前请求已在供应商调用前终止',
    {
      active_model_id: input.modelId,
      required_placements: presence.placements,
    }
  );
}
