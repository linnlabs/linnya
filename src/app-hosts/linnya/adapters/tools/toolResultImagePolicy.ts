import { llm } from '@linnlabs/linnkit/runtime-kernel';
import type { ToolResultImagePolicyPort } from 'src/tools/types';
import { defaultModelCatalog } from '../runtime-assembly/modelCatalog';

const TOOL_RESULT_IMAGE_REQUIREMENT: llm.ModelInputRequirement = Object.freeze({
  requires_image_input: true,
  placements: Object.freeze(['tool_result_image'] as const),
});

/**
 * Host 决定工具结果能否附带图片。
 *
 * - Host 主动发起、批次后直接交还调用方的那次调用（CLI tools call）：结果给外部调用方，默认附带图片，
 *   由调用方自己决定看不看；
 * - 其他调用交给本 run 的模型：按模型目录中“工具结果接下来交给的模型”（Linnkit 注入的 activeModelId）
 *   的 tool_result_image 输入能力判断。不能看 modelId：云端额度兜底后 run 锁定到兜底模型，modelId
 *   仍是原选定模型，按它附图会让不能看图的兜底模型在下一次请求的输入预检被拒。
 *   child run 的上下文由自己的工具节点注入，因此每次按调用时的上下文判断，不在创建时固化。
 */
export function createToolResultImagePolicy(
  modelCatalog: llm.ModelCatalogLike = defaultModelCatalog
): ToolResultImagePolicyPort {
  return {
    deliveryFor(context) {
      const hostCall = context.authorizedHostToolCall;
      if (hostCall?.resultReceiver === 'host_caller' && hostCall.toolCallId === context.parentToolCallId) {
        return 'attach';
      }
      const model = context.activeModelId ? modelCatalog.getModelById(context.activeModelId) : undefined;
      return llm.evaluateModelInputCompatibility(model, TOOL_RESULT_IMAGE_REQUIREMENT).compatible
        ? 'attach'
        : 'metadata_only';
    },
  };
}
