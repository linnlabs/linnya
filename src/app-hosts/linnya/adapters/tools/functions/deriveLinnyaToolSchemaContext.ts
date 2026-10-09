import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import { AvailableSubagentTypesSchema } from '@app/schemas';
import type { LinnyaToolSchemaContext } from 'src/tools/types';

/**
 * 在 Host port 边界验证 Linnya 的产品请求扩展，并只向 concrete tools 暴露
 * 动态 Schema 真正需要的字段。完整 query/history 不得进入工具 Schema 上下文。
 */
export function deriveLinnyaToolSchemaContext(
  invocation: AgentInvocationRequest
): LinnyaToolSchemaContext {
  const candidate =
    'imageGenerationModelId' in invocation ? invocation.imageGenerationModelId : undefined;
  const caller = 'callerAgentId' in invocation ? invocation.callerAgentId : undefined;
  const availableTypes =
    'availableSubagentTypes' in invocation ? invocation.availableSubagentTypes : undefined;
  return {
    ...(typeof candidate === 'string' && candidate.trim().length > 0
      ? { imageGenerationModelId: candidate.trim() }
      : {}),
    ...(typeof caller === 'string' && caller.length > 0 ? { callerAgentId: caller } : {}),
    ...(availableTypes === undefined
      ? {}
      : { availableSubagentTypes: AvailableSubagentTypesSchema.parse(availableTypes) }),
  };
}
