import { truncateObservationToPreview } from '../../../../tools/tool_output/toolOutputStore';
import { assertToolConversationScopeContext } from './conversation-scope';
import type { ObservationPreviewPort, ToolRuntimePort } from '@linnlabs/linnkit/runtime-kernel';
import { toolRegistry } from './toolRegistry';

function readToolDefinitionCompat(toolName: string) {
  if (typeof toolRegistry.getToolDefinition === 'function') {
    return toolRegistry.getToolDefinition(toolName);
  }
  if (typeof toolRegistry.getTool === 'function') {
    const tool = toolRegistry.getTool(toolName);
    if (!tool) {
      return undefined;
    }
    return {
      parameters: tool.parameters,
      idempotency: tool.idempotency,
      modelInputRequirement: tool.modelInputRequirement,
      modelInputDelivery: tool.modelInputDelivery,
      resolveModelInputRequirement: tool.resolveModelInputRequirement,
    };
  }
  return undefined;
}

/**
 * Linnya 默认工具运行时端口。
 *
 * 中文备注：
 * - 这里属于 host-adapter 默认装配；
 * - core 侧应优先通过依赖注入显式传入 port；
 * - `src/tools/defaultPorts.ts` 当前只保留 compatibility bridge。
 */
export const defaultToolRuntimePort: ToolRuntimePort = {
  getToolSchemas(input) {
    return toolRegistry.getToolSchemas(input);
  },
  getToolDefinition(toolName) {
    return readToolDefinitionCompat(toolName);
  },
  executeTool(toolName, args, context) {
    return toolRegistry.executeTool(toolName, args, context);
  },
};

export const defaultObservationPreviewPort: ObservationPreviewPort = {
  truncateObservation(params) {
    assertToolConversationScopeContext(params.context, '[defaultObservationPreviewPort]');
    return truncateObservationToPreview({
      ...params,
      context: params.context,
    });
  },
};
